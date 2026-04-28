/**
 * Internationalization manager for Identity Switcher
 * Supports runtime language switching
 */

// Available languages
export const AVAILABLE_LANGUAGES = {
  'en': 'English',
  'zh_CN': '简体中文',
  'zh_TW': '繁體中文',
  'ja': '日本語',
  'ko': '한국어'
};

// Storage key for language preference
const LANG_KEY = 'preferredLanguage';

// Current language
let currentLang = null;

// Message cache
let messageCache = {};

// Fallback language
const FALLBACK_LANG = 'en';

/**
 * Get browser language
 * @returns {string}
 */
function getBrowserLanguage() {
  const lang = navigator.language || navigator.userLanguage || 'en';
  // Map browser language to our supported codes
  const langMap = {
    'en': 'en', 'en-US': 'en', 'en-GB': 'en',
    'zh': 'zh_CN', 'zh-CN': 'zh_CN', 'zh-SG': 'zh_CN',
    'zh-TW': 'zh_TW', 'zh-HK': 'zh_TW', 'zh-MO': 'zh_TW',
    'ja': 'ja', 'ja-JP': 'ja',
    'ko': 'ko', 'ko-KR': 'ko'
  };
  return langMap[lang] || 'en';
}

/**
 * Get stored language preference
 * @returns {Promise<string|null>}
 */
export async function getStoredLanguage() {
  const data = await chrome.storage.local.get([LANG_KEY]);
  return data[LANG_KEY] || null;
}

/**
 * Initialize i18n system
 */
export async function initI18n() {
  const stored = await getStoredLanguage();
  currentLang = stored || getBrowserLanguage();
  await loadMessages(currentLang);
}

/**
 * Load messages for a language
 * @param {string} lang
 */
async function loadMessages(lang) {
  if (messageCache[lang]) return;

  try {
    // Try to fetch from _locales
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    if (response.ok) {
      messageCache[lang] = await response.json();
    } else {
      throw new Error(`Failed to load ${lang}`);
    }
  } catch (e) {
    // Fallback to English
    if (lang !== FALLBACK_LANG) {
      console.warn(`Language ${lang} not found, falling back to ${FALLBACK_LANG}`);
      await loadMessages(FALLBACK_LANG);
      if (lang === currentLang) {
        currentLang = FALLBACK_LANG;
      }
    }
  }
}

/**
 * Get message by key
 * @param {string} key
 * @param {Array} substitutions
 * @returns {string}
 */
export function getMessage(key, substitutions = []) {
  const messages = messageCache[currentLang] || messageCache[FALLBACK_LANG] || {};
  const message = messages[key]?.message;

  if (!message) {
    // Fallback to chrome.i18n
    return chrome.i18n.getMessage(key, substitutions);
  }

  // Handle placeholders
  if (substitutions.length > 0 && messages[key]?.placeholders) {
    let result = message;
    const placeholders = messages[key].placeholders;
    for (let i = 0; i < substitutions.length; i++) {
      const placeholderKey = Object.keys(placeholders)[i];
      if (placeholderKey) {
        result = result.replace(`$${placeholderKey.toUpperCase()}$`, substitutions[i]);
      }
    }
    // Handle $N$ pattern
    substitutions.forEach((sub, i) => {
      result = result.replace(`$${i + 1}$`, sub);
    });
    return result;
  }

  return message;
}

/**
 * Get current language
 * @returns {string}
 */
export function getCurrentLanguage() {
  return currentLang;
}

/**
 * Set language preference
 * @param {string} lang
 */
export async function setLanguage(lang) {
  if (!AVAILABLE_LANGUAGES[lang]) {
    throw new Error(`Unsupported language: ${lang}`);
  }
  currentLang = lang;
  await chrome.storage.local.set({ [LANG_KEY]: lang });
  await loadMessages(lang);
}

/**
 * Clear language preference (revert to auto-detect)
 */
export async function clearLanguage() {
  await chrome.storage.local.remove([LANG_KEY]);
  currentLang = getBrowserLanguage();
  await loadMessages(currentLang);
}

/**
 * Apply i18n to elements with data-i18n attributes
 * @param {Document} doc
 */
export function applyI18nToDocument(doc = document) {
  doc.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = getMessage(key);
    if (message) el.textContent = message;
  });

  doc.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const message = getMessage(key);
    if (message) el.title = message;
  });
}
