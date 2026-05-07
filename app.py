"""
PNLE Reviewer - Flask Web Application
Google Sheets integration via Google Apps Script Web App (no service account needed).

Required env vars (Railway):
  APPS_SCRIPT_URL  - The deployed Apps Script web app URL
  SECRET_KEY       - Any random string
"""

from flask import Flask, render_template, jsonify, request, session
import json
import os
import sqlite3
import random
import requests as http_requests
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "pnle-reviewer-secret-key-change-in-production")

BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
DB_PATH        = os.path.join(BASE_DIR, "data", "results.db")
QUESTIONS_PATH = os.path.join(BASE_DIR, "data", "questions.json")

# Google Apps Script Web App URL (set this in Railway Variables)
APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "")


# ─── Apps Script helper ─────────────────────────────────────────────

def call_apps_script(payload: dict) -> dict:
    """POST to the Apps Script web app. Returns {} on failure."""
    if not APPS_SCRIPT_URL:
        print("⚠️  APPS_SCRIPT_URL not set — skipping Sheets sync.")
        return {}
    try:
        resp = http_requests.post(
            APPS_SCRIPT_URL,
            json=payload,
            timeout=15,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Apps Script call failed: {e}")
        return {}


def call_apps_script_get(action: str) -> dict:
    """GET request to Apps Script (for leaderboard / history reads)."""
    if not APPS_SCRIPT_URL:
        return {}
    try:
        resp = http_requests.get(
            APPS_SCRIPT_URL,
            params={"action": action},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"⚠️  Apps Script GET failed: {e}")
        return {}


# ─── DATABASE SETUP ────────────────────────────────────────────────

def init_db():
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS quiz_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            username TEXT DEFAULT 'Guest',
            total_questions INTEGER,
            correct_answers INTEGER,
            score_percent REAL,
            time_taken_seconds INTEGER,
            subjects_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

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
    conn.close()
    print("✅ Database initialized")


def load_questions():
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ─── ROUTES ────────────────────────────────────────────────────────

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
    data = load_questions()
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

    return jsonify({
        "questions": [{
            "id": q["id"], "subject": q["subject"], "topic": q["topic"],
            "difficulty": q["difficulty"], "question": q["question"],
            "choices": q["choices"],
        } for q in selected],
        "total": len(selected)
    })


# ─── SUBMIT QUIZ ───────────────────────────────────────────────────

@app.route("/api/submit", methods=["POST"])
def submit_quiz():
    payload       = request.json
    session_id    = payload.get("session_id", str(datetime.now().timestamp()))
    username      = payload.get("username", "Guest")
    user_answers  = payload.get("answers", {})
    time_taken    = payload.get("time_taken", 0)
    subject_filter     = payload.get("subject_filter", "All")
    difficulty_filter  = payload.get("difficulty_filter", "All")

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

    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()

    for qid_str, chosen in user_answers.items():
        q = qmap.get(qid_str)
        if not q:
            continue

        is_correct = (chosen.upper() == q["answer"].upper())
        if is_correct:
            correct_count += 1

        subj  = q["subject"]
        topic = q["topic"]
        diff  = q["difficulty"]

        if subj not in subject_stats:
            subject_stats[subj] = {"correct": 0, "total": 0, "topics": {}}
        subject_stats[subj]["total"] += 1
        if is_correct:
            subject_stats[subj]["correct"] += 1

        if topic not in subject_stats[subj]["topics"]:
            subject_stats[subj]["topics"][topic] = {"correct": 0, "total": 0}
        subject_stats[subj]["topics"][topic]["total"] += 1
        if is_correct:
            subject_stats[subj]["topics"][topic]["correct"] += 1

        difficulty_stats[diff]["total"] += 1
        if is_correct:
            difficulty_stats[diff]["correct"] += 1

        results.append({
            "question_id": int(qid_str),
            "subject": subj, "topic": topic, "difficulty": diff,
            "question": q["question"], "choices": q["choices"],
            "chosen": chosen, "correct_answer": q["answer"],
            "is_correct": is_correct, "rationale": q["rationale"],
        })

        c.execute("""
            INSERT INTO question_attempts
            (session_id, question_id, subject, topic, difficulty,
             chosen_answer, correct_answer, is_correct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_id, int(qid_str), subj, topic, diff,
              chosen, q["answer"], int(is_correct)))

    total_q   = len(results)
    score_pct = round((correct_count / total_q * 100), 2) if total_q > 0 else 0

    c.execute("""
        INSERT INTO quiz_sessions
        (session_id, username, total_questions, correct_answers,
         score_percent, time_taken_seconds, subjects_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (session_id, username, total_q, correct_count,
          score_pct, time_taken, json.dumps(subject_stats)))
    conn.commit()
    conn.close()

    # Per-subject percent
    strengths    = []
    improvements = []
    for subj, stats in subject_stats.items():
        pct = (stats["correct"] / stats["total"] * 100) if stats["total"] else 0
        stats["percent"] = round(pct, 1)
        if pct >= 75:
            strengths.append({"subject": subj, "percent": stats["percent"]})
        else:
            improvements.append({"subject": subj, "percent": stats["percent"]})

    verdict     = "PASSED" if score_pct >= 75 else "NEEDS IMPROVEMENT"
    verdict_msg = (
        "Congratulations! You passed the PNLE threshold."
        if score_pct >= 75
        else "Keep studying! Aim for 75% or higher."
    )

    # ── Sync to Google Sheets via Apps Script (non-blocking) ──────
    try:
        call_apps_script({
            "action": "submit",
            "session": {
                "session_id":        session_id,
                "username":          username,
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
            "correct": correct_count, "total": total_q,
            "percent": score_pct, "verdict": verdict,
            "verdict_msg": verdict_msg, "time_taken": time_taken,
        },
        "results": results,
        "subject_stats": subject_stats,
        "difficulty_stats": difficulty_stats,
        "analysis": {"strengths": strengths, "needs_improvement": improvements},
    })


# ─── LEADERBOARD ──────────────────────────────────────────────────

@app.route("/api/leaderboard", methods=["GET"])
def get_leaderboard():
    # Try Apps Script first (source of truth), fall back to SQLite
    sheets_data = call_apps_script_get("leaderboard")
    if sheets_data.get("leaderboard"):
        lb = sheets_data["leaderboard"]
        # Normalize column names from Sheets → expected by frontend
        normalized = []
        for i, row in enumerate(lb):
            normalized.append({
                "rank":         i + 1,
                "username":     row.get("Username") or row.get("username", "?"),
                "best_score":   float(row.get("Best Score (%)") or row.get("best_score", 0)),
                "sessions":     int(row.get("Sessions") or row.get("sessions", 1)),
                "avg_score":    float(row.get("Avg Score (%)") or row.get("avg_score", 0)),
                "last_attempt": str(row.get("Last Attempt") or row.get("last_attempt", "")),
                "verdict":      row.get("Verdict") or row.get("verdict", ""),
            })
        return jsonify({"leaderboard": normalized, "source": "sheets"})

    # SQLite fallback
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT
            username,
            MAX(score_percent)           AS best_score,
            COUNT(*)                     AS sessions,
            ROUND(AVG(score_percent), 1) AS avg_score,
            MAX(created_at)              AS last_attempt
        FROM quiz_sessions
        GROUP BY username
        ORDER BY best_score DESC, avg_score DESC
        LIMIT 50
    """).fetchall()
    conn.close()

    leaderboard = []
    for rank, row in enumerate(rows, 1):
        d = dict(row)
        d["rank"]    = rank
        d["verdict"] = "PASSED" if d["best_score"] >= 75 else "NEEDS IMPROVEMENT"
        leaderboard.append(d)

    return jsonify({"leaderboard": leaderboard, "source": "sqlite"})


# ─── HISTORY ───────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
def get_history():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT id, session_id, username, total_questions,
               correct_answers, score_percent,
               time_taken_seconds, created_at
        FROM quiz_sessions
        ORDER BY created_at DESC
        LIMIT 30
    """).fetchall()
    conn.close()
    return jsonify({"history": [dict(r) for r in rows]})


# ─── RUN ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    print(f"🩺 PNLE Reviewer running at http://localhost:{port}")
    app.run(debug=False, host="0.0.0.0", port=port)
