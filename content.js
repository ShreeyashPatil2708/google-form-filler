// content.js — Google Form Filler content script
// Detects questions, fills answers, and communicates with the popup.

console.log('[FormFiller] Content script loaded on:', window.location.href);

// ---------------------------------------------------------------------------
// DOM Selectors
// Google Forms uses long class names that can change between deployments.
// We keep a prioritised list of selectors so the filler degrades gracefully.
// ---------------------------------------------------------------------------
const SELECTORS = {
  // Container for each question / item
  questionItem: [
    '.freebirdFormviewerViewItemsItemItem',
    '[data-params]',
    '.freebirdFormviewerComponentsQuestionBaseRoot',
  ],
  // Question title / label
  questionTitle: [
    '.freebirdFormviewerViewItemsItemItemTitle',
    '.freebirdFormviewerComponentsQuestionBaseTitle',
    '[role="heading"]',
  ],
  // Short-answer text input
  shortAnswer: ['input.whsOnd', 'input[type="text"]'],
  // Long-answer textarea
  longAnswer: ['textarea.KHxj8b', 'textarea'],
  // Radio / multiple-choice option
  radioOption: ['[role="radio"]'],
  // Checkbox option
  checkboxOption: ['[role="checkbox"]'],
  // Dropdown trigger button
  dropdownTrigger: ['[role="listbox"] [role="option"]', 'select'],
  // The overall dropdown container
  dropdownContainer: ['[role="listbox"]'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the first matching element inside `root` using a list of selectors.
 * @param {Element|Document} root
 * @param {string[]} selectorList
 * @returns {Element|null}
 */
function queryFirst(root, selectorList) {
  for (const sel of selectorList) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/**
 * Return all matching elements inside `root` using a list of selectors.
 * @param {Element|Document} root
 * @param {string[]} selectorList
 * @returns {Element[]}
 */
function queryAll(root, selectorList) {
  for (const sel of selectorList) {
    const els = Array.from(root.querySelectorAll(sel));
    if (els.length > 0) return els;
  }
  return [];
}

/**
 * Normalize a string for fuzzy matching (lowercase, trimmed, collapsed spaces).
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Simulate a native React/Angular input change so Google Forms registers the value.
 * @param {HTMLInputElement|HTMLTextAreaElement} el
 * @param {string} value
 */
function nativeInputValue(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Question detection
// ---------------------------------------------------------------------------

/**
 * Identify the type of a question item element.
 * @param {Element} item
 * @returns {'short-answer'|'long-answer'|'multiple-choice'|'checkbox'|'dropdown'|'unknown'}
 */
function detectQuestionType(item) {
  if (queryFirst(item, SELECTORS.shortAnswer)) return 'short-answer';
  if (queryFirst(item, SELECTORS.longAnswer)) return 'long-answer';
  if (queryAll(item, SELECTORS.checkboxOption).length > 0) return 'checkbox';
  if (queryAll(item, SELECTORS.radioOption).length > 0) return 'multiple-choice';
  if (item.querySelector('[role="listbox"]') || item.querySelector('select')) return 'dropdown';
  return 'unknown';
}

/**
 * Extract the question title text from an item element.
 * @param {Element} item
 * @returns {string}
 */
function extractTitle(item) {
  const el = queryFirst(item, SELECTORS.questionTitle);
  return el ? el.textContent.trim() : '';
}

/**
 * Scrape all questions from the current Google Form page.
 * @returns {{ title: string, type: string, options: string[] }[]}
 */
function scrapeQuestions() {
  const questions = [];
  const items = queryAll(document, SELECTORS.questionItem);

  console.log(`[FormFiller] Found ${items.length} question item(s).`);

  for (const item of items) {
    const title = extractTitle(item);
    if (!title) continue; // Skip non-question containers (e.g. section headers without inputs)

    const type = detectQuestionType(item);
    const options = [];

    if (type === 'multiple-choice' || type === 'checkbox') {
      const optionEls = queryAll(item, type === 'checkbox' ? SELECTORS.checkboxOption : SELECTORS.radioOption);
      for (const opt of optionEls) {
        const label = opt.getAttribute('data-value') || opt.textContent.trim();
        if (label) options.push(label);
      }
    }

    if (type === 'dropdown') {
      const sel = item.querySelector('select');
      if (sel) {
        for (const opt of sel.options) {
          if (opt.value) options.push(opt.text.trim());
        }
      } else {
        const optionEls = item.querySelectorAll('[role="option"]');
        for (const opt of optionEls) {
          const label = opt.getAttribute('data-value') || opt.textContent.trim();
          if (label) options.push(label);
        }
      }
    }

    questions.push({ title, type, options });
    console.log(`[FormFiller] Question detected — "${title}" (${type})`);
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Form filling
// ---------------------------------------------------------------------------

/**
 * Fill a short-answer or long-answer field.
 * @param {Element} item
 * @param {string} value
 */
function fillTextInput(item, value) {
  const input = queryFirst(item, SELECTORS.shortAnswer) || queryFirst(item, SELECTORS.longAnswer);
  if (!input) {
    console.warn('[FormFiller] No text input found in item.');
    return;
  }
  input.focus();
  nativeInputValue(input, String(value));
  console.log(`[FormFiller] Filled text input with: "${value}"`);
}

/**
 * Select a radio option by matching text or data-value.
 * @param {Element} item
 * @param {string} value
 */
function fillRadio(item, value) {
  const options = queryAll(item, SELECTORS.radioOption);
  const target = normalize(value);

  for (const opt of options) {
    const label = normalize(opt.getAttribute('data-value') || opt.textContent);
    if (label === target || label.includes(target)) {
      opt.click();
      console.log(`[FormFiller] Selected radio option: "${opt.textContent.trim()}"`);
      return;
    }
  }
  console.warn(`[FormFiller] Radio option not found: "${value}"`);
}

/**
 * Select one or more checkboxes by matching text or data-value.
 * @param {Element} item
 * @param {string|string[]} values
 */
function fillCheckbox(item, values) {
  const targets = (Array.isArray(values) ? values : [values]).map(normalize);
  const options = queryAll(item, SELECTORS.checkboxOption);

  for (const opt of options) {
    const label = normalize(opt.getAttribute('data-value') || opt.textContent);
    const shouldCheck = targets.some((t) => label === t || label.includes(t));
    const isChecked = opt.getAttribute('aria-checked') === 'true';

    if (shouldCheck && !isChecked) {
      opt.click();
      console.log(`[FormFiller] Checked checkbox: "${opt.textContent.trim()}"`);
    } else if (!shouldCheck && isChecked) {
      opt.click();
      console.log(`[FormFiller] Unchecked checkbox: "${opt.textContent.trim()}"`);
    }
  }
}

/**
 * Select a dropdown option.
 * @param {Element} item
 * @param {string} value
 */
async function fillDropdown(item, value) {
  const sel = item.querySelector('select');
  if (sel) {
    const target = normalize(value);
    for (const opt of sel.options) {
      if (normalize(opt.text) === target || normalize(opt.value) === target) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[FormFiller] Selected native dropdown: "${opt.text}"`);
        return;
      }
    }
    console.warn(`[FormFiller] Dropdown option not found: "${value}"`);
    return;
  }

  // Custom Google Forms dropdown
  const trigger = item.querySelector('[role="listbox"]');
  if (!trigger) {
    console.warn('[FormFiller] No dropdown found in item.');
    return;
  }

  trigger.click(); // open the dropdown
  await new Promise((r) => setTimeout(r, 300));

  const optionEls = Array.from(document.querySelectorAll('[role="option"]'));
  const target = normalize(value);

  for (const opt of optionEls) {
    const label = normalize(opt.getAttribute('data-value') || opt.textContent);
    if (label === target || label.includes(target)) {
      opt.click();
      console.log(`[FormFiller] Selected custom dropdown option: "${opt.textContent.trim()}"`);
      return;
    }
  }

  // Close the dropdown if nothing was selected
  trigger.click();
  console.warn(`[FormFiller] Custom dropdown option not found: "${value}"`);
}

/**
 * Fill the entire form using a data map of question title → answer.
 * @param {{ [questionTitle: string]: string | string[] }} data
 * @returns {{ filled: number, skipped: number, errors: string[] }}
 */
async function fillForm(data) {
  const items = queryAll(document, SELECTORS.questionItem);
  let filled = 0;
  let skipped = 0;
  const errors = [];

  console.log('[FormFiller] Starting form fill with data:', data);

  for (const item of items) {
    const title = extractTitle(item);
    if (!title) continue;

    // Look up the answer using exact then fuzzy matching
    const normTitle = normalize(title);
    let answer = null;
    let matchedKey = null;

    for (const key of Object.keys(data)) {
      if (normalize(key) === normTitle) {
        answer = data[key];
        matchedKey = key;
        break;
      }
    }

    // Fallback: partial match
    if (answer === null) {
      for (const key of Object.keys(data)) {
        if (normTitle.includes(normalize(key)) || normalize(key).includes(normTitle)) {
          answer = data[key];
          matchedKey = key;
          break;
        }
      }
    }

    if (answer === null) {
      console.log(`[FormFiller] No data for question: "${title}" — skipping.`);
      skipped++;
      continue;
    }

    const type = detectQuestionType(item);
    console.log(`[FormFiller] Filling "${title}" (${type}) with:`, answer);

    try {
      if (type === 'short-answer' || type === 'long-answer') {
        fillTextInput(item, answer);
      } else if (type === 'multiple-choice') {
        fillRadio(item, answer);
      } else if (type === 'checkbox') {
        fillCheckbox(item, answer);
      } else if (type === 'dropdown') {
        await fillDropdown(item, answer);
      } else {
        console.warn(`[FormFiller] Unknown question type for: "${title}"`);
        skipped++;
        continue;
      }
      filled++;
    } catch (err) {
      console.error(`[FormFiller] Error filling "${title}":`, err);
      errors.push(`"${title}": ${err.message}`);
    }
  }

  console.log(`[FormFiller] Fill complete. filled=${filled}, skipped=${skipped}, errors=${errors.length}`);
  return { filled, skipped, errors };
}

/**
 * Clear all text inputs and deselect all choices in the form.
 */
function clearForm() {
  console.log('[FormFiller] Clearing form...');

  // Clear text inputs and textareas
  document.querySelectorAll('input[type="text"], textarea').forEach((el) => {
    if (el.value) {
      el.focus();
      nativeInputValue(el, '');
    }
  });

  // Deselect radio buttons
  document.querySelectorAll('[role="radio"][aria-checked="true"]').forEach((el) => el.click());

  // Deselect checkboxes
  document.querySelectorAll('[role="checkbox"][aria-checked="true"]').forEach((el) => el.click());

  console.log('[FormFiller] Form cleared.');
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[FormFiller] Content script received message:', message.type);

  if (message.type === 'SCRAPE_QUESTIONS') {
    const questions = scrapeQuestions();
    sendResponse({ success: true, questions });
    return true;
  }

  if (message.type === 'FILL_FORM') {
    fillForm(message.data).then((result) => {
      sendResponse({ success: true, ...result });
    });
    return true; // async
  }

  if (message.type === 'CLEAR_FORM') {
    clearForm();
    sendResponse({ success: true });
    return true;
  }
});
