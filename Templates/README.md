# 🩺 PNLE Reviewer — NurseUp

A full-featured PNLE (Philippine Nursing Licensure Exam) reviewer web app with performance analytics.

---

## 🚀 Quick Start

### 1. Install requirements
```bash
pip install flask
```

### 2. Run the app
```bash
cd pnle-reviewer
python app.py
```

### 3. Open in browser
```
http://localhost:5000
```

---

## 📁 Project Structure

```
pnle-reviewer/
├── app.py                  ← Flask backend (all API routes)
├── requirements.txt
├── data/
│   ├── questions.json      ← ⭐ ADD YOUR QUESTIONS HERE
│   └── results.db          ← Auto-created SQLite database
├── templates/
│   └── index.html          ← Main HTML
└── static/
    ├── css/style.css
    └── js/app.js
```

---

## ➕ How to Add Questions

Open `data/questions.json` and add entries to the `"questions"` array.

### Question Format:
```json
{
  "id": 16,
  "subject": "Fundamentals of Nursing",
  "topic": "Patient Safety",
  "difficulty": "easy",
  "question": "Your question text goes here?",
  "choices": [
    "A. First choice",
    "B. Second choice",
    "C. Third choice",
    "D. Fourth choice"
  ],
  "answer": "B",
  "rationale": "Explanation of why B is correct and why the others are wrong."
}
```

### Rules:
- `id` must be **unique** (increment from last number)
- `subject` must match one of the subjects in the `"subjects"` array (or add a new one)
- `difficulty` must be: `"easy"`, `"medium"`, or `"hard"`
- `answer` is just the letter: `"A"`, `"B"`, `"C"`, or `"D"`
- `choices` should start with the letter (e.g., `"A. Choice text"`)

### Adding a New Subject:
Add it to the `"subjects"` array at the top of `questions.json`:
```json
"subjects": [
  "Fundamentals of Nursing",
  "Your New Subject Here"
]
```

---

## 📊 Features

- **Quiz Modes**: Filter by subject, difficulty, and number of questions
- **Timer**: Tracks how long each session takes
- **Instant Feedback**: Shows correct/incorrect after submission
- **Rationale**: Detailed explanation for every question
- **Analysis Dashboard**:
  - Overall score with pass/fail indicator (75% threshold)
  - Strength subjects vs. subjects needing improvement
  - Subject-by-subject breakdown with bar charts
  - Performance by difficulty level (Easy / Medium / Hard)
- **Review Screen**: Full question-by-question review with rationale
- **History**: Saves all past sessions to SQLite database

---

## 🗄️ Database

Results are automatically saved to `data/results.db` (SQLite).

Tables:
- `quiz_sessions` — summary of each quiz attempt
- `question_attempts` — individual answer records

You can open this with DB Browser for SQLite or any SQLite viewer.

---

## 🔧 Customization

- **Change passing score**: Edit `score_pct >= 75` in `app.py` (line ~130)
- **Max questions per session**: Edit `min(..., 50)` in `app.py`
- **Add more question types**: Extend the JSON format and update `app.py`/`app.js`
