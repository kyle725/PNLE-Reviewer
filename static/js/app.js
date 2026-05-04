// ─── State ─────────────────────────────────────────────────────────
const State = {
  questions: [],
  answers: {},       // { question_id: "A" }
  currentIndex: 0,
  timerInterval: null,
  elapsedSeconds: 0,
  sessionId: null,
  username: "Nurse",
};

// ─── Screen Management ──────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'screen-history') loadHistory();
}

// ─── Pill Groups ────────────────────────────────────────────────────
document.querySelectorAll('.pill-group').forEach(group => {
  group.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});

// ─── Start Quiz ─────────────────────────────────────────────────────
async function startQuiz() {
  const subject    = document.getElementById('subject-select').value;
  const difficulty = document.querySelector('#diff-group .pill.active')?.dataset.value || 'all';
  const count      = parseInt(document.querySelector('#count-group .pill.active')?.dataset.value || 10);
  State.username   = document.getElementById('username').value.trim() || 'Nurse';
  State.sessionId  = 'SES_' + Date.now();
  State.answers    = {};
  State.currentIndex = 0;
  State.elapsedSeconds = 0;

  try {
    const params = new URLSearchParams({ subject, difficulty, count });
    const res  = await fetch(`/api/questions?${params}`);
    const data = await res.json();

    if (!data.questions || data.questions.length === 0) {
      alert('No questions found for this filter. Try different settings.');
      return;
    }

    State.questions = data.questions;
    showScreen('screen-quiz');
    initNavMode();
    renderQuestion();
    startTimer();
  } catch (err) {
    alert('Failed to load questions. Is the Flask server running?');
    console.error(err);
  }
}

// ─── Timer ──────────────────────────────────────────────────────────
function startTimer() {
  clearInterval(State.timerInterval);
  document.getElementById('quiz-timer').textContent = '00:00';
  State.timerInterval = setInterval(() => {
    State.elapsedSeconds++;
    const m = Math.floor(State.elapsedSeconds / 60).toString().padStart(2, '0');
    const s = (State.elapsedSeconds % 60).toString().padStart(2, '0');
    document.getElementById('quiz-timer').textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(State.timerInterval);
}

// ─── Render Question ────────────────────────────────────────────────
function renderQuestion() {
  const q     = State.questions[State.currentIndex];
  const total = State.questions.length;
  const idx   = State.currentIndex;

  // Progress bar
  const pct = ((idx + 1) / total) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `${idx + 1} / ${total}`;

  // Meta badges
  document.getElementById('q-subject').textContent = q.subject;
  document.getElementById('q-topic').textContent   = q.topic;

  const diffBadge = document.getElementById('q-diff');
  diffBadge.textContent = q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1);
  const diffColors = {
    easy:   { bg: '#e6f7f5', color: '#00a896', border: '#00a896' },
    medium: { bg: '#fff8e7', color: '#a07000', border: '#f0a500' },
    hard:   { bg: '#fdecea', color: '#e63946', border: '#e63946' },
  };
  const dc = diffColors[q.difficulty] || diffColors.easy;
  diffBadge.style.background   = dc.bg;
  diffBadge.style.color        = dc.color;
  diffBadge.style.borderColor  = dc.border;

  document.getElementById('q-number').textContent    = `Question ${idx + 1}`;
  document.getElementById('question-text').textContent = q.question;

  // Build choices
  const container = document.getElementById('choices-container');
  container.innerHTML = '';

  // Remove any old rationale
  const oldRationale = document.querySelector('.rationale-box');
  if (oldRationale) oldRationale.remove();

  const letters       = ['A', 'B', 'C', 'D', 'E'];
  const alreadyChosen = State.answers[q.id];

  q.choices.forEach((choice, i) => {
    const letter = letters[i];
    const btn    = document.createElement('button');
    btn.className        = 'choice-btn';
    btn.dataset.letter   = letter;

    // Strip leading "A. " etc if present in the question data
    const choiceText = choice.replace(/^[A-E]\.\s*/, '');
    btn.innerHTML = `<span class="choice-letter">${letter}</span><span>${choiceText}</span>`;

    if (alreadyChosen !== undefined) {
      btn.disabled = true;
      if (letter === alreadyChosen) btn.classList.add('selected');
    } else {
      btn.addEventListener('click', () => selectAnswer(q.id, letter));
    }

    container.appendChild(btn);
  });

  // Dot navigation
  renderDots();

  // Prev button
  document.getElementById('btn-prev').disabled = (idx === 0);

  // Next / Submit button
  const isLast  = (idx === total - 1);
  const btnNext = document.getElementById('btn-next');

  if (isLast) {
    const allAnswered = State.questions.every(qq => State.answers[qq.id] !== undefined);
    btnNext.textContent = 'Submit Quiz ✓';
    btnNext.onclick     = submitQuiz;
    if (allAnswered) {
      btnNext.style.background = 'linear-gradient(135deg, #e63946, #ff6b6b)';
      btnNext.style.boxShadow  = '0 4px 16px rgba(230,57,70,0.4)';
    } else {
      btnNext.style.background = '';
      btnNext.style.boxShadow  = '';
    }
  } else {
    btnNext.textContent      = 'Next →';
    btnNext.onclick          = nextQuestion;
    btnNext.style.background = '';
    btnNext.style.boxShadow  = '';
  }
}

// Switch between dots (≤30) and progress bar (>30) once per session
function initNavMode() {
  const useDots = State.questions.length <= 30;
  document.getElementById('dot-nav').classList.toggle('hidden', !useDots);
  document.getElementById('q-progress-indicator').classList.toggle('hidden', useDots);
  document.getElementById('q-total-count').textContent = State.questions.length;
}

function renderDots() {
  const total = State.questions.length;

  if (total <= 30) {
    // ── Dot mode ──────────────────────────────────────────────────
    const nav = document.getElementById('dot-nav');
    nav.innerHTML = '';
    State.questions.forEach((q, i) => {
      const dot = document.createElement('div');
      dot.className = 'dot';
      if (State.answers[q.id] !== undefined) dot.classList.add('answered');
      if (i === State.currentIndex)          dot.classList.add('current');
      dot.title = `Q${i + 1}`;
      dot.addEventListener('click', () => {
        State.currentIndex = i;
        renderQuestion();
      });
      nav.appendChild(dot);
    });
  } else {
    // ── Bar mode ───────────────────────────────────────────────────
    const answeredCount = Object.keys(State.answers).length;
    const pct = Math.round((answeredCount / total) * 100);
    document.getElementById('q-progress-answered').style.width = pct + '%';
    document.getElementById('q-answered-count').textContent = answeredCount;
  }
}

// ─── Answer Selection ────────────────────────────────────────────────
function selectAnswer(questionId, letter) {
  // Save answer (overwrite if changing)
  State.answers[questionId] = letter;

  // Update visual highlight — clear all, mark selected
  const container = document.getElementById('choices-container');
  container.querySelectorAll('.choice-btn').forEach(btn => {
    btn.classList.remove('selected');
    if (btn.dataset.letter === letter) btn.classList.add('selected');
  });

  renderDots();

  // If on last question, update submit button style when all answered
  if (State.currentIndex === State.questions.length - 1) {
    const btnNext     = document.getElementById('btn-next');
    const allAnswered = State.questions.every(qq => State.answers[qq.id] !== undefined);
    if (allAnswered) {
      btnNext.style.background = 'linear-gradient(135deg, #e63946, #ff6b6b)';
      btnNext.style.boxShadow  = '0 4px 16px rgba(230,57,70,0.4)';
    }
  }
}

// ─── Navigation ──────────────────────────────────────────────────────
function nextQuestion() {
  if (State.currentIndex < State.questions.length - 1) {
    State.currentIndex++;
    renderQuestion();
    window.scrollTo(0, 0);
  }
}

function prevQuestion() {
  if (State.currentIndex > 0) {
    State.currentIndex--;
    renderQuestion();
    window.scrollTo(0, 0);
  }
}

// ─── Submit Quiz ─────────────────────────────────────────────────────
async function submitQuiz() {
  const unanswered = State.questions.filter(q => State.answers[q.id] === undefined).length;
  if (unanswered > 0) {
    if (!confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`)) return;
  }

  stopTimer();

  const payload = {
    session_id: State.sessionId,
    username:   State.username,
    answers:    State.answers,
    time_taken: State.elapsedSeconds,
  };

  try {
    const res  = await fetch('/api/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    renderResults(data);
    showScreen('screen-results');
  } catch (err) {
    alert('Error submitting quiz. Check the console for details.');
    console.error(err);
  }
}

// ─── Exit Modal ──────────────────────────────────────────────────────
function confirmExit() {
  document.getElementById('modal-message').textContent =
    'Exit this quiz? Your progress will be lost.';
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}
function exitQuiz() {
  stopTimer();
  closeModal();
  showScreen('screen-home');
}

// ─── Render Results ───────────────────────────────────────────────────
function renderResults(data) {
  const { score, results, subject_stats, difficulty_stats, analysis } = data;

  // Animate score ring
  const pct         = score.percent;
  const circumference = 314; // 2π × 50
  const offset       = circumference - (pct / 100) * circumference;
  const ringEl       = document.getElementById('ring-fill');

  // Reset then animate
  ringEl.style.strokeDashoffset = circumference;
  ringEl.style.stroke           = pct >= 75 ? 'var(--teal)' : 'var(--red)';
  setTimeout(() => { ringEl.style.strokeDashoffset = offset; }, 80);

  document.getElementById('res-score-pct').textContent = pct + '%';
  document.getElementById('res-verdict').textContent   = score.verdict;
  document.getElementById('res-correct-text').textContent =
    `${score.correct} / ${score.total} correct`;

  const mins = Math.floor(score.time_taken / 60);
  const secs = score.time_taken % 60;
  document.getElementById('res-time-text').textContent =
    `⏱ ${mins}m ${secs}s taken`;

  const vmsg = document.getElementById('res-verdict-msg');
  vmsg.textContent = score.verdict_msg;
  vmsg.className   = 'verdict-msg ' + (score.verdict === 'PASSED' ? 'verdict-pass' : 'verdict-fail');

  // Strengths list
  const strengthsList = document.getElementById('strengths-list');
  strengthsList.innerHTML = analysis.strengths.length
    ? analysis.strengths.map(s => `
        <div class="perf-item">
          <span>${s.subject}</span>
          <span class="perf-pct good">${s.percent}%</span>
        </div>`).join('')
    : '<p style="color:var(--muted);font-size:0.85rem;padding:8px 0">No subjects at 75%+ yet. Keep studying!</p>';

  // Improvements list
  const improveList = document.getElementById('improve-list');
  improveList.innerHTML = analysis.needs_improvement.length
    ? analysis.needs_improvement.map(s => `
        <div class="perf-item">
          <span>${s.subject}</span>
          <span class="perf-pct bad">${s.percent}%</span>
        </div>`).join('')
    : '<p style="color:var(--muted);font-size:0.85rem;padding:8px 0">🎉 All subjects above 75%!</p>';

  // Subject breakdown bars
  const breakdown = document.getElementById('subject-breakdown');
  breakdown.innerHTML = Object.entries(subject_stats).map(([subj, stats]) => {
    const p     = stats.percent;
    const color = p >= 75 ? '#00a896' : p >= 50 ? '#f0a500' : '#e63946';
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
  }).join('');

  // Animate bars after a short delay
  setTimeout(() => {
    document.querySelectorAll('.subj-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.width + '%';
    });
  }, 120);

  // Difficulty stats
  const diffStatsEl = document.getElementById('diff-stats');
  diffStatsEl.innerHTML = '';
  ['easy', 'medium', 'hard'].forEach(diff => {
    const d = difficulty_stats[diff];
    const p = d.total > 0 ? Math.round(d.correct / d.total * 100) : 0;
    const card = document.createElement('div');
    card.className = `diff-stat-card ${diff}`;
    card.innerHTML = `
      <div class="diff-label">${diff.toUpperCase()}</div>
      <div class="diff-stat-pct">${p}%</div>
      <div class="diff-sub">${d.correct}/${d.total} correct</div>`;
    diffStatsEl.appendChild(card);
  });

  // Review answers
  const reviewList = document.getElementById('review-list');
  reviewList.innerHTML = results.map((r, i) => `
    <div class="review-item ${r.is_correct ? 'correct' : 'incorrect'}">
      <div class="review-item-header">
        <span class="review-status ${r.is_correct ? 'correct' : 'incorrect'}">
          ${r.is_correct ? '✔ Correct' : '✘ Incorrect'}
        </span>
        <span style="font-size:0.75rem;color:var(--muted)">${r.subject} · ${r.difficulty}</span>
      </div>
      <div class="review-q-text">Q${i + 1}: ${r.question}</div>
      <div class="review-answer-info">
        ${!r.is_correct
          ? `Your answer: <span class="chosen-wrong">${r.chosen}</span> &nbsp;|&nbsp; `
          : ''}
        Correct answer: <span class="correct-ans">${r.correct_answer}</span>
      </div>
      <div class="review-rationale">
        <strong>💡 Rationale:</strong> ${r.rationale}
      </div>
    </div>
  `).join('');

  // Reset tabs to Analysis
  switchTab('tab-analysis', document.querySelector('.tab.active') || document.querySelector('.tab'));
}

// ─── Tab Switching ────────────────────────────────────────────────────
function switchTab(tabId, clickedEl) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  // Remove active from all tab buttons
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  // Show selected tab content
  const tabContent = document.getElementById(tabId);
  if (tabContent) tabContent.classList.add('active');
  // Mark button active — find it by onclick attribute if no element passed
  if (clickedEl) {
    clickedEl.classList.add('active');
  } else {
    document.querySelectorAll('.tab').forEach(t => {
      if (t.getAttribute('onclick') && t.getAttribute('onclick').includes(tabId)) {
        t.classList.add('active');
      }
    });
  }
}



// ─── History ──────────────────────────────────────────────────────────
async function loadHistory() {
  const list  = document.getElementById('history-list');
  list.innerHTML = '<p style="color:var(--muted);padding:20px 0">Loading...</p>';
  try {
    const res  = await fetch('/api/history');
    const data = await res.json();

    if (!data.history.length) {
      list.innerHTML = '<p style="color:var(--muted);padding:20px 0">No sessions yet. Take a quiz first!</p>';
      return;
    }

    list.innerHTML = data.history.map(h => {
      const pass  = h.score_percent >= 75;
      const date  = new Date(h.created_at).toLocaleDateString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      const mins  = Math.floor((h.time_taken_seconds || 0) / 60);
      const secs  = (h.time_taken_seconds || 0) % 60;
      return `
        <div class="history-card">
          <div class="history-score-badge ${pass ? 'pass' : 'fail'}">${h.score_percent}%</div>
          <div class="history-info">
            <div class="history-name">${h.username}</div>
            <div class="history-meta">${date} &nbsp;·&nbsp; ${mins}m ${secs}s</div>
          </div>
          <div class="history-correct">
            ${h.correct_answers} / ${h.total_questions}<br>
            <span style="font-size:0.75rem;font-weight:600;color:${pass ? 'var(--teal)' : 'var(--red)'}">
              ${pass ? 'PASSED' : 'FAILED'}
            </span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<p style="color:var(--muted);padding:20px 0">Failed to load history.</p>';
  }
}
