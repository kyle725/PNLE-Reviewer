// ─── Sound Engine ────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _ctx = null;
function getCtx() {
  if (!_ctx) _ctx = new AudioCtx();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}
function playTone(freq, type, duration, volume = 0.18, delay = 0) {
  try {
    const c = getCtx(), osc = c.createOscillator(), gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
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
  correct()     { playTone(523,  "sine",     0.13, 0.16); playTone(659,  "sine",     0.13, 0.16, 0.10); playTone(784,  "sine",     0.20, 0.16, 0.20); playTone(1046, "sine",     0.15, 0.12, 0.32); },
  incorrect()   { playTone(300,  "sawtooth", 0.09, 0.14); playTone(250,  "sawtooth", 0.10, 0.14, 0.10); playTone(200,  "sawtooth", 0.14, 0.12, 0.22); },
  select()      { playTone(880,  "sine",     0.06, 0.10); playTone(1100, "sine",     0.05, 0.08, 0.07); },
  navigate()    { playTone(528,  "sine",     0.07, 0.08); },
  start()       { playTone(440,  "triangle", 0.08, 0.12); playTone(660, "triangle", 0.12, 0.14, 0.10); playTone(880, "triangle", 0.10, 0.12, 0.22); },
  submit()      { playTone(660,  "sine",     0.08, 0.13); playTone(880, "sine",     0.08, 0.13, 0.10); playTone(1100,"sine",     0.16, 0.13, 0.20); },
  leaderboard() { [523,659,784].forEach((f,i) => playTone(f,"sine",0.15,0.14,i*0.09)); },
  tick()        { playTone(1200, "square",   0.03, 0.06); },
  timeout()     { playTone(400,  "sawtooth", 0.12, 0.18); playTone(320,"sawtooth",0.16,0.18,0.15); },
  pass()        { [523,659,784,1046].forEach((f,i)=>playTone(f,"sine",0.28,0.17,i*0.11)); playTone(1318,"sine",0.18,0.18,0.46); playTone(1046,"triangle",0.55,0.22,0.60); },
  fail()        { [392,349,311,261].forEach((f,i)=>playTone(f,"triangle",0.18,0.15,i*0.20)); },
};

// ─── Constants ───────────────────────────────────────────────────
const EXAM_SECS      = 40;
const HIST_PASSWORD  = "nurseup2025";
const MEDAL          = ["🥇","🥈","🥉"];

// ─── State ───────────────────────────────────────────────────────
const State = {
  questions:        [],
  answers:          {},       // questionId → letter chosen
  revealed:         {},       // questionId → true (practice: answer shown)
  currentIndex:     0,
  mode:             "practice",
  sessionId:        null,
  username:         "Nurse",
  email:            "",
  subjectFilter:    "all",
  diffFilter:       "all",
  elapsedSecs:      0,
  examSecsLeft:     EXAM_SECS,
  globalTimer:      null,
  examTimer:        null,
};

let historyUnlocked = false;

// ─── Exam attempt guard (localStorage) ───────────────────────────
function examAttempted(email) {
  try { return !!(JSON.parse(localStorage.getItem("nu_exams")||"{}")[email.toLowerCase()]); } catch { return false; }
}
function markExamAttempted(email) {
  try {
    const m = JSON.parse(localStorage.getItem("nu_exams")||"{}");
    m[email.toLowerCase()] = Date.now();
    localStorage.setItem("nu_exams", JSON.stringify(m));
  } catch {}
}

// ─── Screen management ───────────────────────────────────────────
function showScreen(id) {
  if (id === "screen-history" && !historyUnlocked) { showPasswordModal(); return; }
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
  if (id === "screen-history")     loadHistory();
  if (id === "screen-leaderboard") { loadLeaderboard(); SFX.leaderboard(); }
}

// ─── Password modal ───────────────────────────────────────────────
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
  if (document.getElementById("password-input").value === HIST_PASSWORD) {
    historyUnlocked = true;
    closePasswordModal();
    showScreen("screen-history");
  } else {
    document.getElementById("password-error").textContent = "Incorrect password.";
    document.getElementById("password-input").value = "";
    document.getElementById("password-input").focus();
    const m = document.querySelector(".password-modal");
    m.classList.add("shake");
    setTimeout(() => m.classList.remove("shake"), 500);
    SFX.incorrect();
  }
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("password-input")
    ?.addEventListener("keydown", e => { if (e.key === "Enter") submitPassword(); });
});
function leaveHistory() { historyUnlocked = false; showScreen("screen-home"); }

// ─── Mode selection ───────────────────────────────────────────────
function selectMode(mode) {
  State.mode = mode;
  document.getElementById("mode-practice").classList.toggle("active", mode === "practice");
  document.getElementById("mode-exam").classList.toggle("active", mode === "exam");
  document.getElementById("email-row").style.display = mode === "exam" ? "block" : "none";
  SFX.select();
}

// ─── Pill groups ─────────────────────────────────────────────────
document.querySelectorAll(".pill-group").forEach(group => {
  group.querySelectorAll(".pill").forEach(btn => {
    btn.addEventListener("click", () => {
      group.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      SFX.select();
    });
  });
});

// ─── Start quiz ───────────────────────────────────────────────────
async function startQuiz() {
  const subject    = document.getElementById("subject-select").value;
  const difficulty = document.querySelector("#diff-group .pill.active")?.dataset.value || "all";
  const count      = parseInt(document.querySelector("#count-group .pill.active")?.dataset.value || 10);

  State.username      = document.getElementById("username").value.trim() || "Nurse";
  State.email         = document.getElementById("user-email")?.value.trim() || "";
  State.subjectFilter = subject;
  State.diffFilter    = difficulty;

  if (State.mode === "exam") {
    if (!State.email) { alert("Please enter your email for Exam mode."); document.getElementById("user-email").focus(); return; }
    if (examAttempted(State.email)) {
      document.getElementById("exam-block-msg").textContent =
        `${State.email} has already completed an exam attempt. Use Practice mode to keep reviewing.`;
      document.getElementById("exam-block-modal").classList.add("active");
      return;
    }
  }

  // Full reset
  State.sessionId    = "SES_" + Date.now();
  State.answers      = {};
  State.revealed     = {};
  State.currentIndex = 0;
  State.elapsedSecs  = 0;
  stopTimers();

  SFX.start();

  try {
    const res  = await fetch(`/api/questions?${new URLSearchParams({ subject, difficulty, count })}`);
    const data = await res.json();
    if (!data.questions?.length) { alert("No questions found for this filter."); return; }
    State.questions = data.questions;
  } catch (err) {
    alert("Failed to load questions. Is the server running?");
    console.error(err); return;
  }

  showScreen("screen-quiz");

  const isExam = State.mode === "exam";
  document.getElementById("exam-countdown-wrap").style.display = isExam ? "block" : "none";
  document.getElementById("q-mode-badge").textContent = isExam ? "⏱ Exam" : "📖 Practice";
  document.getElementById("btn-prev").style.display   = isExam ? "none" : "";

  renderQuestion();
  startGlobalTimer();
  if (isExam) startExamTimer();
}

// ─── Timers ───────────────────────────────────────────────────────
function stopTimers() {
  clearInterval(State.globalTimer);
  clearInterval(State.examTimer);
  State.globalTimer = null;
  State.examTimer   = null;
}

function startGlobalTimer() {
  const el = document.getElementById("quiz-timer");
  State.globalTimer = setInterval(() => {
    State.elapsedSecs++;
    if (State.mode === "practice") {
      const m = String(Math.floor(State.elapsedSecs / 60)).padStart(2,"0");
      const s = String(State.elapsedSecs % 60).padStart(2,"0");
      el.textContent = `${m}:${s}`;
      el.className = "quiz-timer";
    }
  }, 1000);
}

function startExamTimer() {
  State.examSecsLeft = EXAM_SECS;
  updateExamBar();
  const el = document.getElementById("quiz-timer");

  State.examTimer = setInterval(() => {
    State.examSecsLeft--;
    el.textContent = `⏱ ${State.examSecsLeft}s`;
    el.className   = State.examSecsLeft <= 10 ? "quiz-timer danger" : "quiz-timer";
    if (State.examSecsLeft <= 10) SFX.tick();
    updateExamBar();
    if (State.examSecsLeft <= 0) {
      clearInterval(State.examTimer);
      SFX.timeout();
      onExamTimeout();
    }
  }, 1000);
}

function updateExamBar() {
  const bar = document.getElementById("exam-countdown-bar");
  if (!bar) return;
  const pct = (State.examSecsLeft / EXAM_SECS) * 100;
  bar.style.width      = pct + "%";
  bar.style.background = pct > 50
    ? "linear-gradient(90deg,#00a896,#02c39a)"
    : pct > 25
      ? "linear-gradient(90deg,#f0a500,#ffc640)"
      : "linear-gradient(90deg,#e63946,#ff6b6b)";
}

function onExamTimeout() {
  const q = State.questions[State.currentIndex];
  if (!State.answers[q.id]) State.answers[q.id] = "__SKIPPED__";
  renderDots();
  if (State.currentIndex === State.questions.length - 1) {
    submitQuiz();
  } else {
    State.currentIndex++;
    renderQuestion();
    startExamTimer();
  }
}

// ─── Render question ──────────────────────────────────────────────
function renderQuestion() {
  const q      = State.questions[State.currentIndex];
  const idx    = State.currentIndex;
  const total  = State.questions.length;
  const isExam = State.mode === "exam";

  // Progress
  document.getElementById("progress-fill").style.width = ((idx + 1) / total * 100) + "%";
  document.getElementById("progress-text").textContent = `${idx + 1} / ${total}`;

  // Badges
  document.getElementById("q-subject").textContent = q.subject;
  document.getElementById("q-topic").textContent   = q.topic;
  const diffBadge = document.getElementById("q-diff");
  diffBadge.textContent = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
  const dc = { easy:{bg:"#e6f7f5",color:"#00a896",border:"#00a896"}, medium:{bg:"#fff8e7",color:"#a07000",border:"#f0a500"}, hard:{bg:"#fdecea",color:"#e63946",border:"#e63946"} }[q.difficulty] || {};
  Object.assign(diffBadge.style, { background: dc.bg, color: dc.color, borderColor: dc.border });
  document.getElementById("q-number").textContent      = `Question ${idx + 1}`;
  document.getElementById("question-text").textContent = q.question;

  // State for this question
  const chosen     = State.answers[q.id];                        // undefined | letter | "__SKIPPED__"
  const answered   = chosen !== undefined && chosen !== "__SKIPPED__";
  const revealed   = !!State.revealed[q.id];                    // practice: show correct/wrong colours
  const lockChoice = revealed || (isExam && answered);          // no more clicking

  // Choices container — rebuild completely
  const container = document.getElementById("choices-container");
  container.innerHTML = "";

  // Hint line
  const hint = document.createElement("p");
  hint.className = "change-hint";
  if (isExam) {
    hint.textContent = answered ? "Answer locked — waiting for next question." : "Select one answer. Time is running!";
  } else {
    hint.textContent = revealed  ? "Answer revealed — move to the next question."
                     : answered  ? "✏️ You can still change your answer before submitting."
                     :             "Select an answer below.";
  }
  container.appendChild(hint);

  ["A","B","C","D","E"].slice(0, q.choices.length).forEach((letter, i) => {
    const btn = document.createElement("button");
    btn.className      = "choice-btn";
    btn.dataset.letter = letter;
    btn.innerHTML      = `<span class="choice-letter">${letter}</span><span>${q.choices[i].replace(/^[A-E]\.\s*/,"")}</span>`;

    if (lockChoice) {
      // Show correct / incorrect colouring
      if (letter === q.answer)                               btn.classList.add("correct");
      else if (letter === chosen && chosen !== q.answer)     btn.classList.add("incorrect");
      btn.disabled = true;
    } else if (answered) {
      // Answered but not yet revealed (practice) or not locked (shouldn't happen in exam)
      if (letter === chosen) btn.classList.add("selected");
      // In practice: still allow changing answer — DON'T disable
    }

    // Attach click handler only when not locked
    if (!lockChoice) {
      btn.addEventListener("click", () => onChoiceClick(q, letter));
    }

    container.appendChild(btn);
  });

  // Show rationale if already revealed
  if (revealed) renderRationale(q);

  renderDots();
  document.getElementById("btn-prev").disabled = (idx === 0);
  rebuildNextBtn();
}

// ─── Choice click ─────────────────────────────────────────────────
function onChoiceClick(q, letter) {
  const isExam = State.mode === "exam";

  // Guard: exam — already answered
  if (isExam && State.answers[q.id] && State.answers[q.id] !== "__SKIPPED__") return;

  State.answers[q.id] = letter;

  const container  = document.getElementById("choices-container");
  const isCorrect  = letter === q.answer;

  if (State.mode === "practice") {
    // Mark revealed so navigation re-renders with colours
    State.revealed[q.id] = true;

    // Update button styles immediately (no re-render needed)
    container.querySelectorAll(".choice-btn").forEach(btn => {
      const bl = btn.dataset.letter;
      btn.disabled = true;
      btn.classList.remove("selected","correct","incorrect");
      if (bl === q.answer)                          btn.classList.add("correct");
      else if (bl === letter && !isCorrect)         btn.classList.add("incorrect");
    });

    renderRationale(q);

    const hint = container.querySelector(".change-hint");
    if (hint) hint.textContent = isCorrect ? "✅ Correct! Move to the next question." : "❌ Incorrect. See the rationale below.";

    isCorrect ? SFX.correct() : SFX.incorrect();

  } else {
    // Exam — lock selection
    container.querySelectorAll(".choice-btn").forEach(btn => {
      btn.disabled = true;
      btn.classList.remove("selected");
      if (btn.dataset.letter === letter) btn.classList.add("selected");
    });
    const hint = container.querySelector(".change-hint");
    if (hint) hint.textContent = "Answer locked — waiting for next question.";
    SFX.select();
  }

  renderDots();
  rebuildNextBtn();
}

function renderRationale(q) {
  document.querySelector(".rationale-box")?.remove();
  const box = document.createElement("div");
  box.className = "rationale-box";
  box.innerHTML = `<strong>💡 Rationale:</strong> ${q.rationale || "No rationale provided."}`;
  document.getElementById("choices-container").appendChild(box);
}

// ─── Dots ─────────────────────────────────────────────────────────
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

// ─── Next button (fresh element every render = no stale handlers) ──
function rebuildNextBtn() {
  const idx    = State.currentIndex;
  const isLast = idx === State.questions.length - 1;
  const old    = document.getElementById("btn-next");
  if (!old) return;

  const btn = document.createElement("button");
  btn.id        = "btn-next";
  btn.className = "btn-nav-next";

  if (isLast) {
    const allAnswered = State.questions.every(q => {
      const a = State.answers[q.id];
      return a !== undefined && a !== "__SKIPPED__";
    });
    btn.textContent = "Submit Quiz ✓";
    if (allAnswered) {
      btn.style.background = "linear-gradient(135deg,#e63946,#ff6b6b)";
      btn.style.boxShadow  = "0 4px 16px rgba(230,57,70,.4)";
    }
    btn.addEventListener("click", submitQuiz);
  } else {
    btn.textContent = "Next →";
    btn.addEventListener("click", () => {
      State.currentIndex++;
      renderQuestion();
      window.scrollTo(0, 0);
      SFX.navigate();
      if (State.mode === "exam") { clearInterval(State.examTimer); startExamTimer(); }
    });
  }

  old.replaceWith(btn);
}

// ─── Prev ─────────────────────────────────────────────────────────
function prevQuestion() {
  if (State.mode === "exam" || State.currentIndex === 0) return;
  State.currentIndex--;
  renderQuestion();
  window.scrollTo(0, 0);
  SFX.navigate();
}

// ─── Submit ───────────────────────────────────────────────────────
async function submitQuiz() {
  const unanswered = State.questions.filter(q => State.answers[q.id] === undefined).length;
  if (unanswered > 0 && State.mode !== "exam") {
    if (!confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) return;
  }

  stopTimers();
  SFX.submit();
  if (State.mode === "exam" && State.email) markExamAttempted(State.email);

  const btnNext = document.getElementById("btn-next");
  if (btnNext) { btnNext.textContent = "Submitting…"; btnNext.disabled = true; }

  const cleanAnswers = {};
  Object.entries(State.answers).forEach(([id, ans]) => {
    cleanAnswers[id] = ans === "__SKIPPED__" ? "" : ans;
  });

  try {
    const res  = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: State.sessionId, username: State.username,
        email: State.email, mode: State.mode,
        answers: cleanAnswers, time_taken: State.elapsedSecs,
        subject_filter: State.subjectFilter, difficulty_filter: State.diffFilter,
      }),
    });
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

// ─── Exit modal ───────────────────────────────────────────────────
function confirmExit() {
  document.getElementById("modal-message").textContent = "Exit this quiz? Your progress will be lost.";
  document.getElementById("modal-overlay").classList.add("active");
}
function closeModal() { document.getElementById("modal-overlay").classList.remove("active"); }
function exitQuiz()   { stopTimers(); closeModal(); showScreen("screen-home"); SFX.navigate(); }

// ─── Render results ───────────────────────────────────────────────
function renderResults(data) {
  const { score, results, subject_stats, difficulty_stats, analysis } = data;
  const pct = score.percent;

  const ring = document.getElementById("ring-fill");
  ring.style.stroke = pct >= 75 ? "var(--teal)" : "var(--red)";
  ring.style.strokeDashoffset = 314;
  setTimeout(() => { ring.style.strokeDashoffset = 314 - (pct / 100) * 314; }, 80);

  document.getElementById("res-score-pct").textContent    = pct + "%";
  document.getElementById("res-verdict").textContent      = score.verdict;
  document.getElementById("res-correct-text").textContent = `${score.correct} / ${score.total} correct`;
  document.getElementById("res-time-text").textContent    = `⏱ ${Math.floor(score.time_taken/60)}m ${score.time_taken%60}s taken`;

  const vmsg = document.getElementById("res-verdict-msg");
  vmsg.textContent = score.verdict_msg;
  vmsg.className   = "verdict-msg " + (score.verdict === "PASSED" ? "verdict-pass" : "verdict-fail");

  document.getElementById("strengths-list").innerHTML = analysis.strengths.length
    ? analysis.strengths.map(s => `<div class="perf-item"><span>${s.subject}</span><span class="perf-pct good">${s.percent}%</span></div>`).join("")
    : `<p style="color:var(--muted);font-size:.85rem;padding:8px 0">No subjects at 75%+ yet.</p>`;

  document.getElementById("improve-list").innerHTML = analysis.needs_improvement.length
    ? analysis.needs_improvement.map(s => `<div class="perf-item"><span>${s.subject}</span><span class="perf-pct bad">${s.percent}%</span></div>`).join("")
    : `<p style="color:var(--muted);font-size:.85rem;padding:8px 0">🎉 All subjects above 75%!</p>`;

  document.getElementById("subject-breakdown").innerHTML = Object.entries(subject_stats).map(([subj, st]) => {
    const p = st.percent, color = p >= 75 ? "#00a896" : p >= 50 ? "#f0a500" : "#e63946";
    return `<div class="subj-bar-row">
      <div class="subj-bar-meta"><span>${subj}</span><span style="color:${color};font-weight:600">${st.correct}/${st.total} — ${p}%</span></div>
      <div class="subj-bar-track"><div class="subj-bar-fill" style="width:0%;background:${color}" data-width="${p}"></div></div>
    </div>`;
  }).join("");
  setTimeout(() => document.querySelectorAll(".subj-bar-fill").forEach(b => b.style.width = b.dataset.width + "%"), 120);

  const diffEl = document.getElementById("diff-stats");
  diffEl.innerHTML = "";
  ["easy","medium","hard"].forEach(diff => {
    const d = difficulty_stats[diff] || {correct:0,total:0};
    const p = d.total > 0 ? Math.round(d.correct / d.total * 100) : 0;
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
      <div class="review-answer-info">
        ${!r.is_correct ? `Your answer: <span class="chosen-wrong">${r.chosen||"No answer"}</span> &nbsp;|&nbsp; ` : ""}
        Correct answer: <span class="correct-ans">${r.correct_answer}</span>
      </div>
      <div class="review-rationale"><strong>💡 Rationale:</strong> ${r.rationale}</div>
    </div>`).join("");

  switchTab("tab-analysis", null);
}

// ─── Tabs ─────────────────────────────────────────────────────────
function switchTab(tabId, clickedEl) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.getElementById(tabId)?.classList.add("active");
  if (clickedEl) { clickedEl.classList.add("active"); }
  else { document.querySelectorAll(".tab").forEach(t => { if (t.getAttribute("onclick")?.includes(tabId)) t.classList.add("active"); }); }
  SFX.navigate();
}

// ─── Leaderboard ─────────────────────────────────────────────────
async function loadLeaderboard() {
  ["leaderboard-list","leaderboard-list-home"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<p style="color:var(--muted);padding:16px 0 4px">Loading…</p>`;
  });

  try {
    const res  = await fetch("/api/leaderboard");
    const data = await res.json();

    const html = !data.leaderboard?.length
      ? `<p style="color:var(--muted);padding:16px 0 4px">No sessions yet. Be the first! 🏆</p>`
      : data.leaderboard.map((h, i) => {
          const rank  = i + 1;
          const pass  = parseFloat(h.best_score) >= 75;
          const medal = MEDAL[rank-1] || `#${rank}`;
          let dateStr = "—";
          try { const d = new Date(h.last_attempt); if (!isNaN(d)) dateStr = d.toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}); } catch(_){}
          return `
            <div class="lb-card ${pass?"lb-pass":"lb-fail"} ${rank<=3?"lb-top":""}">
              <div class="lb-rank">${medal}</div>
              <div class="lb-info">
                <div class="lb-name">${h.username||"?"}</div>
                <div class="lb-meta">${parseInt(h.sessions||1)} session${h.sessions!=1?"s":""} · Avg: ${parseFloat(h.avg_score||0).toFixed(1)}%</div>
              </div>
              <div class="lb-score">
                <div class="lb-best">${parseFloat(h.best_score||0).toFixed(1)}%</div>
                <div class="lb-verdict" style="color:${pass?"var(--teal-light)":"#ff8a8a"}">${pass?"✅ PASSED":"📚 KEEP GOING"}</div>
              </div>
            </div>`;
        }).join("");

    ["leaderboard-list","leaderboard-list-home"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });

  } catch(e) {
    ["leaderboard-list","leaderboard-list-home"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p style="color:var(--muted);padding:16px 0 4px">Failed to load.</p>`;
    });
  }
}

// ─── History ─────────────────────────────────────────────────────
async function loadHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = `<p style="color:var(--muted);padding:20px 0">Loading…</p>`;
  try {
    const res  = await fetch("/api/history");
    const data = await res.json();
    if (!data.history.length) { list.innerHTML = `<p style="color:var(--muted);padding:20px 0">No sessions yet.</p>`; return; }
    list.innerHTML = data.history.map(h => {
      const pass = h.score_percent >= 75;
      const date = new Date(h.created_at).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
      const mins = Math.floor((h.time_taken_seconds||0)/60), secs=(h.time_taken_seconds||0)%60;
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

// ─── Load leaderboard on home screen boot ────────────────────────
document.addEventListener("DOMContentLoaded", () => { loadLeaderboard(); });
