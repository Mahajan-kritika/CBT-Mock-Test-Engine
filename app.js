(() => {
  "use strict";

  const STORAGE_KEY = "cbt-mock-test-engine-v1";
  const OPTION_KEYS = ["A", "B", "C", "D"];
  const app = document.getElementById("app");
  const topbarRight = document.getElementById("topbar-right");
  const fileInput = document.createElement("input");
  const toast = document.getElementById("toast");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.className = "file-input";
  fileInput.setAttribute("aria-label", "Choose a JSON question paper");
  document.body.append(fileInput);

  let paper = null;
  let questions = [];
  let progress = null;
  let screen = "home";
  let reviewReturnScreen = "results";
  let timerHandle = null;
  let toastHandle = null;
  let latestNotice = "";
  let autoSubmittedOnLoad = false;
  let lastRenderedScreen = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainder = safe % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    if (minutes > 0) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
    return `${remainder}s`;
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainder = safe % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toast.classList.remove("visible"), 2800);
  }

  function parsePaper(data) {
    const errors = [];
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("The file must contain one JSON object at the top level.");
    }
    if (typeof data.testTitle !== "string" || !data.testTitle.trim()) {
      errors.push('"testTitle" must be a non-empty string.');
    }
    if (!Number.isFinite(data.durationMinutes) || data.durationMinutes <= 0) {
      errors.push('"durationMinutes" must be a number greater than 0.');
    }
    if (!Array.isArray(data.subjects) || data.subjects.length === 0) {
      errors.push('"subjects" must be a non-empty array.');
    }
    if (errors.length) throw new Error(errors.join(" "));

    const subjectNames = new Set();
    const flat = [];
    data.subjects.forEach((subject, subjectIndex) => {
      const subjectLabel = `Subject ${subjectIndex + 1}`;
      if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
        errors.push(`${subjectLabel} must be an object.`);
        return;
      }
      if (typeof subject.name !== "string" || !subject.name.trim()) {
        errors.push(`${subjectLabel} needs a non-empty "name".`);
      } else if (subjectNames.has(subject.name.trim().toLowerCase())) {
        errors.push(`Subject name "${subject.name.trim()}" is repeated.`);
      } else {
        subjectNames.add(subject.name.trim().toLowerCase());
      }
      if (!Number.isFinite(subject.positiveMarks) || subject.positiveMarks < 0) {
        errors.push(`${subjectLabel} "positiveMarks" must be 0 or greater.`);
      }
      if (!Number.isFinite(subject.negativeMarks) || subject.negativeMarks < 0) {
        errors.push(`${subjectLabel} "negativeMarks" must be 0 or greater.`);
      }
      if (!Array.isArray(subject.questions) || subject.questions.length === 0) {
        errors.push(`${subjectLabel} needs a non-empty "questions" array.`);
        return;
      }
      subject.questions.forEach((question, questionIndex) => {
        const label = `${subject.name || subjectLabel}, question ${questionIndex + 1}`;
        if (!question || typeof question !== "object" || Array.isArray(question)) {
          errors.push(`${label} must be an object.`);
          return;
        }
        if (!(typeof question.id === "string" || typeof question.id === "number") || String(question.id).trim() === "") {
          errors.push(`${label} needs a string or number "id".`);
        }
        if (typeof question.question !== "string" || !question.question.trim()) {
          errors.push(`${label} needs a non-empty "question".`);
        }
        if (!question.options || typeof question.options !== "object" || Array.isArray(question.options) ||
            !OPTION_KEYS.every((key) => typeof question.options[key] === "string" && question.options[key].trim())) {
          errors.push(`${label} needs four non-empty options named A, B, C and D.`);
        }
        if (!OPTION_KEYS.includes(question.correctAnswer)) {
          errors.push(`${label} "correctAnswer" must be A, B, C or D.`);
        }
        if (question.explanation !== undefined && typeof question.explanation !== "string") {
          errors.push(`${label} "explanation" must be a string when provided.`);
        }
        flat.push({
          index: flat.length,
          subjectIndex,
          subject: typeof subject.name === "string" ? subject.name.trim() : subjectLabel,
          positiveMarks: Number.isFinite(subject.positiveMarks) ? subject.positiveMarks : 0,
          negativeMarks: Number.isFinite(subject.negativeMarks) ? subject.negativeMarks : 0,
          id: question.id,
          text: question.question,
          options: question.options || {},
          correctAnswer: question.correctAnswer,
          explanation: question.explanation || ""
        });
      });
    });
    if (errors.length) {
      throw new Error(`Please fix the following in your question file:\n${errors.slice(0, 8).map((error) => `• ${error}`).join("\n")}${errors.length > 8 ? `\n• …and ${errors.length - 8} more issue(s).` : ""}`);
    }
    return { paper: data, questions: flat };
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ paper, progress }));
    } catch (error) {
      showToast(`Could not save your progress: ${error.message}`);
    }
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (stored && stored.paper) {
        const parsed = parsePaper(stored.paper);
        paper = parsed.paper;
        questions = parsed.questions;
        progress = stored.progress && stored.progress.answers?.length === questions.length
          ? stored.progress : null;
        if (progress?.status === "in-progress") {
          const now = Date.now();
          progress.remainingSeconds = remainingSeconds();
          if (progress.currentQuestionStartedAt) {
            const index = progress.currentIndex;
            if (Number.isInteger(index) && index >= 0 && index < questions.length) {
              progress.questionTimeMs[index] = (progress.questionTimeMs[index] || 0) + Math.max(0, now - progress.currentQuestionStartedAt);
            }
          }
          progress.currentQuestionStartedAt = now;
          if (progress.remainingSeconds <= 0) {
            autoSubmittedOnLoad = true;
            submitTest(true);
          }
          else saveStore();
        }
      }
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
      paper = null;
      questions = [];
      progress = null;
      latestNotice = `Saved test data could not be restored and was cleared: ${error.message}`;
    }
  }

  function currentIndex() {
    return progress ? progress.currentIndex : 0;
  }

  function remainingSeconds() {
    if (!progress?.endAt) return 0;
    return Math.max(0, Math.ceil((progress.endAt - Date.now()) / 1000));
  }

  function startQuestionClock() {
    if (!progress || progress.status !== "in-progress") return;
    progress.currentQuestionStartedAt = Date.now();
  }

  function stopQuestionClock() {
    if (!progress || progress.status !== "in-progress" || !progress.currentQuestionStartedAt) return;
    const index = progress.currentIndex;
    progress.questionTimeMs[index] = (progress.questionTimeMs[index] || 0) +
      Math.max(0, Date.now() - progress.currentQuestionStartedAt);
    progress.currentQuestionStartedAt = Date.now();
  }

  function saveProgress() {
    if (progress?.status === "in-progress") progress.remainingSeconds = remainingSeconds();
    saveStore();
  }

  function beginTest() {
    if (!paper || !questions.length) return;
    const now = Date.now();
    progress = {
      status: "in-progress",
      answers: Array(questions.length).fill(null),
      visited: Array(questions.length).fill(false),
      marked: Array(questions.length).fill(false),
      questionTimeMs: Array(questions.length).fill(0),
      currentIndex: 0,
      startedAt: now,
      endAt: now + paper.durationMinutes * 60 * 1000,
      remainingSeconds: paper.durationMinutes * 60,
      currentQuestionStartedAt: now,
      submittedAt: null
    };
    progress.visited[0] = true;
    screen = "exam";
    saveProgress();
    render();
    startTimer();
  }

  function resumeTest() {
    if (!progress || progress.status !== "in-progress") return;
    progress.currentQuestionStartedAt = Date.now();
    progress.visited[progress.currentIndex] = true;
    screen = "exam";
    saveProgress();
    render();
    startTimer();
  }

  function clearProgress() {
    if (!window.confirm("Clear this saved test and all exam progress from this device? This cannot be undone.")) return;
    stopTimer();
    paper = null;
    questions = [];
    progress = null;
    saveStore();
    showToast("Saved test progress cleared.");
    render();
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(() => {
      if (!progress || progress.status !== "in-progress") {
        stopTimer();
        return;
      }
      const seconds = remainingSeconds();
      progress.remainingSeconds = seconds;
      const timer = document.getElementById("exam-timer");
      if (timer) {
        timer.textContent = formatClock(seconds);
        timer.classList.toggle("warning", seconds <= 300);
        timer.setAttribute("aria-label", `${formatDuration(seconds)} remaining`);
      }
      saveStore();
      if (seconds <= 300 && seconds > 0 && seconds % 60 === 0) showToast(`${formatDuration(seconds)} remaining.`);
      if (seconds <= 0) submitTest(true);
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function getCounts() {
    const counts = { answered: 0, unanswered: 0, notVisited: 0, marked: 0 };
    questions.forEach((_, index) => {
      if (progress.answers[index]) counts.answered += 1;
      else if (!progress.visited[index]) counts.notVisited += 1;
      else counts.unanswered += 1;
      if (progress.marked[index]) counts.marked += 1;
    });
    return counts;
  }

  function statusClass(index) {
    const answered = Boolean(progress.answers[index]);
    if (progress.marked[index] && answered) return "answered-marked";
    if (progress.marked[index]) return "marked";
    if (answered) return "answered";
    if (progress.visited[index]) return "visited";
    return "not-visited";
  }

  function recordAnswer(answer) {
    if (!progress || progress.status !== "in-progress" || screen !== "exam") return;
    progress.answers[progress.currentIndex] = answer;
    saveProgress();
    render();
  }

  function navigateTo(index) {
    if (!progress || index < 0 || index >= questions.length) return;
    if (progress.status === "in-progress") stopQuestionClock();
    progress.currentIndex = index;
    if (!progress.visited[index]) progress.visited[index] = true;
    if (progress.status === "in-progress") startQuestionClock();
    saveProgress();
    render();
  }

  function nextQuestion() {
    if (currentIndex() < questions.length - 1) navigateTo(currentIndex() + 1);
  }

  function previousQuestion() {
    if (currentIndex() > 0) navigateTo(currentIndex() - 1);
  }

  function toggleReviewFlag() {
    if (!progress || progress.status !== "in-progress" || screen !== "exam") return;
    progress.marked[progress.currentIndex] = !progress.marked[progress.currentIndex];
    saveProgress();
    render();
  }

  function getResults() {
    const subjectResults = paper.subjects.map((subject, subjectIndex) => ({
      name: subject.name,
      positiveMarks: subject.positiveMarks,
      negativeMarks: subject.negativeMarks,
      total: 0,
      correct: 0,
      incorrect: 0,
      unanswered: 0,
      score: 0,
      maxScore: 0
    }));
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    let score = 0;
    let maxScore = 0;
    questions.forEach((question, index) => {
      const subjectResult = subjectResults[question.subjectIndex];
      subjectResult.total += 1;
      subjectResult.maxScore += question.positiveMarks;
      maxScore += question.positiveMarks;
      if (!progress.answers[index]) {
        unanswered += 1;
        subjectResult.unanswered += 1;
        return;
      }
      if (progress.answers[index] === question.correctAnswer) {
        correct += 1;
        subjectResult.correct += 1;
        score += question.positiveMarks;
        subjectResult.score += question.positiveMarks;
      } else {
        incorrect += 1;
        subjectResult.incorrect += 1;
        score -= question.negativeMarks;
        subjectResult.score -= question.negativeMarks;
      }
    });
    const totalTimeMs = Math.max(0, Math.min(
      paper.durationMinutes * 60 * 1000,
      (progress.submittedAt || Date.now()) - progress.startedAt
    ));
    return {
      subjectResults, correct, incorrect, unanswered, score, maxScore,
      accuracy: correct + incorrect > 0 ? (correct / (correct + incorrect)) * 100 : 0,
      totalTimeMs
    };
  }

  function submitTest(automatic = false) {
    if (!progress || progress.status !== "in-progress") return;
    const unanswered = questions.length - progress.answers.filter(Boolean).length;
    if (!automatic && !window.confirm(
      unanswered > 0
        ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit your test now?`
        : "Submit your test now? You will not be able to change your answers."
    )) return;
    stopQuestionClock();
    progress.status = "submitted";
    progress.submittedAt = Date.now();
    progress.remainingSeconds = remainingSeconds();
    progress.currentQuestionStartedAt = null;
    screen = "results";
    stopTimer();
    saveProgress();
    render();
    if (automatic) showToast("Time is up. Your examination has been submitted.");
  }

  function enterReview() {
    if (!progress || progress.status !== "submitted") return;
    reviewReturnScreen = screen === "results" ? "results" : "results";
    progress.currentIndex = 0;
    screen = "review";
    render();
  }

  function leaveReview() {
    screen = reviewReturnScreen;
    render();
  }

  function switchSubject(value) {
    const subjectIndex = Number(value);
    const first = questions.findIndex((question) => question.subjectIndex === subjectIndex);
    if (first >= 0) navigateTo(first);
  }

  function renderHeader() {
    document.body.classList.toggle("exam-mode", screen === "exam" || screen === "review");
    if ((screen === "exam" || screen === "review") && paper && progress) {
      const question = questions[currentIndex()];
      const choices = paper.subjects.map((subject, index) =>
        `<option value="${index}" ${index === question.subjectIndex ? "selected" : ""}>${escapeHtml(subject.name)}</option>`
      ).join("");
      topbarRight.innerHTML = `
        <span class="header-test-title">${escapeHtml(paper.testTitle)}${screen === "review" ? " · Answer review" : ""}</span>
        <span class="header-divider" aria-hidden="true"></span>
        <select class="header-subject" id="subject-select" aria-label="Select subject">${choices}</select>
        ${screen === "exam" ? `<div class="timer" id="exam-timer" role="timer" aria-label="${formatDuration(remainingSeconds())} remaining">${formatClock(remainingSeconds())}</div><button class="button button-danger" id="submit-test">Submit Test</button>` : `<button class="button button-secondary" id="back-to-results">Back to Results</button>`}
      `;
      document.getElementById("subject-select").addEventListener("change", (event) => switchSubject(event.target.value));
      if (screen === "exam") document.getElementById("submit-test").addEventListener("click", () => submitTest());
      else document.getElementById("back-to-results").addEventListener("click", leaveReview);
    } else {
      topbarRight.innerHTML = "";
    }
  }

  function renderHome() {
    const active = progress?.status === "in-progress";
    const currentPaperCard = paper ? `
      <div class="paper-preview">
        <div class="paper-preview-title">${escapeHtml(paper.testTitle)}</div>
        <div class="paper-preview-meta">${questions.length} questions · ${paper.durationMinutes} minutes<br>${paper.subjects.map((subject) => escapeHtml(subject.name)).join(" · ")}</div>
      </div>` : "";
    app.innerHTML = `
      <section class="home-layout">
        <div class="welcome-card">
          <div class="eyebrow">Examination practice, made focused</div>
          <h1>Prepare with the confidence of the real thing.</h1>
          <p class="welcome-copy">A calm, realistic exam environment to practise at your own pace. Bring any compatible question paper and your progress stays safely on this device.</p>
          <ul class="feature-list">
            <li><span class="check-icon">✓</span> Multi-subject papers with custom marking schemes</li>
            <li><span class="check-icon">✓</span> Timed tests with refresh-safe progress recovery</li>
            <li><span class="check-icon">✓</span> Detailed results, explanations and time analysis</li>
          </ul>
        </div>
        <div class="upload-card">
          <div class="eyebrow">Your next mock test</div>
          <h2>Load a question paper</h2>
          <p>Choose a JSON paper from your device, or load the included sample to explore the exam experience.</p>
          ${latestNotice ? `<div class="notice error">${escapeHtml(latestNotice)}</div>` : ""}
          <div class="drop-zone" id="drop-zone">
            <div class="upload-symbol" aria-hidden="true">↑</div>
            <strong>Drop your JSON file here</strong>
            <small>or browse from your device · .json files</small>
            <button class="button button-secondary button-block" id="browse-paper">Choose question paper</button>
          </div>
          <div class="divider-label">or try a sample paper</div>
          <button class="button button-light button-block" id="load-sample">Load the 15-question sample</button>
          ${currentPaperCard}
          ${active ? `
            <div class="resume-card">
              <strong>Pick up where you left off</strong>
              <p>${escapeHtml(paper.testTitle)} · Question ${progress.currentIndex + 1} of ${questions.length} · ${formatDuration(remainingSeconds())} left</p>
              <button class="button button-primary button-block" id="resume-test">Resume examination</button>
              <button class="small-link" id="clear-progress">Clear saved test progress</button>
            </div>` : paper && progress?.status === "submitted" ? `
            <div class="resume-card">
              <strong>Your last examination is complete</strong>
              <p>Review your results, start this paper again, or load another question paper.</p>
              <div class="button-row">
                <button class="button button-primary" id="view-results">View results</button>
                <button class="button button-secondary" id="start-over">Restart paper</button>
              </div>
              <button class="small-link" id="clear-progress">Clear saved test progress</button>
            </div>` : paper ? `
            <button class="button button-primary button-block" id="continue-to-instructions">Review instructions and start</button>
            <button class="small-link" id="clear-progress">Clear loaded paper and progress</button>` : ""}
        </div>
      </section>
    `;
    document.getElementById("browse-paper").addEventListener("click", () => fileInput.click());
    document.getElementById("load-sample").addEventListener("click", loadSample);
    const dropZone = document.getElementById("drop-zone");
    dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragover");
      if (event.dataTransfer.files[0]) importFile(event.dataTransfer.files[0]);
    });
    document.getElementById("resume-test")?.addEventListener("click", resumeTest);
    document.getElementById("clear-progress")?.addEventListener("click", clearProgress);
    document.getElementById("view-results")?.addEventListener("click", () => { screen = "results"; render(); });
    document.getElementById("start-over")?.addEventListener("click", () => { screen = "instructions"; render(); });
    document.getElementById("continue-to-instructions")?.addEventListener("click", () => { screen = "instructions"; render(); });
  }

  function renderInstructions() {
    const schemes = paper.subjects.map((subject) => `
      <div class="scheme-row">
        <strong>${escapeHtml(subject.name)}</strong>
        <span>+${subject.positiveMarks} correct <span aria-hidden="true">·</span> −${subject.negativeMarks} incorrect</span>
      </div>`).join("");
    app.innerHTML = `
      <section class="instructions-card">
        <div class="instructions-top">
          <div>
            <div class="eyebrow">Before you begin</div>
            <h1>${escapeHtml(paper.testTitle)}</h1>
            <p class="muted">Take a moment to review the paper details and examination instructions.</p>
          </div>
          <button class="button button-secondary" id="back-home">← Back</button>
        </div>
        <div class="test-facts">
          <div class="fact"><span>Questions</span><strong>${questions.length}</strong></div>
          <div class="fact"><span>Duration</span><strong>${paper.durationMinutes} min</strong></div>
          <div class="fact"><span>Subjects</span><strong>${paper.subjects.length}</strong></div>
        </div>
        <h3>Marking scheme</h3>
        <div class="subject-schemes">${schemes}</div>
        <h3 style="margin-top:24px">Instructions</h3>
        <ol class="instructions-list">
          <li>The timer starts as soon as you begin. It continues if you refresh or leave this page.</li>
          <li>Select one answer per question. Use the palette or subject selector to move around.</li>
          <li>You can mark questions for review, change answers, or clear a response before submitting.</li>
          <li>Your test submits automatically when the timer reaches zero. You cannot change answers after submission.</li>
          <li>Your answers and remaining time are saved on this device so you can resume after a refresh.</li>
        </ol>
        <div class="button-row">
          <button class="button button-primary" id="begin-test">Begin examination</button>
          <button class="button button-secondary" id="fullscreen">Enter full screen</button>
        </div>
      </section>
    `;
    document.getElementById("back-home").addEventListener("click", () => { screen = "home"; render(); });
    document.getElementById("begin-test").addEventListener("click", beginTest);
    document.getElementById("fullscreen").addEventListener("click", toggleFullscreen);
  }

  function renderPalette() {
    const counts = getCounts();
    const groups = paper.subjects.map((subject, subjectIndex) => {
      const indexes = questions.map((question, index) => question.subjectIndex === subjectIndex ? index : -1).filter((index) => index >= 0);
      const buttons = indexes.map((index) => `
        <button class="palette-button ${statusClass(index)} ${index === currentIndex() ? "current" : ""}" data-question="${index}" aria-label="Question ${index + 1}, ${statusClass(index).replace("-", " ")}" ${screen === "review" ? "" : ""}>${index + 1}</button>
      `).join("");
      return `<div class="palette-subject"><span>${escapeHtml(subject.name)}</span><span>${indexes.length}</span></div><div class="palette-grid">${buttons}</div>`;
    }).join("");
    return `
      <aside class="panel palette-panel">
        <div class="palette-title"><h2>Question palette</h2><span>${questions.length} total</span></div>
        ${screen === "review" ? `<p class="review-callout"><strong>Answer review</strong><br>Correct options and explanations are shown for each question.</p>` : ""}
        <div class="palette-counts">
          <div class="count-chip"><strong>${counts.answered}</strong><span>Answered</span></div>
          <div class="count-chip"><strong>${counts.unanswered}</strong><span>Unanswered</span></div>
          <div class="count-chip"><strong>${counts.notVisited}</strong><span>Not visited</span></div>
          <div class="count-chip"><strong>${counts.marked}</strong><span>Marked for review</span></div>
        </div>
        <div class="legend">
          <div class="legend-item"><span class="legend-swatch swatch-not-visited"></span>Not visited</div>
          <div class="legend-item"><span class="legend-swatch swatch-visited"></span>Not answered</div>
          <div class="legend-item"><span class="legend-swatch swatch-answered"></span>Answered</div>
          <div class="legend-item"><span class="legend-swatch swatch-marked"></span>For review</div>
          <div class="legend-item"><span class="legend-swatch swatch-answered-marked"></span>Answered + review</div>
        </div>
        ${groups}
        <div class="palette-footer">${screen === "review" ? "Select any question to review its answer." : "Select a number to move directly to that question."}</div>
      </aside>
    `;
  }

  function renderQuestionPanel() {
    const index = currentIndex();
    const question = questions[index];
    const selected = progress.answers[index];
    const readOnly = screen === "review";
    const options = OPTION_KEYS.map((key) => {
      const selectedClass = selected === key ? "selected" : "";
      const answerClass = readOnly && key === question.correctAnswer ? "correct" :
        readOnly && selected === key && selected !== question.correctAnswer ? "incorrect" : "";
      const disabled = readOnly ? "aria-disabled=\"true\"" : `role="radio" aria-checked="${selected === key}" tabindex="0"`;
      return `
        <div class="option ${selectedClass} ${answerClass}" data-option="${key}" ${disabled}>
          <span class="option-letter">${key}</span>
          <span class="option-copy">${escapeHtml(question.options[key])}</span>
          ${readOnly && key === question.correctAnswer ? `<span class="muted" style="margin-left:auto;font-size:10px">Correct answer</span>` : ""}
        </div>`;
    }).join("");
    const reviewFeedback = readOnly ? `
      <div class="submission-banner">${selected === question.correctAnswer ? "Your answer is correct." : selected ? `Your answer was ${selected}; the correct answer is ${question.correctAnswer}.` : `You did not answer this question. Correct answer: ${question.correctAnswer}.`}${question.explanation ? `<br><strong>Explanation:</strong> ${escapeHtml(question.explanation)}` : ""}</div>` : "";
    return `
      <section class="panel question-panel">
        <div class="question-head">
          <span class="question-kicker"><strong>Question ${index + 1}</strong> of ${questions.length}</span>
          <span class="subject-pill">${escapeHtml(question.subject)}</span>
        </div>
        <div class="question-body">
          ${reviewFeedback}
          <h2>${escapeHtml(question.text)}</h2>
          <div class="options-list" role="radiogroup" aria-label="Answer options">${options}</div>
        </div>
        <div class="question-foot">
          <div class="question-foot-left">
            <button class="button button-secondary" id="previous-question" ${index === 0 ? "disabled" : ""}>← Previous</button>
            ${readOnly ? "" : `<button class="button button-secondary" id="clear-response" ${selected ? "" : "disabled"}>Clear response</button>`}
          </div>
          <div class="question-foot-right">
            ${readOnly ? "" : `<button class="button ${progress.marked[index] ? "button-light" : "button-secondary"}" id="mark-review">${progress.marked[index] ? "★ Marked" : "☆ Mark for review"}</button>`}
            <button class="button button-primary" id="next-question" ${index === questions.length - 1 ? "disabled" : ""}>${readOnly ? "Next question →" : "Save & Next →"}</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderExam() {
    const subject = questions[currentIndex()]?.subject || "";
    app.innerHTML = `
      <div class="exam-toolbar">
        <div class="exam-toolbar-left">
          <span class="eyebrow">${screen === "review" ? "Review answers" : "Examination in progress"}</span>
          <h1>${escapeHtml(subject)}</h1>
        </div>
        <div class="button-row">
          ${screen === "exam" ? `<button class="button button-secondary fullscreen-button" id="exam-fullscreen">⛶ Full screen</button>` : `<span class="muted" style="font-size:12px">Read-only answer review</span>`}
        </div>
      </div>
      ${screen === "review" ? `<div class="submission-banner">Examination submitted. Your answers are locked. Use the question palette to review each response.</div>` : ""}
      <div class="exam-layout">
        ${renderQuestionPanel()}
        ${renderPalette()}
      </div>
    `;
    document.querySelectorAll(".palette-button").forEach((button) => {
      button.addEventListener("click", () => navigateTo(Number(button.dataset.question)));
    });
    document.querySelectorAll(".option").forEach((option) => {
      if (screen !== "exam") return;
      option.addEventListener("click", () => recordAnswer(option.dataset.option));
      option.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          recordAnswer(option.dataset.option);
        }
      });
    });
    document.getElementById("previous-question").addEventListener("click", previousQuestion);
    document.getElementById("next-question").addEventListener("click", nextQuestion);
    document.getElementById("clear-response")?.addEventListener("click", () => recordAnswer(null));
    document.getElementById("mark-review")?.addEventListener("click", toggleReviewFlag);
    document.getElementById("exam-fullscreen")?.addEventListener("click", toggleFullscreen);
  }

  function renderResults() {
    const results = getResults();
    const accuracy = Math.round(results.accuracy);
    const subjectRows = results.subjectResults.map((subject) => `
      <tr>
        <td>${escapeHtml(subject.name)}</td><td>${subject.correct}</td><td>${subject.incorrect}</td>
        <td>${subject.unanswered}</td><td>${formatMarks(subject.score)}</td>
        <td>${subject.correct + subject.incorrect ? `${Math.round(subject.correct / (subject.correct + subject.incorrect) * 100)}%` : "—"}</td>
      </tr>`).join("");
    const timing = questions.map((question, index) => ({
      question, index, ms: progress.questionTimeMs[index] || 0
    }));
    const avgMs = questions.length ? results.totalTimeMs / questions.length : 0;
    const longest = [...timing].sort((a, b) => b.ms - a.ms).slice(0, 3);
    const analysis = questions.map((question, index) => {
      const answer = progress.answers[index];
      const correct = answer === question.correctAnswer;
      const state = !answer ? "unanswered" : correct ? "correct" : "incorrect";
      const awarded = !answer ? 0 : correct ? question.positiveMarks : -question.negativeMarks;
      return `
        <article class="analysis-item">
          <div class="analysis-item-top">
            <h3>Q${index + 1} · ${escapeHtml(question.subject)} — ${escapeHtml(question.text)}</h3>
            <span class="result-badge ${state}">${state === "unanswered" ? "Unanswered" : state === "correct" ? "Correct" : "Incorrect"}</span>
          </div>
          <div class="analysis-details">
            Your answer: <strong>${answer ? `${answer}. ${escapeHtml(question.options[answer])}` : "Not answered"}</strong><br>
            Correct answer: <strong>${question.correctAnswer}. ${escapeHtml(question.options[question.correctAnswer])}</strong><br>
            Marks: <strong>${formatMarks(awarded)}</strong> · Time spent: <strong>${formatDuration((progress.questionTimeMs[index] || 0) / 1000)}</strong>
          </div>
          ${question.explanation ? `<div class="analysis-explanation">${escapeHtml(question.explanation)}</div>` : ""}
        </article>`;
    }).join("");
    app.innerHTML = `
      <section class="result-heading">
        <div>
          <div class="eyebrow">Examination complete</div>
          <h1>${escapeHtml(paper.testTitle)}</h1>
          <p>Submitted ${new Date(progress.submittedAt).toLocaleString()}</p>
        </div>
        <div class="button-row">
          <button class="button button-secondary" id="review-answers">Review answers</button>
          <button class="button button-secondary" id="export-results">↓ Export results</button>
          <button class="button button-primary" id="restart-test">Restart test</button>
        </div>
      </section>
      <div class="result-layout">
        <section class="result-card">
          <h2>Overall performance</h2>
          <div class="score-overview">
            <div class="score-highlight"><strong>${formatMarks(results.score)}</strong><span>Marks obtained / ${formatMarks(results.maxScore)} maximum</span><small>${accuracy}% accuracy</small></div>
            <div class="score-tile"><strong>${questions.length}</strong><span>Total questions</span></div>
            <div class="score-tile"><strong>${results.correct}</strong><span>Correct answers</span></div>
            <div class="score-tile"><strong>${results.incorrect}</strong><span>Incorrect answers</span></div>
            <div class="score-tile"><strong>${results.unanswered}</strong><span>Unattempted</span></div>
          </div>
          <div class="performance-bar" role="img" aria-label="${accuracy}% accuracy"><span style="width:${accuracy}%"></span></div>
        </section>
        <section class="result-card">
          <h2>Time analysis</h2>
          <div class="time-summary">
            <div><strong>${formatDuration(results.totalTimeMs / 1000)}</strong><span>Total time taken</span></div>
            <div><strong>${formatDuration(avgMs / 1000)}</strong><span>Average / question</span></div>
            <div><strong>${formatDuration(paper.durationMinutes * 60 - results.totalTimeMs / 1000)}</strong><span>Time remaining</span></div>
          </div>
          <div class="time-ranking">
            <div class="eyebrow" style="letter-spacing:.07em;margin-bottom:1px">Most time spent</div>
            ${longest.map(({ question, index, ms }) => `<div class="time-ranking-row"><span>Q${index + 1} · ${escapeHtml(question.subject)}</span><strong>${formatDuration(ms / 1000)}</strong></div>`).join("")}
          </div>
        </section>
        <section class="result-card" style="grid-column:1/-1">
          <h2>Subject-wise performance</h2>
          <div style="overflow-x:auto">
            <table class="subject-table">
              <thead><tr><th>Subject</th><th>Correct</th><th>Incorrect</th><th>Unattempted</th><th>Marks</th><th>Accuracy</th></tr></thead>
              <tbody>${subjectRows}</tbody>
            </table>
          </div>
        </section>
      </div>
      <details class="panel analysis-section" id="analysis-section">
        <summary>Question-wise analysis <span style="font:400 11px 'DM Sans',sans-serif;color:#718096">${questions.length} questions</span></summary>
        <div class="analysis-list">${analysis}</div>
      </details>
    `;
    document.getElementById("review-answers").addEventListener("click", enterReview);
    document.getElementById("restart-test").addEventListener("click", () => {
      if (!window.confirm("Restart this paper? Your current results and answers will be replaced.")) return;
      beginTest();
    });
    document.getElementById("export-results").addEventListener("click", exportResults);
  }

  function formatMarks(value) {
    const normalized = Math.round(value * 100) / 100;
    return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
  }

  function exportResults() {
    const results = getResults();
    const payload = {
      testTitle: paper.testTitle,
      submittedAt: new Date(progress.submittedAt).toISOString(),
      overall: {
        totalQuestions: questions.length,
        correct: results.correct,
        incorrect: results.incorrect,
        unattempted: results.unanswered,
        marksObtained: Number(formatMarks(results.score)),
        maximumMarks: Number(formatMarks(results.maxScore)),
        accuracyPercent: Math.round(results.accuracy * 100) / 100,
        timeTakenSeconds: Math.round(results.totalTimeMs / 1000)
      },
      subjects: results.subjectResults.map((subject) => ({
        name: subject.name, correct: subject.correct, incorrect: subject.incorrect,
        unattempted: subject.unanswered, marksObtained: Number(formatMarks(subject.score)),
        accuracyPercent: subject.correct + subject.incorrect
          ? Math.round(subject.correct / (subject.correct + subject.incorrect) * 10000) / 100 : 0
      })),
      questions: questions.map((question, index) => ({
        number: index + 1, subject: question.subject, question: question.text,
        selectedAnswer: progress.answers[index],
        correctAnswer: question.correctAnswer,
        status: !progress.answers[index] ? "unanswered" :
          progress.answers[index] === question.correctAnswer ? "correct" : "incorrect",
        marksAwarded: progress.answers[index] === question.correctAnswer ? question.positiveMarks :
          progress.answers[index] ? -question.negativeMarks : 0,
        timeSpentSeconds: Math.round((progress.questionTimeMs[index] || 0) / 1000),
        explanation: question.explanation || undefined
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${paper.testTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "cbt-results"}-results.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Your result summary has been downloaded.");
  }

  function render() {
    const screenChanged = lastRenderedScreen !== screen;
    lastRenderedScreen = screen;
    renderHeader();
    if (screen === "home") renderHome();
    else if (screen === "instructions") renderInstructions();
    else if (screen === "exam" || screen === "review") renderExam();
    else if (screen === "results") renderResults();
    if (screenChanged) window.scrollTo(0, 0);
  }

  function importFile(file) {
    latestNotice = "";
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      latestNotice = "Please choose a .json question paper.";
      render();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const parsed = parsePaper(data);
        if (progress?.status === "in-progress" &&
            !window.confirm("Loading a new paper will replace your unfinished examination. Continue?")) return;
        stopTimer();
        paper = parsed.paper;
        questions = parsed.questions;
        progress = null;
        screen = "home";
        saveStore();
        render();
        showToast(`Loaded "${paper.testTitle}" — ${questions.length} questions ready.`);
      } catch (error) {
        latestNotice = error instanceof SyntaxError
          ? `This file is not valid JSON. Check for missing commas, quotes or braces. (${error.message})`
          : error.message;
        screen = "home";
        render();
      }
    };
    reader.onerror = () => {
      latestNotice = "The selected file could not be read. Please try another file.";
      render();
    };
    reader.readAsText(file);
    fileInput.value = "";
  }

  async function loadSample() {
    try {
      const response = await fetch("sample-questions.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Could not load sample paper (HTTP ${response.status}).`);
      const parsed = parsePaper(await response.json());
      if (progress?.status === "in-progress" &&
          !window.confirm("Loading a new paper will replace your unfinished examination. Continue?")) return;
      stopTimer();
      paper = parsed.paper;
      questions = parsed.questions;
      progress = null;
      screen = "home";
      latestNotice = "";
      saveStore();
      render();
      showToast("Sample question paper loaded.");
    } catch (error) {
      latestNotice = error.message.includes("fetch")
        ? "The sample paper could not be loaded. Open the app through a local web server, or import sample-questions.json."
        : error.message;
      render();
    }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      showToast(`Full-screen mode is unavailable: ${error.message}`);
    }
  }

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) importFile(fileInput.files[0]);
  });
  document.getElementById("home-link").addEventListener("click", (event) => {
    event.preventDefault();
    if (screen === "exam" && progress?.status === "in-progress") {
      if (!window.confirm("Your test will keep running in the background. Return to the test home?")) return;
      stopQuestionClock();
      saveProgress();
    }
    screen = "home";
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (screen !== "exam" && screen !== "review") return;
    if (event.altKey || event.ctrlKey || event.metaKey ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (event.key === "ArrowRight") { event.preventDefault(); nextQuestion(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); previousQuestion(); }
    else if (screen === "exam" && ["1", "2", "3", "4"].includes(event.key)) {
      recordAnswer(OPTION_KEYS[Number(event.key) - 1]);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && progress?.status === "in-progress") saveProgress();
  });
  window.addEventListener("beforeunload", () => {
    if (progress?.status === "in-progress") saveProgress();
  });

  loadStore();
  if (autoSubmittedOnLoad) screen = "results";
  else if (progress?.status === "submitted") screen = "home";
  else if (progress?.status === "in-progress") screen = "home";
  render();
  if (screen === "exam") startTimer();
})();
