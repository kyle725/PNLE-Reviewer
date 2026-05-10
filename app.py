"""
PNLE Reviewer - Flask Web Application
Google Sheets integration via Google Apps Script Web App (no service account needed).

Required env vars (Railway):
  APPS_SCRIPT_URL  - The deployed Apps Script web app URL
  SECRET_KEY       - Any random string
"""

from flask import Flask, render_template, jsonify, request, session
import json, os, sqlite3, random, requests as http_requests
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "pnle-reviewer-secret-key-change-in-production")

# Initialize DB at module load time so Railway/gunicorn workers always have it ready
# (safe to call multiple times — CREATE IF NOT EXISTS + ALTER IF NOT EXISTS)
def _ensure_db():
    try:
        os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"), exist_ok=True)
        # Inline minimal init so it runs before init_db() is defined below
        # Full init_db() is called again at bottom for safety
    except Exception as e:
        print(f"⚠️  DB pre-init warning: {e}")

_ensure_db()

BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
DB_PATH         = os.path.join(BASE_DIR, "data", "results.db")
QUESTIONS_PATH  = os.path.join(BASE_DIR, "data", "questions.json")
APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "")


# ─── Apps Script helpers ─────────────────────────────────────────

def call_apps_script(payload: dict) -> dict:
    if not APPS_SCRIPT_URL:
        print("⚠️  APPS_SCRIPT_URL not set — skipping Sheets sync.")
        return {}
    try:
        resp = http_requests.post(
            APPS_SCRIPT_URL, json=payload, timeout=15,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Apps Script call failed: {e}")
        return {}


def call_apps_script_get(action: str) -> dict:
    if not APPS_SCRIPT_URL:
        return {}
    try:
        resp = http_requests.get(
            APPS_SCRIPT_URL, params={"action": action}, timeout=10
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Apps Script GET failed: {e}")
        return {}


# ─── DATABASE ─────────────────────────────────────────────────────

def get_db():
    """
    Open a SQLite connection with:
      - 10-second busy timeout  (waits instead of immediately raising "locked")
      - WAL journal mode        (allows concurrent readers + one writer)
      - Row factory for dict-like access
    """
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db():
    os.makedirs("data", exist_ok=True)
    with get_db() as conn:
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS quiz_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                username TEXT DEFAULT 'Guest',
                email TEXT DEFAULT '',
                mode TEXT DEFAULT 'practice',
                total_questions INTEGER,
                correct_answers INTEGER,
                score_percent REAL,
                time_taken_seconds INTEGER,
                subjects_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Safe migration — only adds columns that don't exist yet
        existing = {row[1] for row in c.execute("PRAGMA table_info(quiz_sessions)")}
        for col, defn in [
            ("email", "TEXT DEFAULT ''"),
            ("mode",  "TEXT DEFAULT 'practice'"),
        ]:
            if col not in existing:
                c.execute(f"ALTER TABLE quiz_sessions ADD COLUMN {col} {defn}")
                print(f"✅ Migrated: added column '{col}'")

        c.execute("""
            CREATE TABLE IF NOT EXISTS question_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                question_id INTEGER NOT NULL,
                subject TEXT,
                topic TEXT,
                difficulty TEXT,
                chosen_answer TEXT,
                correct_answer TEXT,
                is_correct INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
    print("✅ Database initialized")


def load_questions():
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ─── Ensure DB on every worker startup ───────────────────────────
_db_initialized = False

@app.before_request
def ensure_db():
    global _db_initialized
    if not _db_initialized:
        init_db()
        _db_initialized = True


# ─── ROUTES ──────────────────────────────────────────────────────

@app.route("/")
def index():
    data = load_questions()
    return render_template(
        "index.html",
        subjects=data["subjects"],
        total_questions=len(data["questions"])
    )


@app.route("/api/questions", methods=["GET"])
def get_questions():
    data      = load_questions()
    questions = data["questions"]
    subject    = request.args.get("subject", "")
    difficulty = request.args.get("difficulty", "")
    count      = min(int(request.args.get("count", 10)), 200)

    if subject and subject != "all":
        questions = [q for q in questions if q["subject"] == subject]
    if difficulty and difficulty != "all":
        questions = [q for q in questions if q["difficulty"] == difficulty]

    random.shuffle(questions)
    selected = questions[:count]
    session["current_question_ids"] = [q["id"] for q in selected]

    # Include answer + rationale so practice mode can show
    # immediate per-choice feedback without waiting for submit.
    # The correct answer is visible client-side anyway once the
    # user submits, so including it here is not a security concern
    # for a self-study tool.
    return jsonify({
        "questions": [{
            "id":         q["id"],
            "subject":    q["subject"],
            "topic":      q["topic"],
            "difficulty": q["difficulty"],
            "question":   q["question"],
            "choices":    q["choices"],
            "answer":     q.get("answer",    ""),
            "rationale":  q.get("rationale", ""),
        } for q in selected],
        "total": len(selected)
    })


# ─── SUBMIT ──────────────────────────────────────────────────────

@app.route("/api/submit", methods=["POST"])
def submit_quiz():
  try:
    return _submit_quiz_inner()
  except Exception as e:
    import traceback
    tb = traceback.format_exc()
    print("❌ SUBMIT ERROR:\n" + tb)
    return jsonify({"error": str(e), "traceback": tb}), 500

def _submit_quiz_inner():
    payload           = request.json or {}
    session_id        = payload.get("session_id") or str(datetime.now().timestamp())
    username          = payload.get("username") or "Guest"
    email             = payload.get("email") or ""
    mode              = payload.get("mode") or "practice"
    user_answers      = payload.get("answers") or {}
    time_taken        = int(payload.get("time_taken") or 0)
    subject_filter    = payload.get("subject_filter") or "All"
    difficulty_filter = payload.get("difficulty_filter") or "All"

    data = load_questions()
    qmap = {str(q["id"]): q for q in data["questions"]}

    results          = []
    subject_stats    = {}
    difficulty_stats = {
        "easy":   {"correct": 0, "total": 0},
        "medium": {"correct": 0, "total": 0},
        "hard":   {"correct": 0, "total": 0},
    }
    correct_count = 0

    # Build results in memory first — no DB touch yet
    for qid_str, chosen in user_answers.items():
        q = qmap.get(str(qid_str))
        if not q:
            continue

        chosen = (chosen or "").strip()

        # Normalize both sides to just the leading letter (A/B/C/D/E).
        # questions.json may store answer as "A", "A.", "A. Full text", or the full choice string.
        raw_answer  = q.get("answer", "").strip()
        norm_answer = raw_answer[0].upper() if raw_answer else ""
        norm_chosen = chosen[0].upper()     if chosen     else ""

        # Debug: visible in Railway logs — remove once confirmed working
        print(f"[DBG] Q{qid_str} chosen='{chosen}' norm_chosen='{norm_chosen}' raw_answer='{raw_answer}' norm_answer='{norm_answer}'")

        is_correct = bool(norm_chosen) and (norm_chosen == norm_answer)
        if is_correct:
            correct_count += 1

        subj  = q.get("subject",   "Unknown")
        topic = q.get("topic",     "Unknown")
        diff  = q.get("difficulty","medium")
        if diff not in difficulty_stats:
            diff = "medium"

        subject_stats.setdefault(subj, {"correct": 0, "total": 0, "topics": {}})
        subject_stats[subj]["total"] += 1
        if is_correct:
            subject_stats[subj]["correct"] += 1

        subject_stats[subj]["topics"].setdefault(topic, {"correct": 0, "total": 0})
        subject_stats[subj]["topics"][topic]["total"] += 1
        if is_correct:
            subject_stats[subj]["topics"][topic]["correct"] += 1

        difficulty_stats[diff]["total"] += 1
        if is_correct:
            difficulty_stats[diff]["correct"] += 1

        results.append({
            "question_id":    int(qid_str),
            "subject":        subj,
            "topic":          topic,
            "difficulty":     diff,
            "question":       q.get("question",  ""),
            "choices":        q.get("choices",   []),
            "chosen":         norm_chosen,
            "correct_answer": norm_answer,
            "is_correct":     is_correct,
            "rationale":      q.get("rationale", ""),
        })

    total_q   = len(results)
    score_pct = round(correct_count / total_q * 100, 2) if total_q > 0 else 0

    # ── Single DB write block — `with` guarantees close even on error ──
    with get_db() as conn:
        c = conn.cursor()

        # Batch-insert question attempts
        c.executemany("""
            INSERT INTO question_attempts
                (session_id, question_id, subject, topic, difficulty,
                 chosen_answer, correct_answer, is_correct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            (session_id, r["question_id"], r["subject"], r["topic"],
             r["difficulty"], r["chosen"], r["correct_answer"], int(r["is_correct"]))
            for r in results
        ])

        # Named placeholders — safe regardless of column order in the table
        c.execute("""
            INSERT INTO quiz_sessions
                (session_id, username, email, mode,
                 total_questions, correct_answers, score_percent,
                 time_taken_seconds, subjects_json)
            VALUES
                (:session_id, :username, :email, :mode,
                 :total_questions, :correct_answers, :score_percent,
                 :time_taken_seconds, :subjects_json)
        """, {
            "session_id":         session_id,
            "username":           username,
            "email":              email,
            "mode":               mode,
            "total_questions":    total_q,
            "correct_answers":    correct_count,
            "score_percent":      score_pct,
            "time_taken_seconds": time_taken,
            "subjects_json":      json.dumps(subject_stats),
        })

        conn.commit()
    # connection is closed here automatically

    # Per-subject percentages
    strengths, improvements = [], []
    for subj, stats in subject_stats.items():
        pct = (stats["correct"] / stats["total"] * 100) if stats["total"] else 0
        stats["percent"] = round(pct, 1)
        (strengths if pct >= 75 else improvements).append(
            {"subject": subj, "percent": stats["percent"]}
        )

    verdict     = "PASSED" if score_pct >= 75 else "NEEDS IMPROVEMENT"
    verdict_msg = (
        "Congratulations! You passed the PNLE threshold."
        if score_pct >= 75
        else "Keep studying! Aim for 75% or higher."
    )

    # Sheets sync — non-blocking, never raises to the caller
    try:
        call_apps_script({
            "action": "submit",
            "session": {
                "session_id":        session_id,
                "username":          username,
                "email":             email,
                "mode":              mode,
                "total":             total_q,
                "correct":           correct_count,
                "percent":           score_pct,
                "verdict":           verdict,
                "time_taken":        time_taken,
                "subject_filter":    subject_filter,
                "difficulty_filter": difficulty_filter,
            },
            "subject_stats":    subject_stats,
            "difficulty_stats": difficulty_stats,
        })
    except Exception as e:
        print(f"⚠️  Sheets sync error (non-fatal): {e}")

    return jsonify({
        "session_id": session_id,
        "score": {
            "correct":     correct_count,
            "total":       total_q,
            "percent":     score_pct,
            "verdict":     verdict,
            "verdict_msg": verdict_msg,
            "time_taken":  time_taken,
        },
        "results":          results,
        "subject_stats":    subject_stats,
        "difficulty_stats": difficulty_stats,
        "analysis": {
            "strengths":         strengths,
            "needs_improvement": improvements,
        },
    })


# ─── LEADERBOARD ─────────────────────────────────────────────────

@app.route("/api/leaderboard", methods=["GET"])
def get_leaderboard():
    sheets_data = call_apps_script_get("leaderboard")
    if sheets_data.get("leaderboard"):
        lb = sheets_data["leaderboard"]
        normalized = [{
            "rank":         i + 1,
            "username":     row.get("Username")           or row.get("username", "?"),
            "best_score":   float(row.get("Best Score (%)") or row.get("best_score", 0)),
            "sessions":     int(row.get("Sessions")        or row.get("sessions", 1)),
            "avg_score":    float(row.get("Avg Score (%)")  or row.get("avg_score", 0)),
            "last_attempt": str(row.get("Last Attempt")    or row.get("last_attempt", "")),
            "verdict":      row.get("Verdict")             or row.get("verdict", ""),
        } for i, row in enumerate(lb)]
        return jsonify({"leaderboard": normalized, "source": "sheets"})

    # SQLite fallback — exam sessions only, ranked by avg score then total correct
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                username,
                COUNT(*)                                  AS exam_sessions,
                ROUND(AVG(score_percent), 1)              AS avg_score,
                MAX(score_percent)                        AS best_score,
                SUM(correct_answers)                      AS total_correct,
                SUM(total_questions)                      AS total_questions,
                MAX(created_at)                           AS last_attempt
            FROM quiz_sessions
            WHERE LOWER(mode) = 'exam'
            GROUP BY username
            HAVING exam_sessions > 0
            ORDER BY avg_score DESC, total_correct DESC, best_score DESC
            LIMIT 50
        """).fetchall()

    leaderboard = []
    for rank, row in enumerate(rows, 1):
        d = dict(row)
        d["rank"]    = rank
        d["verdict"] = "PASSED" if (d["avg_score"] or 0) >= 75 else "NEEDS IMPROVEMENT"
        leaderboard.append(d)

    return jsonify({"leaderboard": leaderboard, "source": "sqlite"})


# ─── HISTORY ─────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def get_history():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, session_id, username, total_questions,
                   correct_answers, score_percent, time_taken_seconds, created_at
            FROM quiz_sessions
            ORDER BY created_at DESC
            LIMIT 30
        """).fetchall()
    return jsonify({"history": [dict(r) for r in rows]})


# ─── RUN ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    print(f"🩺 PNLE Reviewer running at http://localhost:{port}")
    app.run(debug=False, host="0.0.0.0", port=port)
