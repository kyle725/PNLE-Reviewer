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
    playTone(523.25, "sine", 0.13, 0.16);
    playTone(659.25, "sine", 0.13, 0.16, 0.10);
    playTone(783.99, "sine", 0.20, 0.16, 0.20);
    playTone(1046.5, "sine", 0.15, 0.12, 0.32);
  },
  incorrect() {
    playTone(300, "sawtooth", 0.09, 0.14);
    playTone(250, "sawtooth", 0.10, 0.14, 0.10);
    playTone(200, "sawtooth", 0.14, 0.12, 0.22);
  },
  select()      { playTone(880, "sine", 0.06, 0.10); playTone(1100, "sine", 0.05, 0.08, 0.07); },
  navigate()    { playTone(528, "sine", 0.07, 0.08); },
  start()       { playTone(440, "triangle", 0.08, 0.12); playTone(660, "triangle", 0.12, 0.14, 0.10); playTone(880, "triangle", 0.10, 0.12, 0.22); },
  submit()      { playTone(660, "sine", 0.08, 0.13); playTone(880, "sine", 0.08, 0.13, 0.10); playTone(1100, "sine", 0.16, 0.13, 0.20); },
  leaderboard() { [523.25, 659.25, 783.99].forEach((f,i) => playTone(f, "sine", 0.15, 0.14, i*0.09)); },
  tick()        { playTone(1200, "square", 0.03, 0.06); },
  timeout()     { playTone(400, "sawtooth", 0.12, 0.18); playTone(320, "sawtooth", 0.16, 0.18, 0.15); },
  pass() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f,i) => playTone(f, "sine", 0.28, 0.17, i*0.11));
    playTone(1318.5, "sine", 0.18, 0.18, 0.46);
    playTone(1046.5, "triangle", 0.55, 0.22, 0.60);
    playTone(1318.5, "triangle", 0.40, 0.20, 0.90);
  },
  fail() {
    playTone(392, "triangle", 0.18, 0.15);
    playTone(349.23, "triangle", 0.18, 0.15, 0.20);
    playTone(311.13, "triangle", 0.18, 0.15, 0.40);
    playTone(261.63, "triangle", 0.35, 0.15, 0.60);
  },
};

// ─── Constants ────────────────────────────────────────────────────
const EXAM_SECONDS_PER_Q = 40;
const HISTORY_PASSWORD   = "nurseup2025";

// ─── State ──────────────────────────────────────────────────────
const State = {
  questions:        [],
  answers:          {},
  currentIndex:     0,
  timerInterval:    null,
  examQInterval:    null,
  elapsedSeconds:   0,
  examQSecondsLeft: EXAM_SECONDS_PER_Q,
  sessionId:        null,
  username:         "Nurse",
  email:            "",
  mode:             "practice",
  subjectFilter:    "all",
  difficultyFilter: "all",
  practiceRevealed: {},
};

let historyUnlocked = false;

// ─── Exam attempt memory (localStorage) ─────────────────────────
function getExamAttempted(email) {
  try {
    const raw = localStorage.getItem("nurseup_exam_attempts");
    const map = raw ? JSON.parse(raw) : {};
    return !!map[email.toLowerCase()];
  } catch { return false; }
}
function setExamAttempted(email) {
  try {
    const raw = localStorage.getItem("nurseup_exam_attempts");
    const map = raw ? JSON.parse(raw) : {};
    map[email.toLowerCase()] = Date.now();
    localStorage.setItem("nurseup_exam_attempts", JSON.stringify(map));
  } catch {}
}

// ─── Mode Selection ───────────────────────────────────────────────
function selectMode(mode) {
  State.mode = mode;
  document.getElementById("mode-practice").classList.toggle("active", mode === "practice");
  document.getElementById("mode-exam").classList.toggle("active", mode === "exam");
  document.getElementById("email-row").style.display = mode === "exam" ? "block" : "none";
  SFX.select();
}

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
  const count      = parseInt(document.querySelector("#count-group .pill.active")?.dataset.value || 10);

  State.username        = document.getElementById("username").value.trim() || "Nurse";
  State.email           = (document.getElementById("user-email")?.value || "").trim();
  State.subjectFilter   = subject;
  State.difficultyFilter = difficulty;

  if (State.mode === "exam") {
    if (!State.email) {
      alert("Please enter your email address to use Exam mode.");
      document.getElementById("user-email").focus();
      return;
    }
    if (getExamAttempted(State.email)) {
      document.getElementById("exam-block-msg").textContent =
        `${State.email} has already completed an exam session. Switch to Practice mode to keep reviewing.`;
      document.getElementById("exam-block-modal").classList.add("active");
      return;
    }
  }

  // ── Full state reset ──
  State.sessionId        = "SES_" + Date.now();
  State.answers          = {};
  State.currentIndex     = 0;
  State.elapsedSeconds   = 0;
  State.practiceRevealed = {};
  clearInterval(State.timerInterval);
  clearInterval(State.examQInterval);

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

    const isExam = State.mode === "exam";
    document.getElementById("exam-countdown-wrap").style.display = isExam ? "block" : "none";
    document.getElementById("q-mode-badge").style.display = "inline-block";
    document.getElementById("q-mode-badge").textContent   = isExam ? "⏱ Exam" : "📖 Practice";
    document.getElementById("btn-prev").style.display     = isExam ? "none" : "";

    renderQuestion();
    startTimer();
    if (isExam) startExamQuestionTimer();

  } catch (err) {
    alert("Failed to load questions. Is the Flask server running?");
    console.error(err);
  }
}

// ─── Global elapsed timer ─────────────────────────────────────────
function startTimer() {
  clearInterval(State.timerInterval);
  State.elapsedSeconds = 0;
  const el = document.getElementById("quiz-timer");
  el.textContent = "00:00";
  el.className   = "quiz-timer";
  State.timerInterval = setInterval(() => {
    State.elapsedSeconds++;
    const m = Math.floor(State.elapsedSeconds / 60).toString().padStart(2, "0");
    const s = (State.elapsedSeconds % 60).toString().padStart(2, "0");
    // In practice mode show elapsed; in exam mode the per-Q timer overrides display
    if (State.mode === "practice") {
      el.textContent = `${m}:${s}`;
    }
  }, 1000);
}
function stopTimer() {
  clearInterval(State.timerInterval);
  clearInterval(State.examQInterval);
}

// ─── Exam per-question countdown ─────────────────────────────────
function startExamQuestionTimer() {
  clearInterval(State.examQInterval);
  State.examQSecondsLeft = EXAM_SECONDS_PER_Q;
  updateExamBar();
  const timerEl = document.getElementById("quiz-timer");

  State.examQInterval = setInterval(() => {
    State.examQSecondsLeft--;
    timerEl.textContent = `⏱ ${State.examQSecondsLeft}s`;
    if (State.examQSecondsLeft <= 10) {
      timerEl.classList.add("danger");
      SFX.tick();
    } else {
      timerEl.classList.remove("danger");
    }
    updateExamBar();

    if (State.examQSecondsLeft <= 0) {
      SFX.timeout();
      clearInterval(State.examQInterval);
      handleExamTimeout();
    }
  }, 1000);
}

function updateExamBar() {
  const pct = (State.examQSecondsLeft / EXAM_SECONDS_PER_Q) * 100;
  const bar = document.getElementById("exam-countdown-bar");
  if (!bar) return;
  bar.style.width = pct + "%";
  if (pct > 50)      bar.style.background = "linear-gradient(90deg,#00a896,#02c39a)";
  else if (pct > 25) bar.style.background = "linear-gradient(90deg,#f0a500,#ffc640)";
  else               bar.style.background = "linear-gradient(90deg,#e63946,#ff6b6b)";
}

function handleExamTimeout() {
  const q = State.questions[State.currentIndex];
  if (!State.answers[q.id]) State.answers[q.id] = "__SKIPPED__";
  renderDots();

  if (State.currentIndex === State.questions.length - 1) {
    submitQuiz();
  } else {
    State.currentIndex++;
    renderQuestion();
    startExamQuestionTimer();
  }
}

// ─── Render Question ─────────────────────────────────────────────
function renderQuestion() {
  const q     = State.questions[State.currentIndex];
  const total = State.questions.length;
  const idx   = State.currentIndex;

  // Progress bar
  document.getElementById("progress-fill").style.width = ((idx + 1) / total * 100) + "%";
  document.getElementById("progress-text").textContent = `${idx + 1} / ${total}`;

  // Badges
  document.getElementById("q-subject").textContent = q.subject;
  document.getElementById("q-topic").textContent   = q.topic;
  const diffBadge  = document.getElementById("q-diff");
  diffBadge.textContent = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
  const dc = { easy: { bg:"#e6f7f5",color:"#00a896",border:"#00a896" }, medium: { bg:"#fff8e7",color:"#a07000",border:"#f0a500" }, hard: { bg:"#fdecea",color:"#e63946",border:"#e63946" } }[q.difficulty] || {};
  Object.assign(diffBadge.style, { background: dc.bg, color: dc.color, borderColor: dc.border });

  document.getElementById("q-number").textContent      = `Question ${idx + 1}`;
  document.getElementById("question-text").textContent = q.question;

  // Choices container
  const container = document.getElementById("choices-container");
  container.innerHTML = "";

  const letters       = ["A","B","C","D","E"];
  const alreadyChosen = State.answers[q.id];
  const isRevealed    = !!State.practiceRevealed[q.id];
  const isExam        = State.mode === "exam";
  const isAnswered    = alreadyChosen && alreadyChosen !== "__SKIPPED__";

  // Hint line
  const hint = document.createElement("p");
  hint.className = "change-hint";
  if (isExam) {
    hint.textContent = isAnswered ? "Answer locked — waiting for next question." : "Select one answer. Time is running!";
  } else {
    hint.textContent = isRevealed ? "Answer revealed. Move to the next question." : isAnswered ? "✏️ You can still change your answer before submitting." : "Select an answer below.";
  }
  container.appendChild(hint);

  q.choices.forEach((choice, i) => {
    const letter    = letters[i];
    const btn       = document.createElement("button");
    btn.className      = "choice-btn";
    btn.dataset.letter = letter;
    const choiceText   = choice.replace(/^[A-E]\.\s*/, "");
    btn.innerHTML      = `<span class="choice-letter">${letter}</span><span>${choiceText}</span>`;

    const shouldReveal = isRevealed || (isExam && isAnswered);
    if (shouldReveal) {
      if (letter === q.answer)                                           btn.classList.add("correct");
      else if (letter === alreadyChosen && alreadyChosen !== q.answer)  btn.classList.add("incorrect");
      btn.disabled = true;
    } else if (isAnswered) {
      if (letter === alreadyChosen) btn.classList.add("selected");
      if (isExam) btn.disabled = true;
    }

    if (!btn.disabled) btn.addEventListener("click", () => selectAnswer(q.id, letter, q.answer));
    container.appendChild(btn);
  });

  if (isRevealed) showRationale(q);

  renderDots();
  document.getElementById("btn-prev").disabled = (idx === 0);
  rebuildNextButton();
}

// ─── Rebuild Next button (fixes stale handler bug) ────────────────
function rebuildNextButton() {
  const idx    = State.currentIndex;
  const total  = State.questions.length;
  const isLast = idx === total - 1;

  const old = document.getElementById("btn-next");
  if (!old) return;

  const btn = document.createElement("button");
  btn.id        = "btn-next";
  btn.className = "btn-nav-next";

  if (isLast) {
    const allAnswered = State.questions.every(q => {
      const ans = State.answers[q.id];
      return ans !== undefined && ans !== "__SKIPPED__";
    });
    btn.textContent = "Submit Quiz ✓";
    if (allAnswered) {
      btn.style.background = "linear-gradient(135deg,#e63946,#ff6b6b)";
      btn.style.boxShadow  = "0 4px 16px rgba(230,57,70,.4)";
    }
    btn.addEventListener("click", submitQuiz);
  } else {
    btn.textContent = "Next →";
    btn.addEventListener("click", nextQuestion);
  }

  old.replaceWith(btn);
}

// ─── Answer Selection ────────────────────────────────────────────
function selectAnswer(questionId, letter, correctAnswer) {
  const isExam     = State.mode === "exam";
  const isPractice = State.mode === "practice";

  // Exam: lock after first real answer
  if (isExam && State.answers[questionId] && State.answers[questionId] !== "__SKIPPED__") return;

  State.answers[questionId] = letter;

  const container = document.getElementById("choices-container");

  if (isPractice) {
    State.practiceRevealed[questionId] = true;
    const isCorrect = letter.toUpperCase() === correctAnswer.toUpperCase();
    isCorrect ? SFX.correct() : SFX.incorrect();

    container.querySelectorAll(".choice-btn").forEach(btn => {
      btn.disabled = true;
      const bl = btn.dataset.letter;
      if (bl === correctAnswer)                         btn.classList.add("correct");
      else if (bl === letter && letter !== correctAnswer) btn.classList.add("incorrect");
    });

    const q = State.questions[State.currentIndex];
    showRationale(q);

    const hint = container.querySelector(".change-hint");
    if (hint) hint.textContent = isCorrect ? "✅ Correct! Move to the next question." : "❌ Incorrect. See the rationale below.";

  } else if (isExam) {
    container.querySelectorAll(".choice-btn").forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.letter === letter) btn.classList.add("selected");
    });
    const hint = container.querySelector(".change-hint");
    if (hint) hint.textContent = "Answer locked — waiting for next question.";
    SFX.select();
  }

  renderDots();
  rebuildNextButton();
}

function showRationale(q) {
  document.querySelector(".rationale-box")?.remove();
  const box = document.createElement("div");
  box.className = "rationale-box";
  box.innerHTML = `<strong>💡 Rationale:</strong> ${q.rationale || "No rationale provided."}`;
  document.getElementById("choices-container").appendChild(box);
}

// ─── Navigation ──────────────────────────────────────────────────
function nextQuestion() {
  if (State.currentIndex < State.questions.length - 1) {
    State.currentIndex++;
    renderQuestion();
    window.scrollTo(0, 0);
    SFX.navigate();
    if (State.mode === "exam") startExamQuestionTimer();
  }
}
function prevQuestion() {
  if (State.mode === "exam") return;
  if (State.currentIndex > 0) {
    State.currentIndex--;
    renderQuestion();
    window.scrollTo(0, 0);
    SFX.navigate();
  }
}

function renderDots() {
  const nav = document.getElementById("dot-nav");
  nav.innerHTML = "";
  State.questions.forEach((q, i) => {
    const dot = document.createElement("div");
    dot.className = "dot";
    const ans = State.answers[q.id];
    if (ans === "__SKIPPED__")  dot.classList.add("skipped");
    else if (ans !== undefined) dot.classList.add("answered");
    if (i === State.currentIndex) dot.classList.add("current");
    dot.title = `Q${i + 1}`;
    if (State.mode !== "exam") {
      dot.addEventListener("click", () => { State.currentIndex = i; renderQuestion(); SFX.navigate(); });
    }
    nav.appendChild(dot);
  });
}

// ─── Submit Quiz ─────────────────────────────────────────────────
async function submitQuiz() {
  const unanswered = State.questions.filter(q => State.answers[q.id] === undefined).length;
  if (unanswered > 0 && State.mode !== "exam") {
    if (!confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) return;
  }

  stopTimer();
  SFX.submit();

  if (State.mode === "exam" && State.email) setExamAttempted(State.email);

  const btnNext = document.getElementById("btn-next");
  if (btnNext) { btnNext.textContent = "Submitting…"; btnNext.disabled = true; }

  const cleanAnswers = {};
  for (const [id, ans] of Object.entries(State.answers)) {
    cleanAnswers[id] = ans === "__SKIPPED__" ? "" : ans;
  }

  const payload = {
    session_id: State.sessionId, username: State.username, email: State.email,
    mode: State.mode, answers: cleanAnswers, time_taken: State.elapsedSeconds,
    subject_filter: State.subjectFilter, difficulty_filter: State.difficultyFilter,
  };

  try {
    const res  = await fetch("/api/submit", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
    const data = await res.json();
    renderResults(data);
    showScreen("screen-results");
    setTimeout(() => { data.score.percent >= 75 ? SFX.pass() : SFX.fail(); }, 400);
  } catch (err) {
    alert("Error submitting quiz. Check the console.");
    if (btnNext) { btnNext.textContent = "Submit Quiz ✓"; btnNext.disabled = false; }
    console.error(err);
  }
}

// ─── Exit Modal ──────────────────────────────────────────────────
function confirmExit() {
  document.getElementById("modal-message").textContent = "Exit this quiz? Your progress will be lost.";
  document.getElementById("modal-overlay").classList.add("active");
}
function closeModal() { document.getElementById("modal-overlay").classList.remove("active"); }
function exitQuiz()   { stopTimer(); closeModal(); showScreen("screen-home"); SFX.navigate(); }

// ─── Render Results ───────────────────────────────────────────────
function renderResults(data) {
  const { score, results, subject_stats, difficulty_stats, analysis } = data;
  const pct = score.percent;

  const ringEl = document.getElementById("ring-fill");
  ringEl.style.strokeDashoffset = 314;
  ringEl.style.stroke = pct >= 75 ? "var(--teal)" : "var(--red)";
  setTimeout(() => { ringEl.style.strokeDashoffset = 314 - (pct/100)*314; }, 80);

  document.getElementById("res-score-pct").textContent    = pct + "%";
  document.getElementById("res-verdict").textContent      = score.verdict;
  document.getElementById("res-correct-text").textContent = `${score.correct} / ${score.total} correct`;
  document.getElementById("res-time-text").textContent    = `⏱ ${Math.floor(score.time_taken/60)}m ${score.time_taken%60}s taken`;

  const vmsg = document.getElementById("res-verdict-msg");
  vmsg.textContent = score.verdict_msg;
  vmsg.className   = "verdict-msg " + (score.verdict === "PASSED" ? "verdict-pass" : "verdict-fail");

  document.getElementById("strengths-list").innerHTML = analysis.strengths.length
    ? analysis.strengths.map(s => `<div class="perf-item"><span>${s.subject}</span><span class="perf-pct good">${s.percent}%</span></div>`).join("")
    : `<p style="color:var(--muted);font-size:.85rem;padding:8px 0">No subjects at 75%+ yet. Keep studying!</p>`;

  document.getElementById("improve-list").innerHTML = analysis.needs_improvement.length
    ? analysis.needs_improvement.map(s => `<div class="perf-item"><span>${s.subject}</span><span class="perf-pct bad">${s.percent}%</span></div>`).join("")
    : `<p style="color:var(--muted);font-size:.85rem;padding:8px 0">🎉 All subjects above 75%!</p>`;

  document.getElementById("subject-breakdown").innerHTML = Object.entries(subject_stats).map(([subj, stats]) => {
    const p = stats.percent, color = p >= 75 ? "#00a896" : p >= 50 ? "#f0a500" : "#e63946";
    return `<div class="subj-bar-row"><div class="subj-bar-meta"><span>${subj}</span><span style="color:${color};font-weight:600">${stats.correct}/${stats.total} — ${p}%</span></div><div class="subj-bar-track"><div class="subj-bar-fill" style="width:0%;background:${color}" data-width="${p}"></div></div></div>`;
  }).join("");
  setTimeout(() => document.querySelectorAll(".subj-bar-fill").forEach(b => b.style.width = b.dataset.width + "%"), 120);

  const diffEl = document.getElementById("diff-stats");
  diffEl.innerHTML = "";
  ["easy","medium","hard"].forEach(diff => {
    const d = difficulty_stats[diff], p = d.total > 0 ? Math.round(d.correct/d.total*100) : 0;
    const card = document.createElement("div");
    card.className = `diff-stat-card ${diff}`;
    card.innerHTML = `<div class="diff-label">${diff.toUpperCase()}</div><div class="diff-stat-pct">${p}%</div><div class="diff-sub">${d.correct}/${d.total} correct</div>`;
    diffEl.appendChild(card);
  });

  document.getElementById("review-list").innerHTML = results.map((r,i) => `
    <div class="review-item ${r.is_correct?"correct":"incorrect"}">
      <div class="review-item-header">
        <span class="review-status ${r.is_correct?"correct":"incorrect"}">${r.is_correct?"✔ Correct":"✘ Incorrect"}</span>
        <span style="font-size:.75rem;color:var(--muted)">${r.subject} · ${r.difficulty}</span>
      </div>
      <div class="review-q-text">Q${i+1}: ${r.question}</div>
      <div class="review-answer-info">${!r.is_correct ? `Your answer: <span class="chosen-wrong">${r.chosen||"No answer"}</span> &nbsp;|&nbsp; ` : ""}Correct answer: <span class="correct-ans">${r.correct_answer}</span></div>
      <div class="review-rationale"><strong>💡 Rationale:</strong> ${r.rationale}</div>
    </div>`).join("");

  switchTab("tab-analysis", null);
}

// ─── Tab Switching ────────────────────────────────────────────────
function switchTab(tabId, clickedEl) {
  document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById(tabId)?.classList.add("active");
  if (clickedEl) {
    clickedEl.classList.add("active");
  } else {
    document.querySelectorAll(".tab").forEach(t => {
      if (t.getAttribute("onclick")?.includes(tabId)) t.classList.add("active");
    });
  }
  SFX.navigate();
}

// ─── Leaderboard ─────────────────────────────────────────────────
const MEDAL = ["🥇","🥈","🥉"];

async function loadLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Loading leaderboard…</p>`;
  try {
    const res  = await fetch("/api/leaderboard");
    const data = await res.json();
    if (!data.leaderboard?.length) {
      list.innerHTML = `<p style="color:var(--muted);padding:20px 0">No sessions yet. Be the first! 🏆</p>`;
      return;
    }
    const src = data.source === "sheets"
      ? `<div style="font-size:.75rem;color:var(--teal);margin-bottom:16px">✅ Live from Google Sheets</div>`
      : `<div style="font-size:.75rem;color:var(--muted);margin-bottom:16px">📦 Local data</div>`;

    list.innerHTML = src + data.leaderboard.map((h, i) => {
      const rank = i + 1, pass = parseFloat(h.best_score) >= 75;
      const medal = MEDAL[rank-1] || `#${rank}`;
      let dateStr = "—";
      try { const d = new Date(h.last_attempt); if (!isNaN(d)) dateStr = d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}); } catch(_){}
      return `
        <div class="lb-card ${pass?"lb-pass":"lb-fail"} ${rank<=3?"lb-top":""}">
          <div class="lb-rank">${medal}</div>
          <div class="lb-info">
            <div class="lb-name">${h.username||"?"}</div>
            <div class="lb-meta">${parseInt(h.sessions||1)} session${h.sessions!=1?"s":""} · Last: ${dateStr} · Avg: ${parseFloat(h.avg_score||0).toFixed(1)}%</div>
          </div>
          <div class="lb-score">
            <div class="lb-best">${parseFloat(h.best_score||0).toFixed(1)}%</div>
            <div class="lb-verdict" style="color:${pass?"var(--teal)":"var(--red)"}">${pass?"✅ PASSED":"📚 KEEP GOING"}</div>
          </div>
        </div>`;
    }).join("");
  } catch(e) {
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
      const date = new Date(h.created_at).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
      const mins = Math.floor((h.time_taken_seconds||0)/60), secs = (h.time_taken_seconds||0)%60;
      return `
        <div class="history-card">
          <div class="history-score-badge ${pass?"pass":"fail"}">${h.score_percent}%</div>
          <div class="history-info">
            <div class="history-name">${h.username}</div>
            <div class="history-meta">${date} · ${mins}m ${secs}s</div>
          </div>
          <div class="history-correct">${h.correct_answers}/${h.total_questions}<br>
            <span style="font-size:.75rem;font-weight:600;color:${pass?"var(--teal)":"var(--red)"}">${pass?"PASSED":"FAILED"}</span>
          </div>
        </div>`;
    }).join("");
  } catch(e) {
    list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Failed to load history.</p>`;
  }
}
