chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Safely remove a tab and retry if the tab strip is locked/dragging
async function safeRemoveTab(tabId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.remove(tabId);
      return;
    } catch (err) {
      if (err.message && err.message.includes('Tabs cannot be edited right now') && i < retries - 1) {
        // Wait 300ms for the user/browser to finish the tab strip transition, then retry
        await new Promise((resolve) => setTimeout(resolve, 300));
      } else {
        // Tab was already closed or cannot be removed; log and ignore
        console.warn(`Could not close tab ${tabId}:`, err.message);
        return;
      }
    }
  }
}

function closeTabsWithWord(word) {
  const searchWord = word.toLowerCase();

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      // 1. Protected Pages & Discarded Tabs: 
      // Avoid reloading discarded tabs to preserve memory and prevent SW lifecycle bugs.
      // Fallback to checking title/url instead.
      if (
        tab.discarded ||
        !tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.includes('chromewebstore.google.com')
      ) {
        if (
          (tab.title && tab.title.toLowerCase().includes(searchWord)) ||
          (tab.url && tab.url.toLowerCase().includes(searchWord))
        ) {
          safeRemoveTab(tab.id);
        }
        return;
      }

      // 2. Active Tabs: Inject search script
      injectSearchScript(tab.id, searchWord);
    });
  });
}

function injectSearchScript(tabId, searchWord) {
  chrome.scripting.executeScript(
    {
      target: { tabId: tabId, allFrames: true },
      func: (searchWord) => {
        // 3. Polling for asynchronous DOM rendering
        return new Promise((resolve) => {
          // FIX: Use optional chaining in case innerText is undefined (e.g., SVG/XML pages)
          const checkText = () =>
            document.body?.innerText?.toLowerCase().includes(searchWord) || false;

          if (checkText()) return resolve(true);

          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            try {
              if (checkText()) {
                clearInterval(interval);
                resolve(true);
              } else if (attempts >= 6) {
                clearInterval(interval);
                resolve(false);
              }
            } catch (e) {
              // Failsafe to ensure the interval clears if an unexpected DOM error occurs
              clearInterval(interval);
              resolve(false);
            }
          }, 500);
        });
      },
      args: [searchWord]
    },
    (results) => {
      if (chrome.runtime.lastError) {
        console.warn(`Skipping tab ${tabId}:`, chrome.runtime.lastError.message);
        return;
      }

      if (results && results.some((frame) => frame.result === true)) {
        safeRemoveTab(tabId);
      }
    }
  );
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'closeTabs') {
    closeTabsWithWord(request.word);
  }
  sendResponse({ status: 'done' });
});