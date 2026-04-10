// background.js — Service Worker (Manifest V3)
// Handles extension lifecycle events and message routing.

console.log('[FormFiller] Background service worker started.');

// Open the popup when the extension icon is clicked on a non-Google-Forms page.
chrome.action.onClicked.addListener((tab) => {
  console.log('[FormFiller] Extension icon clicked on tab:', tab.url);
});

// Listen for messages from content scripts and popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[FormFiller] Background received message:', message, 'from:', sender.tab?.url);

  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
    return true;
  }

  if (message.type === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      console.log('[FormFiller] Active tab:', tab?.url);
      sendResponse({ tab });
    });
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'INJECT_CONTENT_SCRIPT') {
    const tabId = message.tabId;
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => {
        if (chrome.runtime.lastError) {
          console.error('[FormFiller] Script injection error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[FormFiller] Content script injected into tab', tabId);
          sendResponse({ success: true });
        }
      }
    );
    return true;
  }
});
