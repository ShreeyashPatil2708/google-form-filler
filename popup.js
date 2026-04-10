// popup.js — Google Form Filler popup logic
// Handles UI interactions, profile management, and message dispatch to the content script.

console.log('[FormFiller] Popup opened.');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let detectedQuestions = []; // [{ title, type, options }]

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const jsonInput = document.getElementById('json-input');
const statusBar = document.getElementById('status-bar');
const btnFill = document.getElementById('btn-fill');
const btnClear = document.getElementById('btn-clear');
const btnSaveProfile = document.getElementById('btn-save-profile');
const profileNameInput = document.getElementById('profile-name');
const profileList = document.getElementById('profile-list');
const btnScrape = document.getElementById('btn-scrape');
const questionList = document.getElementById('question-list');
const btnExportTemplate = document.getElementById('btn-export-template');

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Show a status message in the status bar.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} [durationMs=3000]  auto-hide after this many ms (0 = no auto-hide)
 */
function showStatus(message, type = 'info', durationMs = 3000) {
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type}`;
  console.log(`[FormFiller] Status [${type}]: ${message}`);
  if (durationMs > 0) {
    setTimeout(() => { statusBar.className = 'status-bar hidden'; }, durationMs);
  }
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    console.log('[FormFiller] Switched to tab:', btn.dataset.tab);
  });
});

// ---------------------------------------------------------------------------
// Active tab helper
// ---------------------------------------------------------------------------

/**
 * Get the currently active browser tab.
 * @returns {Promise<chrome.tabs.Tab>}
 */
function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!tabs || tabs.length === 0) return reject(new Error('No active tab found.'));
      resolve(tabs[0]);
    });
  });
}

/**
 * Send a message to the content script on the active tab.
 * Returns the response or throws an error.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function sendToContentScript(message) {
  const tab = await getActiveTab();
  console.log('[FormFiller] Sending to tab', tab.id, ':', message.type);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response) return reject(new Error('No response from content script.'));
      resolve(response);
    });
  });
}

// ---------------------------------------------------------------------------
// Fill form
// ---------------------------------------------------------------------------

btnFill.addEventListener('click', async () => {
  const raw = jsonInput.value.trim();
  if (!raw) {
    showStatus('Please enter JSON data before filling.', 'error');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    showStatus(`Invalid JSON: ${err.message}`, 'error', 0);
    console.error('[FormFiller] JSON parse error:', err);
    return;
  }

  btnFill.disabled = true;
  showStatus('Filling form…', 'info', 0);

  try {
    const result = await sendToContentScript({ type: 'FILL_FORM', data });
    if (result.success) {
      const msg = `Filled ${result.filled} field(s)` +
        (result.skipped > 0 ? `, skipped ${result.skipped}` : '') +
        (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : '') + '.';
      showStatus(msg, result.errors.length > 0 ? 'error' : 'success');
      if (result.errors.length > 0) {
        console.warn('[FormFiller] Fill errors:', result.errors);
      }
    } else {
      showStatus('Fill failed — check console for details.', 'error');
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
    console.error('[FormFiller] Fill error:', err);
  } finally {
    btnFill.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Clear form
// ---------------------------------------------------------------------------

btnClear.addEventListener('click', async () => {
  btnClear.disabled = true;
  try {
    await sendToContentScript({ type: 'CLEAR_FORM' });
    showStatus('Form cleared.', 'success');
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
    console.error('[FormFiller] Clear error:', err);
  } finally {
    btnClear.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Profile management
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'formFillerProfiles';

/**
 * Load all profiles from chrome.storage.sync.
 * @returns {Promise<{ [name: string]: string }>}
 */
function loadProfiles() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || {});
    });
  });
}

/**
 * Save all profiles to chrome.storage.sync.
 * @param {{ [name: string]: string }} profiles
 * @returns {Promise<void>}
 */
function saveProfiles(profiles) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: profiles }, resolve);
  });
}

/**
 * Render the profile list in the UI.
 * @param {{ [name: string]: string }} profiles
 */
function renderProfiles(profiles) {
  profileList.innerHTML = '';
  const names = Object.keys(profiles);

  if (names.length === 0) {
    const li = document.createElement('li');
    li.className = 'profile-empty';
    li.textContent = 'No profiles saved yet.';
    profileList.appendChild(li);
    return;
  }

  for (const name of names) {
    const li = document.createElement('li');

    const span = document.createElement('span');
    span.className = 'profile-name';
    span.textContent = name;

    const actions = document.createElement('div');
    actions.className = 'profile-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-secondary';
    loadBtn.textContent = 'Load';
    loadBtn.title = `Load profile "${name}" into the JSON editor`;
    loadBtn.addEventListener('click', () => {
      jsonInput.value = profiles[name];
      showStatus(`Profile "${name}" loaded.`, 'info');
      // Switch to Fill tab
      document.querySelector('[data-tab="fill"]').click();
      console.log(`[FormFiller] Loaded profile: ${name}`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-secondary';
    deleteBtn.textContent = '✕';
    deleteBtn.title = `Delete profile "${name}"`;
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete profile "${name}"?`)) return;
      const updated = await loadProfiles();
      delete updated[name];
      await saveProfiles(updated);
      renderProfiles(updated);
      showStatus(`Profile "${name}" deleted.`, 'info');
      console.log(`[FormFiller] Deleted profile: ${name}`);
    });

    actions.appendChild(loadBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(span);
    li.appendChild(actions);
    profileList.appendChild(li);
  }
}

btnSaveProfile.addEventListener('click', async () => {
  const name = profileNameInput.value.trim();
  if (!name) {
    showStatus('Enter a profile name first.', 'error');
    return;
  }

  const raw = jsonInput.value.trim();
  if (!raw) {
    showStatus('The JSON editor is empty — nothing to save.', 'error');
    return;
  }

  try {
    JSON.parse(raw); // Validate JSON before saving
  } catch (err) {
    showStatus(`Invalid JSON: ${err.message}`, 'error');
    return;
  }

  const profiles = await loadProfiles();
  profiles[name] = raw;
  await saveProfiles(profiles);
  renderProfiles(profiles);
  profileNameInput.value = '';
  showStatus(`Profile "${name}" saved.`, 'success');
  console.log(`[FormFiller] Saved profile: ${name}`);
});

// ---------------------------------------------------------------------------
// Debug: Scrape questions
// ---------------------------------------------------------------------------

btnScrape.addEventListener('click', async () => {
  btnScrape.disabled = true;
  showStatus('Scraping questions…', 'info', 0);

  try {
    const result = await sendToContentScript({ type: 'SCRAPE_QUESTIONS' });
    detectedQuestions = result.questions || [];
    renderQuestions(detectedQuestions);
    showStatus(`Detected ${detectedQuestions.length} question(s).`, 'success');
    console.log('[FormFiller] Scraped questions:', detectedQuestions);
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
    console.error('[FormFiller] Scrape error:', err);
  } finally {
    btnScrape.disabled = false;
  }
});

/**
 * Render detected questions in the debug tab.
 * @param {{ title: string, type: string, options: string[] }[]} questions
 */
function renderQuestions(questions) {
  questionList.innerHTML = '';

  if (questions.length === 0) {
    const li = document.createElement('li');
    li.className = 'profile-empty';
    li.textContent = 'No questions detected.';
    questionList.appendChild(li);
    return;
  }

  for (const q of questions) {
    const li = document.createElement('li');

    const badge = document.createElement('span');
    badge.className = 'question-type-badge';
    badge.textContent = q.type;

    const title = document.createElement('span');
    title.className = 'question-title';
    title.textContent = q.title;
    title.title = q.title + (q.options.length > 0 ? `\nOptions: ${q.options.join(', ')}` : '');

    li.appendChild(badge);
    li.appendChild(title);
    questionList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Debug: Export JSON template
// ---------------------------------------------------------------------------

btnExportTemplate.addEventListener('click', () => {
  if (detectedQuestions.length === 0) {
    showStatus('Scrape questions first.', 'error');
    return;
  }

  const template = {};
  for (const q of detectedQuestions) {
    if (q.type === 'checkbox') {
      template[q.title] = q.options.length > 0 ? [q.options[0]] : [];
    } else if (q.options.length > 0) {
      template[q.title] = q.options[0];
    } else {
      template[q.title] = '';
    }
  }

  const json = JSON.stringify(template, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    showStatus('JSON template copied to clipboard!', 'success');
    console.log('[FormFiller] Template copied:', json);
  }).catch((err) => {
    showStatus('Failed to copy to clipboard.', 'error');
    console.error('[FormFiller] Clipboard error:', err);
  });
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

async function init() {
  console.log('[FormFiller] Initialising popup...');
  const profiles = await loadProfiles();
  renderProfiles(profiles);

  // Check whether the active tab is a Google Form
  try {
    const tab = await getActiveTab();
    if (!tab.url || !tab.url.startsWith('https://docs.google.com/forms/')) {
      showStatus('Navigate to a Google Form to use this extension.', 'info', 0);
      btnFill.disabled = true;
      btnClear.disabled = true;
      btnScrape.disabled = true;
      console.log('[FormFiller] Active tab is not a Google Form:', tab.url);
    } else {
      console.log('[FormFiller] Active tab is a Google Form:', tab.url);
    }
  } catch (err) {
    console.error('[FormFiller] Could not check active tab:', err);
  }
}

init();
