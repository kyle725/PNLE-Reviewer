// ─── Sound Engine ────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _ctx = null;

function ctx() {
  if (!_ctx) _ctx = new AudioCtx();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

function playTone(freq, type, duration, volume = 0.18, delay = 0) {
  try {
    const c    = ctx();
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    gain.gain.setValueAtTime(0, c.currentTime + delay);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.05);
  } catch (_) {}
}

const SFX = {
  correct() {
    // Rising major chord arpeggio
    playTone(523.25, "sine", 0.13, 0.16);
    playTone(659.25, "sine", 0.13, 0.16, 0.10);
    playTone(783.99, "sine", 0.20, 0.16, 0.20);
    playTone(1046.5, "sine", 0.15, 0.12, 0.32);
  },
  incorrect() {
    // Descending dissonance
    playTone(300, "sawtooth", 0.09, 0.14);
    playTone(250, "sawtooth", 0.10, 0.14, 0.10);
    playTone(200, "sawtooth", 0.14, 0.12, 0.22);
  },
  select() {
    playTone(880, "sine", 0.06, 0.10);
    playTone(1100, "sine", 0.05, 0.08, 0.07);
  },
  navigate() {
    playTone(528, "sine", 0.07, 0.08);
  },
  start() {
    // Upbeat two-tone
    playTone(440, "triangle", 0.08, 0.12);
    playTone(660, "triangle", 0.12, 0.14, 0.10);
    playTone(880, "triangle", 0.10, 0.12, 0.22);
  },
  pass() {
    // Full triumphant fanfare
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      playTone(f, "sine", 0.28, 0.17, i * 0.11);
    });
    playTone(1318.5, "sine",     0.18, 0.18, 0.46);
    playTone(1046.5, "triangle", 0.55, 0.22, 0.60);
    playTone(1318.5, "triangle", 0.40, 0.20, 0.90);
  },
  fail() {
    // Sad descending notes
    playTone(392,    "triangle", 0.18, 0.15);
    playTone(349.23, "triangle", 0.18, 0.15, 0.20);
    playTone(311.13, "triangle", 0.18, 0.15, 0.40);
    playTone(261.63, "triangle", 0.35, 0.15, 0.60);
  },
  submit() {
    playTone(660,  "sine", 0.08, 0.13);
    playTone(880,  "sine", 0.08, 0.13, 0.10);
    playTone(1100, "sine", 0.16, 0.13, 0.20);
  },
  leaderboard() {
    // Fanfare-lite
    [523.25, 659.25, 783.99].forEach((f, i) => {
      playTone(f, "sine", 0.15, 0.14, i * 0.09);
    });
  },
  tick() {
    // Subtle timer tick for last 10s (optional usage)
    playTone(1200, "square", 0.03, 0.06);
  },
};

// ─── State ──────────────────────────────────────────────────────
const State = {
  questions:       [],
  answers:         {},
  currentIndex:    0,
  timerInterval:   null,
  elapsedSeconds:  0,
  sessionId:       null,
  username:        "Nurse",
  subjectFilter:   "all",
  difficultyFilter:"all",
};

// ─── History Password ────────────────────────────────────────────
const HISTORY_PASSWORD = "nurseup2025";
let historyUnlocked = false;

// ─── Screen Management ───────────────────────────────────────────
function showScreen(id) {
  if (id === "screen-history" && !historyUnlocked) {
    showPasswordModal();
    return;
  }
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
  if (id === "screen-history")     loadHistory();
  if (id === "screen-leaderboard") { loadLeaderboard(); SFX.leaderboard(); }
}

// ─── Password Modal ──────────────────────────────────────────────
function showPasswordModal() {
  document.getElementById("password-input").value = "";
  document.getElementById("password-error").textContent = "";
  document.getElementById("password-modal-overlay").classList.add("active");
  setTimeout(() => document.getElementById("password-input").focus(), 100);
}
function closePasswordModal() {
  document.getElementById("password-modal-overlay").classList.remove("active");
}
function submitPassword() {
  const entered = document.getElementById("password-input").value;
  if (entered === HISTORY_PASSWORD) {
    historyUnlocked = true;
    closePasswordModal();
    showScreen("screen-history");
  } else {
    document.getElementById("password-error").textContent = "Incorrect password.";
    document.getElementById("password-input").value = "";
    document.getElementById("password-input").focus();
    const modal = document.querySelector(".password-modal");
    modal.classList.add("shake");
    setTimeout(() => modal.classList.remove("shake"), 500);
    SFX.incorrect();
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const pw = document.getElementById("password-input");
  if (pw) pw.addEventListener("keydown", e => { if (e.key === "Enter") submitPassword(); });
});
function leaveHistory() {
  historyUnlocked = false;
  showScreen("screen-home");
}

// ─── Pill Groups ─────────────────────────────────────────────────
document.querySelectorAll(".pill-group").forEach(group => {
  group.querySelectorAll(".pill").forEach(btn => {
    btn.addEventListener("click", () => {
      group.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      SFX.select();
    });
  });
});

// ─── Start Quiz ──────────────────────────────────────────────────
async function startQuiz() {
  const subject    = document.getElementById("subject-select").value;
  const difficulty = document.querySelector("#diff-group .pill.active")?.dataset.value || "all";
  const count      = parseInt(document.querySelector("#count-group .pill.active")?.dataset.value || 25);

  State.username        = document.getElementById("username").value.trim() || "Nurse";
  State.sessionId       = "SES_" + Date.now();
  State.answers         = {};
  State.currentIndex    = 0;
  State.elapsedSeconds  = 0;
  State.subjectFilter   = subject;
  State.difficultyFilter = difficulty;

  SFX.start();

  try {
    const params = new URLSearchParams({ subject, difficulty, count });
    const res  = await fetch(`/api/questions?${params}`);
    const data = await res.json();

    if (!data.questions || data.questions.length === 0) {
      alert("No questions found for this filter. Try different settings.");
      return;
    }

    State.questions = data.questions;
    showScreen("screen-quiz");
    renderQuestion();
    startTimer();
  } catch (err) {
    alert("Failed to load questions. Is the Flask server running?");
    console.error(err);
  }
}

// ─── Timer ───────────────────────────────────────────────────────
function startTimer() {
  clearInterval(State.timerInterval);
  document.getElementById("quiz-timer").textContent = "00:00";
  State.timerInterval = setInterval(() => {
    State.elapsedSeconds++;
    const m = Math.floor(State.elapsedSeconds / 60).toString().padStart(2, "0");
    const s = (State.elapsedSeconds % 60).toString().padStart(2, "0");
    document.getElementById("quiz-timer").textContent = `${m}:${s}`;
  }, 1000);
}
function stopTimer() { clearInterval(State.timerInterval); }

// ─── Render Question ─────────────────────────────────────────────
function renderQuestion() {
  const q     = State.questions[State.currentIndex];
  const total = State.questions.length;
  const idx   = State.currentIndex;

  const pct = ((idx + 1) / total) * 100;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-text").textContent = `${idx + 1} / ${total}`;

  document.getElementById("q-subject").textContent = q.subject;
  document.getElementById("q-topic").textContent   = q.topic;

  const diffBadge   = document.getElementById("q-diff");
  diffBadge.textContent = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
  const diffColors  = {
    easy:   { bg: "#e6f7f5", color: "#00a896", border: "#00a896" },
    medium: { bg: "#fff8e7", color: "#a07000", border: "#f0a500" },
    hard:   { bg: "#fdecea", color: "#e63946", border: "#e63946" },
  };
  const dc = diffColors[q.difficulty] || diffColors.easy;
  diffBadge.style.background  = dc.bg;
  diffBadge.style.color       = dc.color;
  diffBadge.style.borderColor = dc.border;

  document.getElementById("q-number").textContent     = `Question ${idx + 1}`;
  document.getElementById("question-text").textContent = q.question;

  const container = document.getElementById("choices-container");
  container.innerHTML = "";

  const oldRationale = document.querySelector(".rationale-box");
  if (oldRationale) oldRationale.remove();

  const letters       = ["A", "B", "C", "D", "E"];
  const alreadyChosen = State.answers[q.id];

  const hint = document.createElement("p");
  hint.className   = "change-hint";
  hint.textContent = alreadyChosen
    ? "✏️ You can still change your answer before submitting."
    : "Select an answer below.";
  container.appendChild(hint);

  q.choices.forEach((choice, i) => {
    const letter = letters[i];
    const btn    = document.createElement("button");
    btn.className      = "choice-btn";
    btn.dataset.letter = letter;
    const choiceText   = choice.replace(/^[A-E]\.\s*/, "");
    btn.innerHTML      = `<span class="choice-letter">${letter}</span><span>${choiceText}</span>`;
    if (letter === alreadyChosen) btn.classList.add("selected");
    btn.addEventListener("click", () => selectAnswer(q.id, letter));
    container.appendChild(btn);
  });

  renderDots();
  document.getElementById("btn-prev").disabled = (idx === 0);

  const isLast  = (idx === total - 1);
  const btnNext = document.getElementById("btn-next");
  if (isLast) {
    const allAnswered = State.questions.every(qq => State.answers[qq.id] !== undefined);
    btnNext.textContent = "Submit Quiz ✓";
    btnNext.onclick     = submitQuiz;
    if (allAnswered) {
      btnNext.style.background = "linear-gradient(135deg,#e63946,#ff6b6b)";
      btnNext.style.boxShadow  = "0 4px 16px rgba(230,57,70,.4)";
    } else {
      btnNext.style.background = "";
      btnNext.style.boxShadow  = "";
    }
  } else {
    btnNext.textContent      = "Next →";
    btnNext.onclick          = nextQuestion;
    btnNext.style.background = "";
    btnNext.style.boxShadow  = "";
  }
}

function renderDots() {
  const nav = document.getElementById("dot-nav");
  nav.innerHTML = "";
  State.questions.forEach((q, i) => {
    const dot = document.createElement("div");
    dot.className = "dot";
    if (State.answers[q.id] !== undefined) dot.classList.add("answered");
    if (i === State.currentIndex)          dot.classList.add("current");
    dot.title = `Q${i + 1}`;
    dot.addEventListener("click", () => {
      State.currentIndex = i;
      renderQuestion();
      SFX.navigate();
    });
    nav.appendChild(dot);
  });
}

// ─── Answer Selection ────────────────────────────────────────────
function selectAnswer(questionId, letter) {
  State.answers[questionId] = letter;

  const container = document.getElementById("choices-container");
  container.querySelectorAll(".choice-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.letter === letter);
  });

  const hint = container.querySelector(".change-hint");
  if (hint) hint.textContent = "✏️ You can still change your answer before submitting.";

  renderDots();
  SFX.select();

  if (State.currentIndex === State.questions.length - 1) {
    const btnNext     = document.getElementById("btn-next");
    const allAnswered = State.questions.every(qq => State.answers[qq.id] !== undefined);
    if (allAnswered) {
      btnNext.style.background = "linear-gradient(135deg,#e63946,#ff6b6b)";
      btnNext.style.boxShadow  = "0 4px 16px rgba(230,57,70,.4)";
    }
  }
}

// ─── Navigation ──────────────────────────────────────────────────
function nextQuestion() {
  if (State.currentIndex < State.questions.length - 1) {
    State.currentIndex++;
    renderQuestion();
    window.scrollTo(0, 0);
    SFX.navigate();
  }
}
function prevQuestion() {
  if (State.currentIndex > 0) {
    State.currentIndex--;
    renderQuestion();
    window.scrollTo(0, 0);
    SFX.navigate();
  }
}

// ─── Submit Quiz ─────────────────────────────────────────────────
async function submitQuiz() {
  const unanswered = State.questions.filter(q => State.answers[q.id] === undefined).length;
  if (unanswered > 0) {
    if (!confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) return;
  }

  stopTimer();
  SFX.submit();

  // Show a brief "submitting" state on the button
  const btnNext = document.getElementById("btn-next");
  btnNext.textContent = "Submitting…";
  btnNext.disabled    = true;

  const payload = {
    session_id:        State.sessionId,
    username:          State.username,
    answers:           State.answers,
    time_taken:        State.elapsedSeconds,
    subject_filter:    State.subjectFilter,
    difficulty_filter: State.difficultyFilter,
  };

  try {
    const res  = await fetch("/api/submit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    renderResults(data);
    showScreen("screen-results");
    // Play pass/fail sound after brief delay
    setTimeout(() => {
      data.score.percent >= 75 ? SFX.pass() : SFX.fail();
    }, 400);
  } catch (err) {
    alert("Error submitting quiz. Check the console.");
    btnNext.textContent = "Submit Quiz ✓";
    btnNext.disabled    = false;
    console.error(err);
  }
}

// ─── Exit Modal ──────────────────────────────────────────────────
function confirmExit() {
  document.getElementById("modal-message").textContent = "Exit this quiz? Your progress will be lost.";
  document.getElementById("modal-overlay").classList.add("active");
}
function closeModal()  { document.getElementById("modal-overlay").classList.remove("active"); }
function exitQuiz()    { stopTimer(); closeModal(); showScreen("screen-home"); SFX.navigate(); }

// ─── Render Results ───────────────────────────────────────────────
function renderResults(data) {
  const { score, results, subject_stats, difficulty_stats, analysis } = data;

  const pct           = score.percent;
  const circumference = 314;
  const offset        = circumference - (pct / 100) * circumference;
  const ringEl        = document.getElementById("ring-fill");
  ringEl.style.strokeDashoffset = circumference;
  ringEl.style.stroke           = pct >= 75 ? "var(--teal)" : "var(--red)";
  setTimeout(() => { ringEl.style.strokeDashoffset = offset; }, 80);

  document.getElementById("res-score-pct").textContent    = pct + "%";
  document.getElementById("res-verdict").textContent      = score.verdict;
  document.getElementById("res-correct-text").textContent = `${score.correct} / ${score.total} correct`;

  const mins = Math.floor(score.time_taken / 60);
  const secs = score.time_taken % 60;
  document.getElementById("res-time-text").textContent = `⏱ ${mins}m ${secs}s taken`;

  const vmsg = document.getElementById("res-verdict-msg");
  vmsg.textContent = score.verdict_msg;
  vmsg.className   = "verdict-msg " + (score.verdict === "PASSED" ? "verdict-pass" : "verdict-fail");

  // Strengths
  const strengthsList = document.getElementById("strengths-list");
  strengthsList.innerHTML = analysis.strengths.length
    ? analysis.strengths.map(s => `
        <div class="perf-item">
          <span>${s.subject}</span>
          <span class="perf-pct good">${s.percent}%</span>
        </div>`).join("")
    : `<p style="color:var(--muted);font-size:.85rem;padding:8px 0">No subjects at 75%+ yet. Keep studying!</p>`;

  // Improvements
  const improveList = document.getElementById("improve-list");
  improveList.innerHTML = analysis.needs_improvement.length
    ? analysis.needs_improvement.map(s => `
        <div class="perf-item">
          <span>${s.subject}</span>
          <span class="perf-pct bad">${s.percent}%</span>
        </div>`).join("")
    : `<p style="color:var(--muted);font-size:.85rem;padding:8px 0">🎉 All subjects above 75%!</p>`;

  // Subject breakdown bars
  const breakdown = document.getElementById("subject-breakdown");
  breakdown.innerHTML = Object.entries(subject_stats).map(([subj, stats]) => {
    const p     = stats.percent;
    const color = p >= 75 ? "#00a896" : p >= 50 ? "#f0a500" : "#e63946";
    return `
      <div class="subj-bar-row">
        <div class="subj-bar-meta">
          <span>${subj}</span>
          <span style="color:${color};font-weight:600">${stats.correct}/${stats.total} — ${p}%</span>
        </div>
        <div class="subj-bar-track">
          <div class="subj-bar-fill" style="width:0%;background:${color}" data-width="${p}"></div>
        </div>
      </div>`;
  }).join("");

  setTimeout(() => {
    document.querySelectorAll(".subj-bar-fill").forEach(bar => {
      bar.style.width = bar.dataset.width + "%";
    });
  }, 120);

  // Difficulty stats
  const diffStatsEl = document.getElementById("diff-stats");
  diffStatsEl.innerHTML = "";
  ["easy", "medium", "hard"].forEach(diff => {
    const d = difficulty_stats[diff];
    const p = d.total > 0 ? Math.round(d.correct / d.total * 100) : 0;
    const card = document.createElement("div");
    card.className = `diff-stat-card ${diff}`;
    card.innerHTML = `
      <div class="diff-label">${diff.toUpperCase()}</div>
      <div class="diff-stat-pct">${p}%</div>
      <div class="diff-sub">${d.correct}/${d.total} correct</div>`;
    diffStatsEl.appendChild(card);
  });

  // Review
  const reviewList = document.getElementById("review-list");
  reviewList.innerHTML = results.map((r, i) => `
    <div class="review-item ${r.is_correct ? "correct" : "incorrect"}">
      <div class="review-item-header">
        <span class="review-status ${r.is_correct ? "correct" : "incorrect"}">
          ${r.is_correct ? "✔ Correct" : "✘ Incorrect"}
        </span>
        <span style="font-size:.75rem;color:var(--muted)">${r.subject} · ${r.difficulty}</span>
      </div>
      <div class="review-q-text">Q${i + 1}: ${r.question}</div>
      <div class="review-answer-info">
        ${!r.is_correct
          ? `Your answer: <span class="chosen-wrong">${r.chosen}</span> &nbsp;|&nbsp; `
          : ""}
        Correct answer: <span class="correct-ans">${r.correct_answer}</span>
      </div>
      <div class="review-rationale">
        <strong>💡 Rationale:</strong> ${r.rationale}
      </div>
    </div>
  `).join("");

  switchTab("tab-analysis", null);
}

// ─── Tab Switching ────────────────────────────────────────────────
function switchTab(tabId, clickedEl) {
  document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const tabContent = document.getElementById(tabId);
  if (tabContent) tabContent.classList.add("active");
  if (clickedEl) {
    clickedEl.classList.add("active");
  } else {
    document.querySelectorAll(".tab").forEach(t => {
      if (t.getAttribute("onclick") && t.getAttribute("onclick").includes(tabId)) {
        t.classList.add("active");
      }
    });
  }
  SFX.navigate();
}

// ─── Leaderboard ─────────────────────────────────────────────────
const MEDAL = ["🥇", "🥈", "🥉"];

async function loadLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Loading leaderboard…</p>`;
  try {
    const res  = await fetch("/api/leaderboard");
    const data = await res.json();

    if (!data.leaderboard.length) {
      list.innerHTML = `<p style="color:var(--muted);padding:20px 0">No sessions yet. Be the first! 🏆</p>`;
      return;
    }

    // Source badge
    const sourceBadge = data.source === "sheets"
      ? `<div style="font-size:.75rem;color:var(--teal);margin-bottom:12px">✅ Live from Google Sheets</div>`
      : `<div style="font-size:.75rem;color:var(--muted);margin-bottom:12px">📦 Local data (Sheets not configured)</div>`;

    list.innerHTML = sourceBadge + data.leaderboard.map(h => {
      const pass  = parseFloat(h.best_score) >= 75;
      const rank  = parseInt(h.rank) || 0;
      const medal = MEDAL[rank - 1] || `#${rank}`;
      const rawDate = h.last_attempt || h["Last Attempt"] || "";
      let dateStr = "—";
      try {
        const d = new Date(rawDate);
        if (!isNaN(d)) dateStr = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
      } catch (_) {}
      const bestScore = parseFloat(h.best_score || h["Best Score (%)"] || 0);
      const avgScore  = parseFloat(h.avg_score  || h["Avg Score (%)"]  || 0);
      const sessions  = parseInt(h.sessions     || h["Sessions"]       || 1);
      const username  = h.username || h["Username"] || "?";
      return `
        <div class="lb-card ${pass ? "lb-pass" : "lb-fail"} ${rank <= 3 ? "lb-top" : ""}">
          <div class="lb-rank">${medal}</div>
          <div class="lb-info">
            <div class="lb-name">${username}</div>
            <div class="lb-meta">${sessions} session${sessions !== 1 ? "s" : ""} · Last: ${dateStr} · Avg: ${avgScore}%</div>
          </div>
          <div class="lb-score">
            <div class="lb-best">${bestScore}%</div>
            <div class="lb-verdict" style="color:${pass ? "var(--teal)" : "var(--red)"}">${pass ? "PASSED" : "NEEDS WORK"}</div>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Failed to load leaderboard.</p>`;
  }
}

// ─── History ─────────────────────────────────────────────────────
async function loadHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Loading…</p>`;
  try {
    const res  = await fetch("/api/history");
    const data = await res.json();

    if (!data.history.length) {
      list.innerHTML = `<p style="color:var(--muted);padding:20px 0">No sessions yet.</p>`;
      return;
    }

    list.innerHTML = data.history.map(h => {
      const pass = h.score_percent >= 75;
      const date = new Date(h.created_at).toLocaleDateString("en-PH", {
        month: "short", day: "numeric", year: "numeric",
      });
      const mins = Math.floor((h.time_taken_seconds || 0) / 60);
      const secs = (h.time_taken_seconds || 0) % 60;
      return `
        <div class="history-card">
          <div class="history-score-badge ${pass ? "pass" : "fail"}">${h.score_percent}%</div>
          <div class="history-info">
            <div class="history-name">${h.username}</div>
            <div class="history-meta">${date} · ${mins}m ${secs}s</div>
          </div>
          <div class="history-correct">
            ${h.correct_answers} / ${h.total_questions}<br>
            <span style="font-size:.75rem;font-weight:600;color:${pass ? "var(--teal)" : "var(--red)"}">
              ${pass ? "PASSED" : "FAILED"}
            </span>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Failed to load history.</p>`;
  }
}
