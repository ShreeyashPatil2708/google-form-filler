// content.js — Google Form Filler content script

console.log('[FormFiller] Content script loaded on:', window.location.href);

const userData = {
  profiles: {
    default: {
      prn: '123B1B133',
      full_name: 'Shreeyash Patil',
      mobile_number: '7219512605',
      dob: '2005-08-27',
      gender: 'Male',
      coding_profiles: {
        gfg: 'https://www.geeksforgeeks.org/profile/spikeshield',
      },
      linkedin: 'https://www.linkedin.com/in/shreeyash-patil27/',
      github: 'https://github.com/ShreeyashPatil2708',
      cocubes_score: '00',
      college_name: 'Pimpri Chinchwad College of Engineering',
      academic_scores: {
        class_10_percentage: '76',
        class_12_percentage: '76',
        btech_aggregate: '6.7 CGPA'
      },
      graduation_year: '2027',
      technical_achievements: 'built multiple cloud projects',
      personal_achievements: 'Published research paper in international conference, Leadership roles and event management',
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
const DEBUG_MODE = true;
let observer = null;
let observerStarted = false;
let autofillDone = false;
let autofillInProgress = false;
let pendingRetryId = null;

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

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

function getNormalizedWords(value) {
  return normalizeText(value)
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

function getValueFromPath(object, path) {
  if (!object || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), object);
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
  element.style.backgroundColor = '#e6ffe6';
  element.style.boxSizing = 'border-box';
  if (!element.title) {
    element.title = 'Autofilled';
  }
  element.dataset.formFillerAutofilled = 'true';
}

function clearAutofilledStyle(element) {
  delete element.dataset.formFillerAutofilled;
  element.style.border = '';
  element.style.backgroundColor = '';
  if (element.title === 'Autofilled') {
    element.title = '';
  }
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
        item.querySelectorAll('[role="option"]').forEach((opt) => {
          const txt = getOptionLabel(opt);
          if (txt) options.push(txt);
        });
      }
    }
    debugLog(`[FormFiller] detected question: "${title}" (${type})`);
    questions.push({ title, type, options });
  }
  return questions;
}

function matchField(questionText) {
  const text = normalizeText(questionText);
  const textWords = getNormalizedWords(text);
  let bestPath = null;
  let bestScore = 0;

  for (const rule of FIELD_RULES) {
    for (const term of rule.terms) {
      const normalizedTerm = normalizeText(term);
      const termWords = getNormalizedWords(normalizedTerm);
      const firstKeyword = termWords[0];
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
      }
      if (normalizedTerm.includes(text) && text.length >= 4) {
        const score = text.length + 8;
        if (score > bestScore) {
          bestScore = score;
          bestPath = rule.path;
        }
      }
      const overlappingWords = termWords.filter((termWord) =>
        textWords.some((textWord) => textWord === termWord || textWord.includes(termWord) || termWord.includes(textWord))
      );
      if (overlappingWords.length > 0) {
        const score = overlappingWords.length * 7 + Math.min(normalizedTerm.length, 20);
        if (score > bestScore) {
          bestScore = score;
          bestPath = rule.path;
        }
      }
      if (firstKeyword && text.includes(firstKeyword)) {
        const score = firstKeyword.length + 5;
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
  const profiles = sourceData?.profiles;
  if (profiles) {
    if (sourceData?.activeProfile && profiles[sourceData.activeProfile]) {
      return profiles[sourceData.activeProfile];
    }
    if (profiles.default) return profiles.default;
    return null;
  }
  return sourceData || null;
}

function hasUsableValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function resolveAnswerByQuestion(questionTitle, sourceData) {
  const normalizedQuestion = normalizeText(questionTitle);
  const profileData = resolveProfileData(sourceData);

  if (profileData) {
    const mappedPath = matchField(questionTitle);
    if (mappedPath) {
      const mappedValue = getValueFromPath(profileData, mappedPath);
      if (hasUsableValue(mappedValue)) {
        debugLog(`[FormFiller] mapped field: "${questionTitle}" -> "${mappedPath}"`);
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
  const targetWords = getNormalizedWords(target);
  if (!target) return null;

  for (const option of options) {
    const label = normalizeText(getOptionLabel(option));
    if (!label) continue;
    if (label === target || label.includes(target) || target.includes(label)) return option;
  }

  let bestOption = null;
  let bestScore = 0;
  for (const option of options) {
    const label = normalizeText(getOptionLabel(option));
    if (!label) continue;
    const labelWords = getNormalizedWords(label);
    const overlappingWords = targetWords.filter((targetWord) =>
      labelWords.some((labelWord) => labelWord === targetWord || labelWord.includes(targetWord) || targetWord.includes(labelWord))
    );
    if (overlappingWords.length > 0) {
      const score = overlappingWords.length * 10 + (labelWords[0] && targetWords[0] && labelWords[0] === targetWords[0] ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
      continue;
    }
    if (targetWords[0] && label.includes(targetWords[0])) {
      const score = targetWords[0].length;
      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    }
  }

  if (bestOption) return bestOption;
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
  await new Promise((resolve) => setTimeout(resolve, 500));

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

  debugLog('[FormFiller] start fill, items:', items.length);

  for (const item of items) {
    const questionTitle = getQuestionTitle(item);
    if (!questionTitle) continue;

    const { key, value } = resolveAnswerByQuestion(questionTitle, sourceData);
    debugLog('[FormFiller] fill context:', { question: questionTitle, mappedField: key, value });

    if (!hasUsableValue(value)) {
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
    }
    clearAutofilledStyle(el);
  });
  document.querySelectorAll('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]').forEach((el) => {
    el.click();
    clearAutofilledStyle(el);
  });
  document.querySelectorAll('[role="listbox"], select').forEach((el) => {
    clearAutofilledStyle(el);
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
    console.log(`[Retry ${attempt + 1}] waiting for form...`);
    if (pendingRetryId) {
      autofillInProgress = false;
      return { filled: 0, skipped: 0, errors: [] };
    }
    pendingRetryId = setTimeout(() => {
      pendingRetryId = null;
      runAutofillWithRetry(sourceData, attempt + 1, force).catch((error) => {
        console.error('[FormFiller] retry autofill failed:', error);
      });
    }, RETRY_DELAY_MS);
    autofillInProgress = false;
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
    if (!hasNewNodes || autofillDone || autofillInProgress) return;
    runAutofillWithRetry(userData).catch((error) => {
      console.error('[FormFiller] observer autofill failed:', error);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  observerStarted = true;
}

setupMutationObserver();
runAutofillWithRetry(userData).catch((error) => {
  console.error('[FormFiller] initial autofill failed:', error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  const action = message?.action;

  if (type === 'SCRAPE_QUESTIONS') {
    sendResponse({ success: true, questions: scrapeQuestions() });
    return true;
  }

  if (type === 'FILL_FORM' || action === 'fillForm') {
    runAutofillWithRetry(message.data || userData, 0, true).then((result) => {
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
