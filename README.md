# Google Form Filler

A Chrome extension (Manifest V3) that automatically fills Google Forms with saved profile data.
Designed for **local, developer use only** — not published to the Chrome Web Store.

---

## Features

- **Detect questions** — Scrape all question titles and types from the currently open Google Form.
- **Fill form** — Provide answers as a JSON object and auto-fill all matching questions in one click.
- **Clear form** — Reset all fields back to their default state.
- **Profiles** — Save and reload named JSON answer sets across browser sessions (stored in `chrome.storage.sync`).
- **JSON template generator** — Detect form questions and copy a pre-filled JSON template to the clipboard.
- **Debug logging** — All actions are logged to the browser console (`[FormFiller]` prefix).

Supported question types:

| Type | How it's filled |
|---|---|
| Short answer | Sets the text input value |
| Paragraph | Sets the textarea value |
| Multiple choice | Clicks the matching radio option |
| Checkboxes | Clicks all matching checkbox options |
| Dropdown | Opens and selects the matching option |

---

## Installation (unpacked extension)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the project folder.
5. The Form Filler icon will appear in the Chrome toolbar.

---

## Usage

### Fill a form

1. Open a Google Form in Chrome.
2. Click the **Form Filler** extension icon.
3. In the **Fill** tab, enter a JSON object mapping question titles to answers:

```json
{
  "Your name": "Jane Doe",
  "Favourite colour": "Blue",
  "Select all that apply": ["Option A", "Option C"],
  "How satisfied are you?": "Very satisfied"
}
```

4. Click **▶ Fill Form**.

> Keys are matched against question titles using case-insensitive, partial matching.
> Use arrays for checkbox questions.

### Save a profile

1. Enter your JSON data in the **Fill** tab.
2. Switch to the **Profiles** tab.
3. Enter a profile name and click **Save**.
4. Load it later by clicking **Load** next to the saved profile.

### Detect questions (Debug tab)

1. Open the **Debug** tab.
2. Click **🔍 Scrape Questions** — all detected question titles and types appear in the list.
3. Click **📋 Copy JSON Template** to copy a ready-to-fill template to the clipboard.

---

## Project structure

```
google-form-filler/
├── manifest.json      # Extension manifest (Manifest V3)
├── background.js      # Service worker
├── content.js         # Google Forms DOM interaction
├── popup.html         # Extension popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Deployment context

This extension is intended for **local developer use only**.
It is **not published** to the Chrome Web Store.

- Console logging is enabled by default (all messages prefixed `[FormFiller]`).
- No obfuscation or minification applied.
- Permissions are scoped to `https://docs.google.com/forms/*`.
- No `eval` or dynamically constructed scripts are used.
- Fully Manifest V3 compliant.
