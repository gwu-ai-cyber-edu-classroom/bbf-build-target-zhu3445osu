// Application State
let activeView = 'dashboard';
let quizzesList = [];
let activeQuiz = null;
let selectedAnswers = {}; // Map of questionIndex -> optionIndex
let authPasscodes = {}; // Cache of quizId -> passcode
let pendingAuthQuizId = null;

// DOM Elements
let themeToggleBtn;
let cardsContainer;
let passcodeContainer;
let creatorQuestionsList;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize elements
    themeToggleBtn = document.getElementById('theme-toggle');
    cardsContainer = document.getElementById('cards-container');
    passcodeContainer = document.getElementById('passcode-container');
    creatorQuestionsList = document.getElementById('creator-questions-list');
    
    // Theme setup
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
    }
    
    themeToggleBtn.addEventListener('click', toggleTheme);
    
    // Add default first question in creator
    addQuestionToCreator();
    
    // Load dashboard data
    loadDashboard();
});

// View Navigation
function showView(viewName) {
    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.remove('active');
    });
    
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    // Update navigation buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (viewName === 'dashboard') {
        document.getElementById('nav-dashboard-btn').classList.add('active');
        loadDashboard();
    } else if (viewName === 'creator') {
        document.getElementById('nav-create-btn').classList.add('active');
    }
    
    activeView = viewName;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Theme management
function toggleTheme() {
    if (document.body.classList.contains('light-theme')) {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
    } else {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        localStorage.setItem('theme', 'light');
    }
}

// Fetch dashboard items (API call)
async function loadDashboard() {
    cardsContainer.innerHTML = '<div class="loading-state">Loading activities...</div>';
    
    try {
        const response = await fetch('/api/quizzes');
        if (!response.ok) {
            throw new Error('Failed to load quizzes');
        }
        
        quizzesList = await response.json();
        renderDashboardCards();
    } catch (err) {
        cardsContainer.innerHTML = `
            <div class="empty-state">
                <span class="error-text">⚠️ Error loading data: ${escapeHTML(err.message)}</span>
                <p>Please check your connection and ensure the server is running.</p>
            </div>`;
    }
}

// Safe escape function to prevent injection in any text fallback (P5)
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Render list of quizzes/polls securely (P5)
function renderDashboardCards() {
    cardsContainer.innerHTML = '';
    
    if (quizzesList.length === 0) {
        cardsContainer.innerHTML = '<div class="empty-state">No activities created yet. Be the first to create one!</div>';
        return;
    }
    
    quizzesList.forEach(quiz => {
        const card = document.createElement('div');
        card.className = `activity-card card-${quiz.type}`;
        card.onclick = () => selectActivity(quiz.id);
        
        const topRow = document.createElement('div');
        topRow.className = 'card-top';
        
        const typeBadge = document.createElement('span');
        typeBadge.className = `badge badge-${quiz.type}`;
        typeBadge.textContent = quiz.type === 'quiz' ? 'Quiz' : 'Poll';
        topRow.appendChild(typeBadge);
        
        if (quiz.is_private) {
            const privateBadge = document.createElement('span');
            privateBadge.className = 'badge badge-private';
            privateBadge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Private';
            topRow.appendChild(privateBadge);
        }
        
        const title = document.createElement('h3');
        title.className = 'card-title';
        title.textContent = quiz.title;
        
        const stats = document.createElement('div');
        stats.className = 'card-stats';
        
        const attemptStat = document.createElement('div');
        attemptStat.className = 'stat-item';
        attemptStat.textContent = `${quiz.stats.attempts} response${quiz.stats.attempts === 1 ? '' : 's'}`;
        stats.appendChild(attemptStat);
        
        const bottomRow = document.createElement('div');
        bottomRow.className = 'card-bottom';
        
        const actionText = document.createElement('span');
        actionText.className = 'card-action-text';
        actionText.textContent = quiz.type === 'quiz' ? 'Start Quiz →' : 'Vote Now →';
        bottomRow.appendChild(actionText);
        
        card.appendChild(topRow);
        card.appendChild(title);
        card.appendChild(stats);
        card.appendChild(bottomRow);
        
        cardsContainer.appendChild(card);
    });
}

// Select Quiz/Poll
async function selectActivity(quizId) {
    const quiz = quizzesList.find(q => q.id === quizId);
    if (!quiz) return;
    
    if (quiz.is_private && !authPasscodes[quizId]) {
        pendingAuthQuizId = quizId;
        openPasswordModal();
    } else {
        loadActivityPlay(quizId);
    }
}

// Passcode Modal Controls
function openPasswordModal() {
    document.getElementById('modal-passcode-input').value = '';
    document.getElementById('modal-error-msg').textContent = '';
    document.getElementById('password-modal').classList.add('active');
    document.getElementById('modal-passcode-input').focus();
}

function closePasswordModal() {
    document.getElementById('password-modal').classList.remove('active');
    pendingAuthQuizId = null;
}

async function submitPasswordModal() {
    const passcode = document.getElementById('modal-passcode-input').value;
    const errorMsg = document.getElementById('modal-error-msg');
    
    if (!passcode || passcode.trim() === '') {
        errorMsg.textContent = 'Passcode cannot be empty';
        return;
    }
    
    try {
        const response = await fetch(`/api/quizzes/${pendingAuthQuizId}?passcode=${encodeURIComponent(passcode)}`);
        if (response.status === 401) {
            errorMsg.textContent = 'Incorrect passcode. Access Denied.';
            return;
        }
        if (!response.ok) {
            throw new Error('Failed to verify passcode');
        }
        
        authPasscodes[pendingAuthQuizId] = passcode;
        const quizId = pendingAuthQuizId;
        closePasswordModal();
        loadActivityPlay(quizId);
    } catch (err) {
        errorMsg.textContent = 'Network or system error. Try again.';
    }
}

// Load Activity Play view details
async function loadActivityPlay(quizId) {
    const container = document.getElementById('activity-content');
    container.innerHTML = '<div class="loading-state">Loading activity details...</div>';
    showView('activity');
    
    try {
        const url = `/api/quizzes/${quizId}`;
        const headers = {};
        if (authPasscodes[quizId]) {
            headers['Authorization'] = authPasscodes[quizId];
        }
        
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error('Unauthorized or failed to retrieve activity');
        }
        
        activeQuiz = await response.json();
        renderActivityPlay();
    } catch (err) {
        container.innerHTML = `
            <div class="error-container">
                <h3>Access Error</h3>
                <p>${escapeHTML(err.message)}</p>
                <button class="btn btn-secondary btn-sm" style="margin-top: 1rem" onclick="showView('dashboard')">Return to Dashboard</button>
            </div>`;
    }
}

// Render Taking Quiz or Voting Poll securely (P5)
function renderActivityPlay() {
    const container = document.getElementById('activity-content');
    container.innerHTML = '';
    
    selectedAnswers = {};
    
    const header = document.createElement('div');
    header.className = 'activity-play-header';
    
    const title = document.createElement('h1');
    title.className = 'play-title';
    title.textContent = activeQuiz.title;
    
    const meta = document.createElement('div');
    meta.className = 'play-meta';
    
    const typeSpan = document.createElement('span');
    typeSpan.textContent = activeQuiz.type === 'quiz' ? '🏆 Trivia Quiz' : '📊 Feedback Poll';
    
    const countSpan = document.createElement('span');
    countSpan.textContent = `• ${activeQuiz.questions.length} Question${activeQuiz.questions.length === 1 ? '' : 's'}`;
    
    meta.appendChild(typeSpan);
    meta.appendChild(countSpan);
    header.appendChild(title);
    header.appendChild(meta);
    container.appendChild(header);
    
    const form = document.createElement('div');
    form.className = 'glass-card';
    
    activeQuiz.questions.forEach((q, qIdx) => {
        const qCard = document.createElement('div');
        qCard.className = 'play-question-card';
        
        const qText = document.createElement('h3');
        qText.className = 'play-question-text';
        qText.textContent = `${qIdx + 1}. ${q.question}`;
        qCard.appendChild(qText);
        
        const optsList = document.createElement('div');
        optsList.className = 'play-options-list';
        
        q.options.forEach((opt, optIdx) => {
            const optBtn = document.createElement('button');
            optBtn.className = 'play-option-btn';
            optBtn.id = `q-${qIdx}-opt-${optIdx}`;
            optBtn.onclick = () => selectOption(qIdx, optIdx);
            
            const letter = document.createElement('span');
            letter.className = 'option-letter';
            letter.textContent = String.fromCharCode(65 + optIdx);
            
            const text = document.createElement('span');
            text.className = 'option-text';
            text.textContent = opt;
            
            optBtn.appendChild(letter);
            optBtn.appendChild(text);
            optsList.appendChild(optBtn);
        });
        
        qCard.appendChild(optsList);
        form.appendChild(qCard);
    });
    
    const submitBtnRow = document.createElement('div');
    submitBtnRow.className = 'form-actions';
    
    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary';
    submitBtn.id = 'activity-submit-btn';
    submitBtn.textContent = activeQuiz.type === 'quiz' ? 'Submit Answers' : 'Submit Vote';
    submitBtn.onclick = submitActivityResponse;
    submitBtnRow.appendChild(submitBtn);
    
    form.appendChild(submitBtnRow);
    container.appendChild(form);
}

function selectOption(qIdx, optIdx) {
    activeQuiz.questions[qIdx].options.forEach((_, idx) => {
        const btn = document.getElementById(`q-${qIdx}-opt-${idx}`);
        if (btn) btn.classList.remove('selected');
    });
    
    const activeBtn = document.getElementById(`q-${qIdx}-opt-${optIdx}`);
    if (activeBtn) activeBtn.classList.add('selected');
    
    selectedAnswers[qIdx] = optIdx;
}

// Submit answers/votes to API (P2, P3, P5)
async function submitActivityResponse() {
    const questionsCount = activeQuiz.questions.length;
    const answeredCount = Object.keys(selectedAnswers).length;
    
    if (answeredCount < questionsCount) {
        alert('Please answer all questions before submitting.');
        return;
    }
    
    const submitBtn = document.getElementById('activity-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    
    try {
        const url = `/api/quizzes/${activeQuiz.id}/submit`;
        const headers = { 'Content-Type': 'application/json' };
        if (authPasscodes[activeQuiz.id]) {
            headers['Authorization'] = authPasscodes[activeQuiz.id];
        }
        
        let payload = {};
        if (activeQuiz.type === 'quiz') {
            payload.answers = [];
            for (let i = 0; i < questionsCount; i++) {
                payload.answers.push(selectedAnswers[i]);
            }
        } else {
            payload.votes = [];
            for (let i = 0; i < questionsCount; i++) {
                payload.votes.push(selectedAnswers[i]);
            }
        }
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error('Failed to submit response');
        }
        
        const submitResult = await response.json();
        loadResultsView(activeQuiz.id, submitResult);
    } catch (err) {
        alert(`Error submitting response: ${err.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = activeQuiz.type === 'quiz' ? 'Submit Answers' : 'Submit Vote';
    }
}

// Fetch and load Results View
async function loadResultsView(quizId, submitResult = null) {
    const container = document.getElementById('results-content');
    container.innerHTML = '<div class="loading-state">Loading results...</div>';
    showView('results');
    
    try {
        const url = `/api/quizzes/${quizId}/results`;
        const headers = {};
        if (authPasscodes[quizId]) {
            headers['Authorization'] = authPasscodes[quizId];
        }
        
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error('Unauthorized or failed to load results');
        }
        
        const results = await response.json();
        renderResults(results, submitResult);
    } catch (err) {
        container.innerHTML = `
            <div class="error-container">
                <h3>Results Access Denied</h3>
                <p>${escapeHTML(err.message)}</p>
                <button class="btn btn-secondary btn-sm" style="margin-top: 1rem" onclick="showView('dashboard')">Return to Dashboard</button>
            </div>`;
    }
}

// Render results view securely (P5)
function renderResults(results, submitResult) {
    const container = document.getElementById('results-content');
    container.innerHTML = '';
    
    const headerCard = document.createElement('div');
    headerCard.className = 'results-header-card glass-card';
    
    if (results.type === 'quiz' && submitResult) {
        const scoreWrapper = document.createElement('div');
        scoreWrapper.className = 'score-circle-wrapper';
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'score-circle-svg');
        svg.setAttribute('width', '140');
        svg.setAttribute('height', '140');
        
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const linearGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        linearGradient.setAttribute('id', 'score-gradient');
        linearGradient.setAttribute('x1', '0%');
        linearGradient.setAttribute('y1', '0%');
        linearGradient.setAttribute('x2', '100%');
        linearGradient.setAttribute('y2', '100%');
        
        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', '#8b5cf6');
        
        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', '#3b82f6');
        
        linearGradient.appendChild(stop1);
        linearGradient.appendChild(stop2);
        defs.appendChild(linearGradient);
        svg.appendChild(defs);
        
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('class', 'score-circle-bg');
        bgCircle.setAttribute('cx', '70');
        bgCircle.setAttribute('cy', '70');
        bgCircle.setAttribute('r', '60');
        
        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('class', 'score-circle-progress');
        progressCircle.setAttribute('cx', '70');
        progressCircle.setAttribute('cy', '70');
        progressCircle.setAttribute('r', '60');
        
        svg.appendChild(bgCircle);
        svg.appendChild(progressCircle);
        
        const textOverlay = document.createElement('div');
        textOverlay.className = 'score-text-overlay';
        
        const scoreNum = document.createElement('div');
        scoreNum.className = 'score-number';
        scoreNum.textContent = `${submitResult.score}/${submitResult.total_questions}`;
        
        const scorePct = document.createElement('div');
        scorePct.className = 'score-percentage';
        const percent = Math.round((submitResult.score / submitResult.total_questions) * 100);
        scorePct.textContent = `${percent}%`;
        
        textOverlay.appendChild(scoreNum);
        textOverlay.appendChild(scorePct);
        scoreWrapper.appendChild(svg);
        scoreWrapper.appendChild(textOverlay);
        headerCard.appendChild(scoreWrapper);
        
        setTimeout(() => {
            const radius = 60;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (percent / 100) * circumference;
            progressCircle.style.strokeDashoffset = offset;
        }, 100);
        
        const summaryText = document.createElement('h2');
        summaryText.className = 'results-summary-text';
        summaryText.textContent = percent >= 80 ? 'Excellent Work!' : percent >= 50 ? 'Good Effort!' : 'Keep Learning!';
        
        const subtext = document.createElement('p');
        subtext.className = 'results-subtext';
        subtext.textContent = `You answered ${submitResult.score} out of ${submitResult.total_questions} questions correctly.`;
        
        headerCard.appendChild(summaryText);
        headerCard.appendChild(subtext);
    } else {
        const summaryText = document.createElement('h2');
        summaryText.className = 'results-summary-text';
        summaryText.textContent = results.title;
        
        const subtext = document.createElement('p');
        subtext.className = 'results-subtext';
        subtext.textContent = `${results.attempts} response${results.attempts === 1 ? '' : 's'} recorded.`;
        
        headerCard.appendChild(summaryText);
        headerCard.appendChild(subtext);
    }
    
    container.appendChild(headerCard);
    
    const breakdownSection = document.createElement('div');
    breakdownSection.className = 'results-breakdown-section';
    
    const sectionTitle = document.createElement('h3');
    sectionTitle.className = 'results-section-title';
    sectionTitle.textContent = results.type === 'quiz' ? 'Review Answers' : 'Current Standings';
    breakdownSection.appendChild(sectionTitle);
    
    if (results.type === 'poll') {
        results.questions.forEach((q, qIdx) => {
            const qCard = document.createElement('div');
            qCard.className = 'poll-results-card glass-card';
            
            const qText = document.createElement('h3');
            qText.className = 'result-q-text';
            qText.textContent = `${qIdx + 1}. ${q.question}`;
            qCard.appendChild(qText);
            
            const totalVotes = q.votes.reduce((a, b) => a + b, 0);
            
            q.options.forEach((opt, optIdx) => {
                const votes = q.votes[optIdx];
                const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
                
                const row = document.createElement('div');
                row.className = 'poll-option-row';
                
                const info = document.createElement('div');
                info.className = 'poll-option-info';
                
                const optText = document.createElement('span');
                optText.textContent = opt;
                
                const optCount = document.createElement('span');
                optCount.textContent = `${votes} vote${votes === 1 ? '' : 's'} (${pct}%)`;
                
                info.appendChild(optText);
                info.appendChild(optCount);
                row.appendChild(info);
                
                const barContainer = document.createElement('div');
                barContainer.className = 'poll-bar-container';
                
                const fill = document.createElement('div');
                fill.className = 'poll-bar-fill';
                barContainer.appendChild(fill);
                row.appendChild(barContainer);
                
                qCard.appendChild(row);
                
                setTimeout(() => {
                    fill.style.width = `${pct}%`;
                }, 100);
            });
            
            breakdownSection.appendChild(qCard);
        });
    } else if (results.type === 'quiz' && submitResult) {
        activeQuiz.questions.forEach((q, qIdx) => {
            const submissionDetail = submitResult.details[qIdx];
            const qCard = document.createElement('div');
            qCard.className = 'result-q-card';
            
            const qText = document.createElement('h3');
            qText.className = 'result-q-text';
            qText.textContent = `${qIdx + 1}. ${q.question}`;
            qCard.appendChild(qText);
            
            const optsList = document.createElement('div');
            optsList.className = 'result-options-list';
            
            q.options.forEach((opt, optIdx) => {
                const optItem = document.createElement('div');
                optItem.className = 'result-option-item';
                optItem.textContent = opt;
                
                const isSelected = submissionDetail.user_answer === optIdx;
                const isCorrect = submissionDetail.correct_answer === optIdx;
                
                if (isCorrect) {
                    optItem.classList.add('correct');
                    const badge = document.createElement('span');
                    badge.className = 'result-option-status';
                    badge.textContent = isSelected ? '✓ Correct Answer & Your Choice' : '✓ Correct Answer';
                    optItem.appendChild(badge);
                } else if (isSelected) {
                    optItem.classList.add('incorrect');
                    const badge = document.createElement('span');
                    badge.className = 'result-option-status';
                    badge.textContent = '✗ Your Choice';
                    optItem.appendChild(badge);
                }
                
                optsList.appendChild(optItem);
            });
            
            qCard.appendChild(optsList);
            breakdownSection.appendChild(qCard);
        });
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'empty-state';
        placeholder.textContent = `Average Score: ${Math.round(results.average_score * 100) / 100} / ${results.total_questions}`;
        breakdownSection.appendChild(placeholder);
    }
    
    container.appendChild(breakdownSection);
}

// CREATOR ACTIONS
let questionCount = 0;

function toggleCreatorType(type) {
    document.querySelectorAll('.correct-option-group').forEach(group => {
        if (type === 'quiz') {
            group.classList.remove('hidden-anim');
        } else {
            group.classList.add('hidden-anim');
        }
    });
}

function togglePasscodeField() {
    const isPrivate = document.getElementById('create-is-private').checked;
    if (isPrivate) {
        passcodeContainer.classList.add('show-anim');
    } else {
        passcodeContainer.classList.remove('show-anim');
    }
}

function addQuestionToCreator() {
    questionCount++;
    const qIndex = questionCount - 1;
    
    const card = document.createElement('div');
    card.className = 'creator-question-card';
    card.id = `creator-q-card-${qIndex}`;
    
    const header = document.createElement('div');
    header.className = 'creator-q-header';
    
    const number = document.createElement('span');
    number.className = 'creator-q-number';
    number.textContent = `Question #${questionCount}`;
    header.appendChild(number);
    
    if (questionCount > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-remove-q';
        removeBtn.textContent = 'Remove Question';
        removeBtn.onclick = () => removeQuestionFromCreator(qIndex);
        header.appendChild(removeBtn);
    }
    
    card.appendChild(header);
    
    const qTextLabel = document.createElement('label');
    qTextLabel.className = 'field-label';
    qTextLabel.textContent = 'Question Text';
    card.appendChild(qTextLabel);
    
    const qInput = document.createElement('input');
    qInput.type = 'text';
    qInput.className = 'form-input q-text-input';
    qInput.placeholder = 'Enter the question';
    qInput.maxLength = 500;
    card.appendChild(qInput);
    
    const optLabel = document.createElement('label');
    optLabel.className = 'field-label';
    optLabel.style.marginTop = '1rem';
    optLabel.textContent = 'Options (Check the radio button for the correct answer in quizzes)';
    card.appendChild(optLabel);
    
    const optsContainer = document.createElement('div');
    optsContainer.className = 'options-builder-container';
    optsContainer.id = `q-${qIndex}-options-container`;
    card.appendChild(optsContainer);
    
    const addOptBtn = document.createElement('button');
    addOptBtn.className = 'btn-add-opt-link';
    addOptBtn.textContent = '+ Add Option';
    addOptBtn.onclick = () => addOptionRow(qIndex);
    card.appendChild(addOptBtn);
    
    creatorQuestionsList.appendChild(card);
    
    addOptionRow(qIndex, 'Option A');
    addOptionRow(qIndex, 'Option B');
}

function removeQuestionFromCreator(qIndex) {
    const card = document.getElementById(`creator-q-card-${qIndex}`);
    if (card) {
        card.remove();
        renumberCreatorQuestions();
    }
}

function renumberCreatorQuestions() {
    const cards = creatorQuestionsList.querySelectorAll('.creator-question-card');
    questionCount = cards.length;
    cards.forEach((card, idx) => {
        card.querySelector('.creator-q-number').textContent = `Question #${idx + 1}`;
        card.querySelectorAll('.correct-option-selector').forEach(radio => {
            radio.name = `correct-opt-${idx}`;
        });
    });
}

function addOptionRow(qIndex, placeholder = '') {
    const container = document.getElementById(`q-${qIndex}-options-container`);
    if (!container) return;
    
    const optionRowsCount = container.querySelectorAll('.option-builder-row').length;
    if (optionRowsCount >= 10) {
        alert('Maximum of 10 options allowed per question.');
        return;
    }
    
    const row = document.createElement('div');
    row.className = 'option-builder-row';
    
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `correct-opt-${qIndex}`;
    radio.className = 'correct-option-selector';
    radio.value = optionRowsCount;
    if (optionRowsCount === 0) radio.checked = true;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input option-text-input';
    input.placeholder = placeholder || `Option ${String.fromCharCode(65 + optionRowsCount)}`;
    input.maxLength = 200;
    
    row.appendChild(radio);
    row.appendChild(input);
    
    if (optionRowsCount >= 2) {
        const removeOptBtn = document.createElement('button');
        removeOptBtn.className = 'btn-remove-opt';
        removeOptBtn.innerHTML = '×';
        removeOptBtn.onclick = () => {
            row.remove();
            renumberOptions(qIndex);
        };
        row.appendChild(removeOptBtn);
    }
    
    container.appendChild(row);
}

function renumberOptions(qIndex) {
    const container = document.getElementById(`q-${qIndex}-options-container`);
    if (!container) return;
    
    const rows = container.querySelectorAll('.option-builder-row');
    rows.forEach((row, idx) => {
        const radio = row.querySelector('.correct-option-selector');
        radio.value = idx;
    });
}

async function publishActivity() {
    const titleInput = document.getElementById('create-title');
    const title = titleInput.value.trim();
    const type = document.querySelector('input[name="create-type"]:checked').value;
    const isPrivate = document.getElementById('create-is-private').checked;
    const passcode = document.getElementById('create-passcode').value.trim();
    
    if (!title) {
        alert('Please enter a title for your activity.');
        titleInput.focus();
        return;
    }
    
    if (isPrivate && !passcode) {
        alert('Please enter a passcode for private activities.');
        document.getElementById('create-passcode').focus();
        return;
    }
    
    const qCards = creatorQuestionsList.querySelectorAll('.creator-question-card');
    const questions = [];
    
    let validationFailed = false;
    
    qCards.forEach((card, qIdx) => {
        if (validationFailed) return;
        
        const qText = card.querySelector('.q-text-input').value.trim();
        if (!qText) {
            alert(`Please enter text for Question #${qIdx + 1}`);
            card.querySelector('.q-text-input').focus();
            validationFailed = true;
            return;
        }
        
        const optInputs = card.querySelectorAll('.option-text-input');
        const options = [];
        optInputs.forEach(optInput => {
            const optVal = optInput.value.trim();
            if (optVal) {
                options.push(optVal);
            }
        });
        
        if (options.length < 2) {
            alert(`Question #${qIdx + 1} must have at least 2 non-empty options.`);
            validationFailed = true;
            return;
        }
        
        const questionObj = {
            question: qText,
            options: options
        };
        
        if (type === 'quiz') {
            const checkedRadio = card.querySelector('.correct-option-selector:checked');
            if (!checkedRadio) {
                alert(`Please select a correct answer for Question #${qIdx + 1}`);
                validationFailed = true;
                return;
            }
            const radioIndex = parseInt(checkedRadio.value);
            const rows = card.querySelectorAll('.option-builder-row');
            let actualCorrectIndex = 0;
            let found = false;
            
            for (let i = 0; i < rows.length; i++) {
                const rowInput = rows[i].querySelector('.option-text-input').value.trim();
                if (rowInput) {
                    if (i === radioIndex) {
                        found = true;
                        break;
                    }
                    actualCorrectIndex++;
                }
            }
            
            questionObj.correct_answer = found ? actualCorrectIndex : 0;
        }
        
        questions.push(questionObj);
    });
    
    if (validationFailed) return;
    
    const payload = {
        title,
        type,
        is_private: isPrivate,
        passcode: isPrivate ? passcode : null,
        questions
    };
    
    const publishBtn = document.getElementById('publish-btn');
    publishBtn.disabled = true;
    publishBtn.textContent = 'Publishing...';
    
    try {
        const response = await fetch('/api/quizzes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Server rejected request');
        }
        
        alert('Activity published successfully!');
        
        titleInput.value = '';
        document.getElementById('create-is-private').checked = false;
        document.getElementById('create-passcode').value = '';
        passcodeContainer.classList.remove('show-anim');
        creatorQuestionsList.innerHTML = '';
        questionCount = 0;
        addQuestionToCreator();
        
        showView('dashboard');
    } catch (err) {
        alert(`Failed to publish: ${err.message}`);
    } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = 'Publish Activity';
    }
}
