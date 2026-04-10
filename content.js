// content.js — Google Form Filler content script

console.log('[FormFiller] Content script loaded on:', window.location.href);

const userData = {
  profiles: {
    default: {
      prn: '1234567890',
      full_name: 'Shreeyash Patil',
      mobile_number: '9876543210',
      dob: '2004-05-15',
      gender: 'Male',
      coding_profiles: {
        leetcode: 'https://leetcode.com/yourusername',
        gfg: 'https://geeksforgeeks.org/user/yourusername',
        hackerrank: 'https://hackerrank.com/yourusername'
      },
      linkedin: 'https://linkedin.com/in/yourusername',
      github: 'https://github.com/yourusername',
      cocubes_score: '850',
      college_name: 'Pimpri Chinchwad College of Engineering',
      academic_scores: {
        class_10_percentage: '95',
        class_12_percentage: '90',
        btech_aggregate: '8.5 CGPA'
      },
      graduation_year: '2027',
      technical_achievements: 'Participated in hackathons and built ML/cloud projects',
      personal_achievements: 'Leadership roles and event management',
      projects: 'Crop Price Prediction, SaaS ML Trainer, Cloud Benchmarking'
    }
  },
  activeProfile: 'default'
};

const SELECTORS = {
  questionItem: [
    '.Qr7Oae',
    '.freebirdFormviewerViewItemsItemItem',
    '.freebirdFormviewerComponentsQuestionBaseRoot',
    '[data-params]'
  ],
  questionTitle: [
    '.M7eMe',
    '.HoXoMd',
    '.freebirdFormviewerViewItemsItemItemTitle',
    '.freebirdFormviewerComponentsQuestionBaseTitle',
    '[role="heading"]'
  ],
  textInput: ['input.whsOnd', 'input[type="text"]'],
  textarea: ['textarea.KHxj8b', 'textarea'],
  radio: ['[role="radio"]'],
  checkbox: ['[role="checkbox"]'],
  dropdown: ['[role="listbox"]', 'select']
};

const FIELD_RULES = [
  { path: 'prn', terms: ['prn', 'roll number', 'roll no', 'rollno'] },
  { path: 'full_name', terms: ['full name', 'your name', 'name'] },
  { path: 'mobile_number', terms: ['mobile', 'contact number', 'phone number', 'phone'] },
  { path: 'dob', terms: ['dob', 'date of birth', 'birth date'] },
  { path: 'gender', terms: ['gender', 'sex'] },
  { path: 'linkedin', terms: ['linkedin'] },
  { path: 'github', terms: ['github', 'git hub'] },
  { path: 'coding_profiles.leetcode', terms: ['leetcode', 'leet code'] },
  { path: 'coding_profiles.gfg', terms: ['gfg', 'geeksforgeeks', 'geeks for geeks'] },
  { path: 'coding_profiles.hackerrank', terms: ['hackerrank', 'hacker rank'] },
  { path: 'academic_scores.class_10_percentage', terms: ['10th', 'class 10', 'ssc'] },
  { path: 'academic_scores.class_12_percentage', terms: ['12th', 'class 12', 'hsc'] },
  { path: 'academic_scores.btech_aggregate', terms: ['btech', 'cgpa', 'aggregate'] },
  { path: 'graduation_year', terms: ['graduation year', 'passing year'] },
  { path: 'projects', terms: ['projects', 'project details'] },
  { path: 'technical_achievements', terms: ['technical achievements', 'technical achievement'] },
  { path: 'personal_achievements', terms: ['personal achievements', 'personal achievement'] },
  { path: 'college_name', terms: ['college name', 'institute name', 'college'] },
  { path: 'cocubes_score', terms: ['cocubes', 'co-cubes', 'cocubes score'] }
];

const RETRY_DELAY_MS = 800;
const MAX_AUTOFILL_RETRIES = 8;
let observer = null;
let observerStarted = false;
let autofillDone = false;
let autofillInProgress = false;
let pendingRetryId = null;

function queryFirst(root, selectorList) {
  for (const sel of selectorList) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryAll(root, selectorList) {
  const all = [];
  for (const sel of selectorList) {
    all.push(...Array.from(root.querySelectorAll(sel)));
  }
  return Array.from(new Set(all));
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getValueFromPath(object, path) {
  if (!object || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

function dispatchInputEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setNativeValue(element, value) {
  const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}

function applyAutofilledStyle(element) {
  element.style.border = '2px solid #34a853';
  element.style.boxSizing = 'border-box';
  if (!element.title || element.title === '') {
    element.title = 'Autofilled';
  }
  element.dataset.formFillerAutofilled = 'true';
}

function getQuestionTitle(item) {
  const titleEl = queryFirst(item, SELECTORS.questionTitle);
  if (!titleEl) return '';
  const raw = titleEl.textContent || '';
  return raw.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
}

function getQuestionType(item) {
  if (queryFirst(item, SELECTORS.textInput)) return 'text';
  if (queryFirst(item, SELECTORS.textarea)) return 'textarea';
  if (queryAll(item, SELECTORS.radio).length) return 'radio';
  if (queryAll(item, SELECTORS.checkbox).length) return 'checkbox';
  if (queryFirst(item, SELECTORS.dropdown)) return 'dropdown';
  return 'unknown';
}

function getOptionLabel(option) {
  const label = option.getAttribute('aria-label') || option.getAttribute('data-value') || option.textContent || '';
  return label.replace(/\s+/g, ' ').trim();
}

function scrapeQuestions() {
  const questions = [];
  const items = queryAll(document, SELECTORS.questionItem);
  for (const item of items) {
    const title = getQuestionTitle(item);
    if (!title) continue;
    const type = getQuestionType(item);
    const options = [];
    if (type === 'radio') {
      queryAll(item, SELECTORS.radio).forEach((opt) => {
        const txt = getOptionLabel(opt);
        if (txt) options.push(txt);
      });
    }
    if (type === 'checkbox') {
      queryAll(item, SELECTORS.checkbox).forEach((opt) => {
        const txt = getOptionLabel(opt);
        if (txt) options.push(txt);
      });
    }
    if (type === 'dropdown') {
      const select = item.querySelector('select');
      if (select) {
        Array.from(select.options).forEach((opt) => {
          const txt = (opt.textContent || '').trim();
          if (txt) options.push(txt);
        });
      } else {
        document.querySelectorAll('[role="option"]').forEach((opt) => {
          const txt = getOptionLabel(opt);
          if (txt) options.push(txt);
        });
      }
    }
    console.log(`[FormFiller] detected question: "${title}" (${type})`);
    questions.push({ title, type, options });
  }
  return questions;
}

function matchField(questionText) {
  const text = normalizeText(questionText);
  let bestPath = null;
  let bestScore = 0;

  for (const rule of FIELD_RULES) {
    for (const term of rule.terms) {
      const normalizedTerm = normalizeText(term);
      if (!normalizedTerm) continue;
      if (text === normalizedTerm) {
        return rule.path;
      }
      if (text.includes(normalizedTerm)) {
        const score = normalizedTerm.length + 20;
        if (score > bestScore) {
          bestScore = score;
          bestPath = rule.path;
        }
      } else if (normalizedTerm.includes(text) && text.length >= 4) {
        const score = text.length + 8;
        if (score > bestScore) {
          bestScore = score;
          bestPath = rule.path;
        }
      }
    }
  }

  return bestPath;
}

function resolveProfileData(sourceData) {
  if (sourceData && sourceData.profiles && sourceData.activeProfile) {
    return sourceData.profiles[sourceData.activeProfile] || sourceData.profiles.default || null;
  }
  if (sourceData && sourceData.profiles && sourceData.profiles.default) {
    return sourceData.profiles.default;
  }
  return sourceData || null;
}

function resolveAnswerByQuestion(questionTitle, sourceData) {
  const normalizedQuestion = normalizeText(questionTitle);
  const profileData = resolveProfileData(sourceData);

  if (profileData) {
    const mappedPath = matchField(questionTitle);
    if (mappedPath) {
      const mappedValue = getValueFromPath(profileData, mappedPath);
      if (mappedValue !== undefined && mappedValue !== null && String(mappedValue).trim() !== '') {
        console.log(`[FormFiller] mapped field: "${questionTitle}" -> "${mappedPath}"`);
        return { key: mappedPath, value: mappedValue };
      }
    }
  }

  if (sourceData && typeof sourceData === 'object' && !sourceData.profiles) {
    const keys = Object.keys(sourceData);
    for (const key of keys) {
      if (normalizeText(key) === normalizedQuestion) {
        return { key, value: sourceData[key] };
      }
    }
    for (const key of keys) {
      const normalizedKey = normalizeText(key);
      if (normalizedQuestion.includes(normalizedKey) || normalizedKey.includes(normalizedQuestion)) {
        return { key, value: sourceData[key] };
      }
    }
  }

  return { key: null, value: null };
}

function isTextLikeFilled(item) {
  const textControl = queryFirst(item, SELECTORS.textInput) || queryFirst(item, SELECTORS.textarea);
  return Boolean(textControl && normalizeText(textControl.value) !== '');
}

function isRadioFilled(item) {
  return queryAll(item, SELECTORS.radio).some((opt) => opt.getAttribute('aria-checked') === 'true');
}

function isCheckboxFilled(item) {
  return queryAll(item, SELECTORS.checkbox).some((opt) => opt.getAttribute('aria-checked') === 'true');
}

function isDropdownFilled(item) {
  const select = item.querySelector('select');
  if (select) {
    const selected = select.options[select.selectedIndex];
    if (!selected) return false;
    const selectedText = normalizeText(selected.textContent);
    return selectedText !== '' && !['choose', 'select', 'please select'].includes(selectedText);
  }
  const listbox = item.querySelector('[role="listbox"]');
  if (!listbox) return false;
  const val = normalizeText(listbox.getAttribute('aria-label') || listbox.textContent || '');
  return val !== '' && !val.startsWith('choose') && !val.startsWith('select');
}

function parseMultiValues(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [String(value)];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function findBestMatchingOption(options, value) {
  const target = normalizeText(value);
  if (!target) return null;
  for (const option of options) {
    const label = normalizeText(getOptionLabel(option));
    if (!label) continue;
    if (label === target || label.includes(target) || target.includes(label)) return option;
  }
  return null;
}

function fillTextInput(item, value) {
  const input = queryFirst(item, SELECTORS.textInput) || queryFirst(item, SELECTORS.textarea);
  if (!input || normalizeText(input.value) !== '') return false;
  const strValue = String(value ?? '');
  if (!strValue.trim()) return false;
  input.focus();
  setNativeValue(input, strValue);
  dispatchInputEvents(input);
  applyAutofilledStyle(input);
  return true;
}

function fillRadio(item, value) {
  if (isRadioFilled(item)) return false;
  const options = queryAll(item, SELECTORS.radio);
  const match = findBestMatchingOption(options, value);
  if (!match) return false;
  match.click();
  applyAutofilledStyle(match);
  return true;
}

function fillCheckbox(item, value) {
  if (isCheckboxFilled(item)) return false;
  const targets = parseMultiValues(value);
  if (!targets.length) return false;
  const options = queryAll(item, SELECTORS.checkbox);
  let changed = false;
  for (const target of targets) {
    const match = findBestMatchingOption(options, target);
    if (match && match.getAttribute('aria-checked') !== 'true') {
      match.click();
      applyAutofilledStyle(match);
      changed = true;
    }
  }
  return changed;
}

async function fillDropdown(item, value) {
  if (isDropdownFilled(item)) return false;
  const target = String(value ?? '').trim();
  if (!target) return false;

  const select = item.querySelector('select');
  if (select) {
    const option = Array.from(select.options).find((opt) => {
      const txt = normalizeText(opt.textContent);
      const val = normalizeText(opt.value);
      const normalizedTarget = normalizeText(target);
      return txt === normalizedTarget || val === normalizedTarget || txt.includes(normalizedTarget);
    });
    if (!option) return false;
    select.value = option.value;
    dispatchInputEvents(select);
    applyAutofilledStyle(select);
    return true;
  }

  const trigger = item.querySelector('[role="listbox"]');
  if (!trigger) return false;

  trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 250));

  const options = Array.from(document.querySelectorAll('[role="option"]'));
  const match = findBestMatchingOption(options, target);
  if (!match) {
    trigger.click();
    return false;
  }

  match.click();
  applyAutofilledStyle(trigger);
  return true;
}

async function fillForm(sourceData) {
  const items = queryAll(document, SELECTORS.questionItem);
  let filled = 0;
  let skipped = 0;
  const errors = [];

  console.log('[FormFiller] start fill, items:', items.length);

  for (const item of items) {
    const questionTitle = getQuestionTitle(item);
    if (!questionTitle) continue;

    const { key, value } = resolveAnswerByQuestion(questionTitle, sourceData);
    console.log('[FormFiller] detected question:', questionTitle);
    console.log('[FormFiller] mapped field:', key);
    console.log('[FormFiller] value used:', value);

    if (value === null || value === undefined || String(value).trim() === '') {
      skipped++;
      continue;
    }

    const type = getQuestionType(item);
    try {
      let didFill = false;
      if (type === 'text' || type === 'textarea') {
        didFill = fillTextInput(item, value);
      } else if (type === 'radio') {
        didFill = fillRadio(item, value);
      } else if (type === 'checkbox') {
        didFill = fillCheckbox(item, value);
      } else if (type === 'dropdown') {
        didFill = await fillDropdown(item, value);
      } else {
        skipped++;
        continue;
      }

      if (didFill) {
        filled++;
      } else {
        skipped++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`"${questionTitle}": ${message}`);
    }
  }

  return { filled, skipped, errors };
}

function clearForm() {
  document.querySelectorAll('input[type="text"], textarea').forEach((el) => {
    if (normalizeText(el.value) !== '') {
      setNativeValue(el, '');
      dispatchInputEvents(el);
      delete el.dataset.formFillerAutofilled;
      el.style.border = '';
      if (el.title === 'Autofilled') {
        el.title = '';
      }
    }
  });
  document.querySelectorAll('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]').forEach((el) => {
    el.click();
    delete el.dataset.formFillerAutofilled;
    el.style.border = '';
    if (el.title === 'Autofilled') {
      el.title = '';
    }
  });
}

function stopObserverIfFinished() {
  if (observer && autofillDone) {
    observer.disconnect();
    observer = null;
    observerStarted = false;
    if (pendingRetryId) {
      clearTimeout(pendingRetryId);
      pendingRetryId = null;
    }
  }
}

async function runAutofillWithRetry(sourceData, attempt = 0, force = false) {
  if (autofillInProgress || (autofillDone && !force)) return { filled: 0, skipped: 0, errors: [] };
  autofillInProgress = true;

  const items = queryAll(document, SELECTORS.questionItem);
  if (!items.length && attempt < MAX_AUTOFILL_RETRIES) {
    if (pendingRetryId) {
      autofillInProgress = false;
      return { filled: 0, skipped: 0, errors: [] };
    }
    autofillInProgress = false;
    pendingRetryId = setTimeout(() => {
      pendingRetryId = null;
      runAutofillWithRetry(sourceData, attempt + 1, force);
    }, RETRY_DELAY_MS);
    return { filled: 0, skipped: 0, errors: [] };
  }

  if (pendingRetryId) {
    clearTimeout(pendingRetryId);
    pendingRetryId = null;
  }

  const result = await fillForm(sourceData);
  autofillInProgress = false;
  autofillDone = true;
  stopObserverIfFinished();
  return result;
}

function setupMutationObserver() {
  if (observerStarted || autofillDone) return;
  observer = new MutationObserver((mutations) => {
    const hasNewNodes = mutations.some((mutation) => mutation.addedNodes && mutation.addedNodes.length > 0);
    if (!hasNewNodes || autofillDone) return;
    runAutofillWithRetry(userData);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  observerStarted = true;
}

setupMutationObserver();
runAutofillWithRetry(userData);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  const action = message?.action;

  if (type === 'SCRAPE_QUESTIONS') {
    sendResponse({ success: true, questions: scrapeQuestions() });
    return true;
  }

  if (type === 'FILL_FORM' || action === 'fillForm') {
    const sourceData = message.data || message.userData || userData;
    runAutofillWithRetry(sourceData, 0, true).then((result) => {
      sendResponse({ success: true, ...result });
    });
    return true;
  }

  if (type === 'CLEAR_FORM') {
    clearForm();
    autofillDone = false;
    setupMutationObserver();
    sendResponse({ success: true });
    return true;
  }
});
