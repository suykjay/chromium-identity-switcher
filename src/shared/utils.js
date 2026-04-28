/**
 * Shared utilities for Identity Switcher extension
 */

// Compound TLDs that should be considered as a single unit
export const COMPOUND_TLDS = new Set([
  'co.uk', 'com.cn', 'com.hk', 'com.tw', 'com.au', 'co.jp', 'co.kr',
  'com.br', 'org.uk', 'ac.uk', 'ne.jp', 'or.jp', 'com.sg', 'com.my',
  'co.in', 'co.nz', 'co.za',
]);

/**
 * Extract site key from hostname
 * Handles compound TLDs and IP addresses correctly
 * @param {string} hostname - The hostname to process
 * @returns {string} The site key
 */
export function getSiteKey(hostname) {
  if (!hostname) return '';
  hostname = hostname.replace(/^www\./, '');
  // If it's an IP, use as-is
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const last2 = parts.slice(-2).join('.');
  if (COMPOUND_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

/**
 * Identity color palette
 */
export const PALETTE = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#64748b', // slate
];

/**
 * Generate auto name for a new identity
 * @param {Array} identities - Existing identities
 * @returns {string} Auto-generated name
 */
export function autoNameFor(identities) {
  const used = new Set(identities.map(i => i.name));
  for (let n = 1; n < 10000; n++) {
    const candidate = chrome.i18n.getMessage('identityNamePattern', [String(n)]);
    if (!used.has(candidate)) return candidate;
  }
  return chrome.i18n.getMessage('identityNamePattern', [String(Date.now())]);
}

/**
 * Make a name unique by appending a number if necessary
 * @param {string} name - Desired name
 * @param {Array} identities - Existing identities
 * @returns {string} Unique name
 */
export function uniquifyName(name, identities) {
  const used = new Set(identities.map(i => i.name));
  if (!used.has(name)) return name;
  for (let n = 2; n < 10000; n++) {
    const candidate = chrome.i18n.getMessage('uniquifyNamePattern', [name, String(n)]);
    if (!used.has(candidate)) return candidate;
  }
  return `${name} (${Date.now()})`;
}

/**
 * Escape HTML special characters
 * @param {string} s - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/**
 * Vault configuration
 */
export const VAULT_CONFIG = {
  BASE: 'isw-vault.invalid',
  getDomain(site) {
    return site.replace(/\./g, '-') + '.' + this.BASE;
  },
  getUrl(site) {
    return `http://${this.getDomain(site)}/`;
  }
};

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  SITES: 'sites',
  JAR_META: 'jarMeta',
  LEGACY_JARS: 'jars'
};
