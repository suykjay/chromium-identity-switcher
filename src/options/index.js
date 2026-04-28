/**
 * Identity Switcher - Options Page
 */

import {
  initI18n, applyI18nToDocument, getMessage,
  AVAILABLE_LANGUAGES, getCurrentLanguage, setLanguage,
  getStoredLanguage, clearLanguage
} from '../shared/i18n.js';

/**
 * Populate language dropdown
 */
async function populateLanguageSelect() {
  const select = document.getElementById('language-select');
  select.innerHTML = '';
  const storedLang = await getStoredLanguage();

  // Add "Auto (Browser Default)" option
  const autoOption = document.createElement('option');
  autoOption.value = '';
  autoOption.textContent = getMessage('autoLanguage') || 'Auto (Browser Default)';
  select.appendChild(autoOption);

  // Add available languages
  for (const [code, name] of Object.entries(AVAILABLE_LANGUAGES)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  }

  // Set current selection based on stored preference
  select.value = storedLang || '';
}

/**
 * Initialize options page
 */
async function init() {
  await initI18n();
  applyI18nToDocument();

  document.getElementById('version').textContent = chrome.runtime.getManifest().version;

  await populateLanguageSelect();
}

// Language select change handler
document.getElementById('language-select').addEventListener('change', async (e) => {
  const lang = e.target.value;
  if (lang) {
    await setLanguage(lang);
  } else {
    await clearLanguage();
  }
  location.reload();
});

// Clear all data button
document.getElementById('btn-clear-all').onclick = async () => {
  if (!confirm(getMessage('clearAllConfirm'))) return;
  const res = await chrome.runtime.sendMessage({ type: 'clearAllData' });
  if (res?.ok) {
    alert(getMessage('clearAllSuccess'));
  } else {
    alert(getMessage('clearAllError', [res?.error || getMessage('unknownError') || 'Unknown error']));
  }
};

// Initialize
init();
