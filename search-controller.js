document.addEventListener('DOMContentLoaded', async () => {
  const searchInput = document.getElementById('searchInput');
  const inlineError = document.getElementById('inlineError');
  const searchBtn = document.getElementById('searchBtn');
  const clearBtn = document.getElementById('clearBtn');
  const matchCountBadge = document.getElementById('matchCountBadge');
  const actionContainer = document.getElementById('actionContainer');
  const refreshPageBtn = document.getElementById('refreshPageBtn');

  function showElementError(message, showRefresh = false) {
    searchInput.classList.add('element-has-error');
    inlineError.innerHTML = message;
    inlineError.classList.add('visible');
    matchCountBadge.textContent = '';
    actionContainer.style.display = showRefresh ? 'block' : 'none';
  }

  function clearElementError() {
    searchInput.classList.remove('element-has-error');
    inlineError.innerHTML = '';
    inlineError.classList.remove('visible');
    actionContainer.style.display = 'none';
  }

  // Intercept protected internal browser protocols before sending messages
  function isRestrictedUrl(url) {
    if (!url) return true;
    const restrictedPrefixes = [
      'chrome://',
      'edge://',
      'about:',
      'chrome-extension://',
      'view-source:',
      'devtools://'
    ];
    return restrictedPrefixes.some(prefix => url.startsWith(prefix)) ||
           url.includes('chromewebstore.google.com') ||
           url.includes('chrome.google.com/webstore');
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab || isRestrictedUrl(activeTab.url)) {
    searchInput.disabled = true;
    searchBtn.disabled = true;
    clearBtn.disabled = true;
    searchInput.placeholder = "Disabled on protected tabs";
    showElementError("Search cannot run on internal browser or Web Store pages.");
    return;
  }

  searchInput.addEventListener('input', () => {
    if (searchInput.classList.contains('element-has-error')) {
      clearElementError();
    }
  });

  refreshPageBtn.addEventListener('click', () => {
    chrome.tabs.reload(activeTab.id, () => {
      window.close();
    });
  });

  // Inject script automatically into tabs that were opened prior to loading the extension
  async function ensureContentScriptInjected(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css']
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function executeSearch() {
    clearElementError();
    const rawValue = searchInput.value.trim();

    if (!rawValue) {
      showElementError('Please enter at least one word to search.');
      searchInput.focus();
      return;
    }

    const terms = rawValue.split(/\s+/).filter(Boolean);

    function dispatchHighlight() {
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: 'highlight', terms: terms },
        (response) => {
          if (chrome.runtime.lastError) {
            showElementError(
              'Could not communicate with the page. Click below to refresh this tab.',
              true
            );
            return;
          }

          if (response && response.matchesFound === 0) {
            showElementError(`No visible elements contained all ${terms.length} terms.`);
          } else if (response && response.matchesFound > 0) {
            matchCountBadge.textContent = `Found and highlighted ${response.matchesFound} element(s).`;
          }
        }
      );
    }

    // Ping existing content script; if absent, inject dynamically without forcing a reload
    chrome.tabs.sendMessage(activeTab.id, { action: 'ping' }, async () => {
      if (chrome.runtime.lastError) {
        const injected = await ensureContentScriptInjected(activeTab.id);
        if (injected) {
          setTimeout(dispatchHighlight, 80);
        } else {
          showElementError('Failed to attach script. Refresh the page to enable.', true);
        }
      } else {
        dispatchHighlight();
      }
    });
  }

  function executeClear() {
    clearElementError();
    searchInput.value = '';
    matchCountBadge.textContent = '';
    searchInput.focus();

    chrome.tabs.sendMessage(activeTab.id, { action: 'clear' }, () => {
      void chrome.runtime.lastError;
    });
  }

  searchBtn.addEventListener('click', executeSearch);
  clearBtn.addEventListener('click', executeClear);

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  });
});