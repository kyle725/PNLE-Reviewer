"""
PNLE Reviewer - Flask Web Application
=====================================
Run with: python app.py
Access at: http://localhost:5000
"""

from flask import Flask, render_template, jsonify, request, session
import json
import os
import sqlite3
import random
from datetime import datetime

app = Flask(__name__)
app.secret_key = "pnle-reviewer-secret-key-change-in-production"

# ─── Database Setup ────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "results.db")
QUESTIONS_PATH = os.path.join(BASE_DIR, "data", "questions.json")


def init_db():
    """Initialize SQLite database for storing quiz results."""
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
    print("✅ Database initialized at", DB_PATH)


def load_questions():
    """Load questions from JSON file."""
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


# ─── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Home / landing page."""
    data = load_questions()
    subjects = data["subjects"]
    total_q = len(data["questions"])
    return render_template("index.html", subjects=subjects, total_questions=total_q)


@app.route("/api/questions", methods=["GET"])
def get_questions():
    """
    Get a set of quiz questions.
    Query params:
      - count: number of questions (default 10, max 50)
      - subject: filter by subject (optional)
      - difficulty: easy | medium | hard (optional)
      - shuffle: true/false (default true)
    """
    data = load_questions()
    questions = data["questions"]

    subject_filter = request.args.get("subject", "").strip()
    difficulty_filter = request.args.get("difficulty", "").strip()
    count = min(int(request.args.get("count", 10)), 200)
    shuffle = request.args.get("shuffle", "true").lower() == "true"

    if subject_filter and subject_filter != "all":
        questions = [q for q in questions if q["subject"] == subject_filter]

    if difficulty_filter and difficulty_filter != "all":
        questions = [q for q in questions if q["difficulty"] == difficulty_filter]

    if shuffle:
        random.shuffle(questions)

    selected = questions[:count]

    # Strip answers before sending to client (prevent cheating)
    client_questions = []
    for q in selected:
        client_questions.append({
            "id": q["id"],
            "subject": q["subject"],
            "topic": q["topic"],
            "difficulty": q["difficulty"],
            "question": q["question"],
            "choices": q["choices"]
        })

    session["current_question_ids"] = [q["id"] for q in selected]

    return jsonify({
        "questions": client_questions,
        "total": len(client_questions)
    })


@app.route("/api/subjects", methods=["GET"])
def get_subjects():
    """Get all available subjects and question counts."""
    data = load_questions()
    questions = data["questions"]

    subject_counts = {}
    for q in questions:
        s = q["subject"]
        subject_counts[s] = subject_counts.get(s, 0) + 1

    return jsonify({
        "subjects": data["subjects"],
        "counts": subject_counts,
        "total": len(questions)
    })


@app.route("/api/submit", methods=["POST"])
def submit_quiz():
    """
    Submit quiz answers and get analysis.
    Body: {
        session_id: str,
        username: str,
        answers: { question_id: chosen_letter },
        time_taken: int (seconds)
    }
    """
    payload = request.json
    session_id = payload.get("session_id", datetime.now().strftime("%Y%m%d%H%M%S"))
    username = payload.get("username", "Guest")
    user_answers = payload.get("answers", {})
    time_taken = payload.get("time_taken", 0)

    # Load all questions to get correct answers + rationale
    data = load_questions()
    questions_by_id = {str(q["id"]): q for q in data["questions"]}

    results = []
    subject_stats = {}
    difficulty_stats = {"easy": {"correct": 0, "total": 0},
                        "medium": {"correct": 0, "total": 0},
                        "hard": {"correct": 0, "total": 0}}

    correct_count = 0

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    for qid_str, chosen in user_answers.items():
        q = questions_by_id.get(qid_str)
        if not q:
            continue

        is_correct = (chosen.strip().upper() == q["answer"].strip().upper())
        if is_correct:
            correct_count += 1

        # Subject stats
        subj = q["subject"]
        if subj not in subject_stats:
            subject_stats[subj] = {"correct": 0, "total": 0, "topics": {}}
        subject_stats[subj]["total"] += 1
        if is_correct:
            subject_stats[subj]["correct"] += 1

        # Topic stats within subject
        topic = q["topic"]
        if topic not in subject_stats[subj]["topics"]:
            subject_stats[subj]["topics"][topic] = {"correct": 0, "total": 0}
        subject_stats[subj]["topics"][topic]["total"] += 1
        if is_correct:
            subject_stats[subj]["topics"][topic]["correct"] += 1

        # Difficulty stats
        diff = q["difficulty"]
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

        # Save to DB
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

    # Build analysis
    strengths = []
    improvements = []
    for subj, stats in subject_stats.items():
        pct = (stats["correct"] / stats["total"] * 100) if stats["total"] > 0 else 0
        stats["percent"] = round(pct, 1)
        if pct >= 75:
            strengths.append({"subject": subj, "percent": round(pct, 1)})
        else:
            improvements.append({"subject": subj, "percent": round(pct, 1)})

    strengths.sort(key=lambda x: -x["percent"])
    improvements.sort(key=lambda x: x["percent"])

    # Performance label
    if score_pct >= 75:
        verdict = "PASSED" 
        verdict_msg = "Congratulations! You passed the PNLE threshold."
    else:
        verdict = "NEEDS IMPROVEMENT"
        verdict_msg = "Keep studying! You need 75% or higher to pass."

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


@app.route("/api/history", methods=["GET"])
def get_history():
    """Get past quiz session summaries."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""
        SELECT id, session_id, username, total_questions, correct_answers,
               score_percent, time_taken_seconds, created_at
        FROM quiz_sessions
        ORDER BY created_at DESC
        LIMIT 20
    """)
    rows = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify({"history": rows})


@app.route("/api/analytics/overall", methods=["GET"])
def get_overall_analytics():
    """Get overall performance analytics across all sessions."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        SELECT subject, topic, 
               COUNT(*) as total,
               SUM(is_correct) as correct
        FROM question_attempts
        GROUP BY subject, topic
        ORDER BY subject, topic
    """)
    rows = c.fetchall()

    subject_map = {}
    for subject, topic, total, correct in rows:
        if subject not in subject_map:
            subject_map[subject] = {"total": 0, "correct": 0, "topics": {}}
        subject_map[subject]["total"] += total
        subject_map[subject]["correct"] += correct
        subject_map[subject]["topics"][topic] = {
            "total": total,
            "correct": correct,
            "percent": round(correct / total * 100, 1) if total > 0 else 0
        }

    for s in subject_map.values():
        s["percent"] = round(s["correct"] / s["total"] * 100, 1) if s["total"] > 0 else 0

    c.execute("SELECT AVG(score_percent), COUNT(*) FROM quiz_sessions")
    avg_score, total_sessions = c.fetchone()
    conn.close()

    return jsonify({
        "subject_performance": subject_map,
        "avg_score": round(avg_score or 0, 1),
        "total_sessions": total_sessions or 0
    })


# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("\n🩺 PNLE Reviewer is running!")
    print("📖 Open http://localhost:5000 in your browser\n")
    app.run(debug=True, port=5000)
