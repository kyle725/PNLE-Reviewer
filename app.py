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

def _ensure_db():
    try:
        os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"), exist_ok=True)
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

        existing_cols = {row[1] for row in c.execute("PRAGMA table_info(quiz_sessions)")}
        for col, defn in [
            ("email", "TEXT DEFAULT ''"),
            ("mode",  "TEXT DEFAULT 'practice'"),
        ]:
            if col not in existing_cols:
                c.execute(f"ALTER TABLE quiz_sessions ADD COLUMN {col} {defn}")
                print(f"✅ Migrated: added column '{col}'")

        c.execute("""
            CREATE TABLE IF NOT EXISTS question_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                question_id INTEGER NOT NULL,
                subject TEXT,
                subcategory TEXT,
                difficulty TEXT,
                chosen_answer TEXT,
                correct_answer TEXT,
                is_correct INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migrate question_attempts: rename topic -> subcategory if needed
        qa_cols = {row[1] for row in c.execute("PRAGMA table_info(question_attempts)")}
        if "topic" in qa_cols and "subcategory" not in qa_cols:
            c.execute("ALTER TABLE question_attempts RENAME COLUMN topic TO subcategory")
            print("✅ Migrated: renamed column 'topic' -> 'subcategory' in question_attempts")
        elif "subcategory" not in qa_cols:
            c.execute("ALTER TABLE question_attempts ADD COLUMN subcategory TEXT")
            print("✅ Migrated: added column 'subcategory' to question_attempts")

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
    data       = load_questions()
    questions  = data["questions"]
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

    return jsonify({
        "questions": [{
            "id":          q["id"],
            "subject":     q["subject"],
            "subcategory": q.get("subcategory", ""),
            "difficulty":  q["difficulty"],
            "stem":        q.get("stem", ""),
            "choices":     q["choices"],
            "answer":      q.get("answer", ""),
            "rationale":   q.get("rationale", ""),
            "choice_rationales": q.get("choice_rationales", []),
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

    for qid_str, chosen in user_answers.items():
        q = qmap.get(str(qid_str))
        if not q:
            continue

        chosen = (chosen or "").strip()

        raw_answer  = q.get("answer", "").strip()
        norm_answer = raw_answer[0].upper() if raw_answer else ""
        norm_chosen = chosen[0].upper()     if chosen     else ""

        print(f"[DBG] Q{qid_str} chosen='{chosen}' norm_chosen='{norm_chosen}' raw_answer='{raw_answer}' norm_answer='{norm_answer}'")

        is_correct = bool(norm_chosen) and (norm_chosen == norm_answer)
        if is_correct:
            correct_count += 1

        subj        = q.get("subject",     "Unknown")
        subcategory = q.get("subcategory", "Unknown")
        diff        = q.get("difficulty",  "medium")
        if diff not in difficulty_stats:
            diff = "medium"

        subject_stats.setdefault(subj, {"correct": 0, "total": 0, "subcategories": {}})
        subject_stats[subj]["total"] += 1
        if is_correct:
            subject_stats[subj]["correct"] += 1

        subject_stats[subj]["subcategories"].setdefault(subcategory, {"correct": 0, "total": 0})
        subject_stats[subj]["subcategories"][subcategory]["total"] += 1
        if is_correct:
            subject_stats[subj]["subcategories"][subcategory]["correct"] += 1

        difficulty_stats[diff]["total"] += 1
        if is_correct:
            difficulty_stats[diff]["correct"] += 1

        results.append({
            "question_id":    int(qid_str),
            "subject":        subj,
            "subcategory":    subcategory,
            "difficulty":     diff,
            "stem":           q.get("stem",    ""),
            "choices":        q.get("choices", []),
            "chosen":         norm_chosen,
            "correct_answer": norm_answer,
            "is_correct":     is_correct,
            "rationale":      q.get("rationale", ""),
            "choice_rationales": q.get("choice_rationales", []),
        })

    total_q   = len(results)
    score_pct = round(correct_count / total_q * 100, 2) if total_q > 0 else 0

    with get_db() as conn:
        c = conn.cursor()

        c.executemany("""
            INSERT INTO question_attempts
                (session_id, question_id, subject, subcategory, difficulty,
                 chosen_answer, correct_answer, is_correct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            (session_id, r["question_id"], r["subject"], r["subcategory"],
             r["difficulty"], r["chosen"], r["correct_answer"], int(r["is_correct"]))
            for r in results
        ])

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
            "username":     row.get("Username")            or row.get("username", "?"),
            "best_score":   float(row.get("Best Score (%)") or row.get("best_score", 0)),
            "sessions":     int(row.get("Sessions")         or row.get("sessions", 1)),
            "avg_score":    float(row.get("Avg Score (%)")   or row.get("avg_score", 0)),
            "last_attempt": str(row.get("Last Attempt")     or row.get("last_attempt", "")),
            "verdict":      row.get("Verdict")              or row.get("verdict", ""),
        } for i, row in enumerate(lb)]
        return jsonify({"leaderboard": normalized, "source": "sheets"})

    # SQLite fallback:
    # Primary rank: avg_score (consistency across all attempts).
    # Tiebreaker 1: best_score (peak performance).
    # Tiebreaker 2: total_correct (volume of right answers).
    # Exam sessions only; exclude sessions with 0 questions.
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                username,
                COUNT(*)                                  AS exam_sessions,
                ROUND(AVG(score_percent), 1)              AS avg_score,
                ROUND(MAX(score_percent), 1)              AS best_score,
                SUM(correct_answers)                      AS total_correct,
                SUM(total_questions)                      AS total_questions,
                MAX(created_at)                           AS last_attempt
            FROM quiz_sessions
            WHERE LOWER(mode) = 'exam'
              AND total_questions > 0
            GROUP BY username
            ORDER BY avg_score DESC, best_score DESC, total_correct DESC
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


# ─── PING SHEETS (debug helper) ──────────────────────────────────

@app.route("/api/ping-sheets", methods=["GET"])
def ping_sheets():
    if not APPS_SCRIPT_URL:
        return jsonify({"status": "no_url", "message": "APPS_SCRIPT_URL env var not set"})
    try:
        resp = http_requests.get(APPS_SCRIPT_URL, params={"action": "ping"}, timeout=10)
        return jsonify({"status": "ok", "http_code": resp.status_code, "body": resp.json()})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})


# ─── RUN ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    print(f"🩺 PNLE Reviewer running at http://localhost:{port}")
    app.run(debug=False, host="0.0.0.0", port=port)
