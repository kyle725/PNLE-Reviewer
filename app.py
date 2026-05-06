"""
PNLE Reviewer - Flask Web Application (with Google Sheets Integration)
Run with: python app.py
"""

from flask import Flask, render_template, jsonify, request, session
import json
import os
import sqlite3
import random
from datetime import datetime

# 🔥 Google Sheets
import gspread
from google.oauth2.service_account import Credentials


app = Flask(__name__)
app.secret_key = "pnle-reviewer-secret-key-change-in-production"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "results.db")
QUESTIONS_PATH = os.path.join(BASE_DIR, "data", "questions.json")

# 🔥 YOUR GOOGLE SHEET ID
SHEET_ID = "17HbvrlHqS2I3YYjm_FgzNLgk0OnQEml-IaTSGP71xDs"


# ─── GOOGLE SHEETS SETUP ─────────────────────────────────────────────

def get_sheet():
    scope = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]

    creds = Credentials.from_service_account_file(
        "credentials.json", scopes=scope
    )

    client = gspread.authorize(creds)

    return client.open_by_key(SHEET_ID).sheet1


# ─── DATABASE ────────────────────────────────────────────────────────

def init_db():
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS quiz_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            username TEXT,
            total_questions INTEGER,
            correct_answers INTEGER,
            score_percent REAL,
            time_taken_seconds INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()


def load_questions():
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ─── ROUTES ──────────────────────────────────────────────────────────

@app.route("/")
def index():
    data = load_questions()
    return render_template(
        "index.html",
        subjects=data["subjects"],
        total_questions=len(data["questions"])
    )


@app.route("/api/questions")
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

    return jsonify({
        "questions": [{
            "id": q["id"],
            "subject": q["subject"],
            "topic": q["topic"],
            "difficulty": q["difficulty"],
            "question": q["question"],
            "choices": q["choices"]
        } for q in selected]
    })


# ─── SUBMIT QUIZ ─────────────────────────────────────────────────────

@app.route("/api/submit", methods=["POST"])
def submit_quiz():
    payload = request.json

    session_id = payload.get("session_id", str(datetime.now().timestamp()))
    username = payload.get("username", "Guest")
    answers = payload.get("answers", {})
    time_taken = payload.get("time_taken", 0)

    data = load_questions()
    qmap = {str(q["id"]): q for q in data["questions"]}

    correct = 0
    results = []

    for qid, chosen in answers.items():
        q = qmap.get(qid)
        if not q:
            continue

        is_correct = chosen == q["answer"]
        if is_correct:
            correct += 1

        results.append({
            "question": q["question"],
            "correct_answer": q["answer"],
            "chosen": chosen,
            "is_correct": is_correct,
            "rationale": q["rationale"]
        })

    total = len(results)
    percent = round((correct / total * 100), 2) if total else 0

    # ─── SAVE TO SQLITE ─────────────────
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        INSERT INTO quiz_sessions
        (session_id, username, total_questions, correct_answers, score_percent, time_taken_seconds)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (session_id, username, total, correct, percent, time_taken))

    conn.commit()
    conn.close()

    # ─── SAVE TO GOOGLE SHEETS ──────────
    try:
        sheet = get_sheet()

        sheet.append_row([
            session_id,
            username,
            correct,
            total,
            percent,
            time_taken,
            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ])

    except Exception as e:
        print("⚠️ Google Sheets Error:", e)

    # ─── RESPONSE ───────────────────────
    return jsonify({
        "score": {
            "correct": correct,
            "total": total,
            "percent": percent,
            "verdict": "PASSED" if percent >= 75 else "FAILED"
        },
        "results": results
    })


# ─── HISTORY ─────────────────────────────────────────────────────────

@app.route("/api/history")
def history():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM quiz_sessions ORDER BY created_at DESC LIMIT 20").fetchall()
    conn.close()

    return jsonify({"history": [dict(r) for r in rows]})


# ─── RUN ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("🩺 PNLE Reviewer running at http://localhost:5000")
    app.run(debug=True)
