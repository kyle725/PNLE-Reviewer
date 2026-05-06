"""
PNLE Reviewer - Flask Web Application (SQLite Only)
Run with: python app.py
"""

from flask import Flask, render_template, jsonify, request, session
import json
import os
import sqlite3
import random
from datetime import datetime

app = Flask(__name__)
app.secret_key = "pnle-reviewer-secret-key-change-in-production"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "results.db")
QUESTIONS_PATH = os.path.join(BASE_DIR, "data", "questions.json")


# ─── DATABASE SETUP ────────────────────────────────────────────────

def init_db():
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Session summary
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

    # Per-question tracking
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

    subject = request.args.get("subject", "")
    difficulty = request.args.get("difficulty", "")
    count = min(int(request.args.get("count", 10)), 200)

    if subject and subject != "all":
        questions = [q for q in questions if q["subject"] == subject]

    if difficulty and difficulty != "all":
        questions = [q for q in questions if q["difficulty"] == difficulty]

    random.shuffle(questions)
    selected = questions[:count]

    session["current_question_ids"] = [q["id"] for q in selected]

    return jsonify({
        "questions": [{
            "id": q["id"],
            "subject": q["subject"],
            "topic": q["topic"],
            "difficulty": q["difficulty"],
            "question": q["question"],
            "choices": q["choices"]
        } for q in selected],
        "total": len(selected)
    })


# ─── SUBMIT QUIZ ───────────────────────────────────────────────────

@app.route("/api/submit", methods=["POST"])
def submit_quiz():
    payload = request.json

    session_id = payload.get("session_id", str(datetime.now().timestamp()))
    username = payload.get("username", "Guest")
    user_answers = payload.get("answers", {})
    time_taken = payload.get("time_taken", 0)

    data = load_questions()
    qmap = {str(q["id"]): q for q in data["questions"]}

    results = []
    subject_stats = {}
    difficulty_stats = {
        "easy": {"correct": 0, "total": 0},
        "medium": {"correct": 0, "total": 0},
        "hard": {"correct": 0, "total": 0}
    }

    correct_count = 0

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    for qid_str, chosen in user_answers.items():
        q = qmap.get(qid_str)
        if not q:
            continue

        is_correct = (chosen.upper() == q["answer"].upper())
        if is_correct:
            correct_count += 1

        subj = q["subject"]
        topic = q["topic"]
        diff = q["difficulty"]

        # Subject stats
        if subj not in subject_stats:
            subject_stats[subj] = {"correct": 0, "total": 0, "topics": {}}

        subject_stats[subj]["total"] += 1
        if is_correct:
            subject_stats[subj]["correct"] += 1

        # Topic stats
        if topic not in subject_stats[subj]["topics"]:
            subject_stats[subj]["topics"][topic] = {"correct": 0, "total": 0}

        subject_stats[subj]["topics"][topic]["total"] += 1
        if is_correct:
            subject_stats[subj]["topics"][topic]["correct"] += 1

        # Difficulty stats
        difficulty_stats[diff]["total"] += 1
        if is_correct:
            difficulty_stats[diff]["correct"] += 1

        results.append({
            "question_id": int(qid_str),
            "subject": subj,
            "topic": topic,
            "difficulty": diff,
            "question": q["question"],
            "choices": q["choices"],
            "chosen": chosen,
            "correct_answer": q["answer"],
            "is_correct": is_correct,
            "rationale": q["rationale"]
        })

        # Save per-question attempt
        c.execute("""
            INSERT INTO question_attempts
            (session_id, question_id, subject, topic, difficulty, chosen_answer, correct_answer, is_correct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_id, int(qid_str), subj, topic, diff, chosen, q["answer"], int(is_correct)))

    total_q = len(results)
    score_pct = round((correct_count / total_q * 100), 2) if total_q > 0 else 0

    # Save session summary
    c.execute("""
        INSERT INTO quiz_sessions
        (session_id, username, total_questions, correct_answers, score_percent, time_taken_seconds, subjects_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (session_id, username, total_q, correct_count, score_pct, time_taken, json.dumps(subject_stats)))

    conn.commit()
    conn.close()

    # Analysis
    strengths = []
    improvements = []

    for subj, stats in subject_stats.items():
        pct = (stats["correct"] / stats["total"] * 100) if stats["total"] else 0
        stats["percent"] = round(pct, 1)

        if pct >= 75:
            strengths.append({"subject": subj, "percent": stats["percent"]})
        else:
            improvements.append({"subject": subj, "percent": stats["percent"]})

    verdict = "PASSED" if score_pct >= 75 else "NEEDS IMPROVEMENT"
    verdict_msg = (
        "Congratulations! You passed the PNLE threshold."
        if score_pct >= 75
        else "Keep studying! Aim for 75% or higher."
    )

    return jsonify({
        "session_id": session_id,
        "score": {
            "correct": correct_count,
            "total": total_q,
            "percent": score_pct,
            "verdict": verdict,
            "verdict_msg": verdict_msg,
            "time_taken": time_taken
        },
        "results": results,
        "subject_stats": subject_stats,
        "difficulty_stats": difficulty_stats,
        "analysis": {
            "strengths": strengths,
            "needs_improvement": improvements
        }
    })


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
        LIMIT 20
    """).fetchall()

    conn.close()
    return jsonify({"history": [dict(r) for r in rows]})


# ─── RUN ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("🩺 PNLE Reviewer running at http://localhost:5000")
    app.run(debug=True)
