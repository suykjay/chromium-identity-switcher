/**
 * Storage management for Identity Switcher
 */

import { VAULT_CONFIG, STORAGE_KEYS, COMPOUND_TLDS } from '../shared/utils.js';

const { SITES, JAR_META } = STORAGE_KEYS;

/**
 * Get current state from storage
 * @returns {Promise<{sites: Object, jarMeta: Object}>}
 */
export async function getState() {
  const data = await chrome.storage.local.get([SITES, JAR_META]);
  return { sites: data[SITES] || {}, jarMeta: data[JAR_META] || {} };
}

/**
 * Save state to storage
 * @param {{sites: Object, jarMeta: Object}} state
 */
export async function setState(state) {
  await chrome.storage.local.set({ [SITES]: state.sites, [JAR_META]: state.jarMeta });
}

/**
 * Ensure site exists in state
 * @param {Object} state
 * @param {string} site
 * @returns {Object} Site data
 */
export function ensureSite(state, site) {
  if (!state.sites[site]) {
    state.sites[site] = { identities: [], activeId: null };
  }
  return state.sites[site];
}

/**
 * Vault cookie management functions
 */

export function vaultDomain(site) {
  return site.replace(/\./g, '-') + '.' + VAULT_CONFIG.BASE;
}

export function vaultUrl(site) {
  return `http://${vaultDomain(site)}/`;
}

/**
 * Park cookies to vault
 * @param {string} site
 * @param {string} identityId
 * @param {Array} cookies
 * @returns {Promise<Array>} Metadata
 */
export async function parkCookies(site, identityId, cookies) {
  const url = vaultUrl(site);
  const meta = [];
  for (let i = 0; i < cookies.length; i++) {
    const c = cookies[i];
    const vaultName = `${identityId}__${i}`;
    try {
      await chrome.cookies.set({
        url,
        name: vaultName,
        value: c.value,
        expirationDate: c.expirationDate || (Date.now() / 1000 + 365 * 24 * 3600),
      });
    } catch (e) {
      console.warn('vault park failed', vaultName, e);
      continue;
    }
    meta.push({
      name: c.name,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      hostOnly: c.hostOnly,
      session: c.session,
      expirationDate: c.expirationDate,
      storeId: c.storeId,
      vaultName,
    });
  }
  return meta;
}

/**
 * Unpark cookies from vault
 * @param {string} site
 * @param {Array} meta
 */
export async function unparkCookies(site, meta) {
  const url = vaultUrl(site);
  for (const m of meta) {
    try {
      const vc = await chrome.cookies.get({ url, name: m.vaultName });
      if (!vc) continue;
      const details = {
        url: cookieUrl(m),
        name: m.name,
        value: vc.value,
        path: m.path,
        secure: m.secure,
        httpOnly: m.httpOnly,
        sameSite: m.sameSite,
        storeId: m.storeId,
      };
      if (!m.hostOnly) details.domain = m.domain;
      if (!m.session && m.expirationDate) details.expirationDate = m.expirationDate;
      await chrome.cookies.set(details);
      await chrome.cookies.remove({ url, name: m.vaultName });
    } catch (e) {
      console.warn('vault unpark failed', m.vaultName, e);
    }
  }
}

/**
 * Clear vault cookies
 * @param {string} site
 * @param {Array} meta
 */
export async function clearVaultCookies(site, meta) {
  if (!meta || !meta.length) return;
  const url = vaultUrl(site);
  for (const m of meta) {
    try { await chrome.cookies.remove({ url, name: m.vaultName }); } catch {}
  }
}

/**
 * Get cookies for a site
 * @param {string} site
 * @returns {Promise<Array>}
 */
export async function getCookiesForSite(site) {
  try {
    return await chrome.cookies.getAll({ domain: site });
  } catch (e) {
    console.warn('getAll failed', site, e);
    return [];
  }
}

/**
 * Build cookie URL
 * @param {Object} c
 * @returns {string}
 */
export function cookieUrl(c) {
  const host = c.domain.replace(/^\./, '');
  return `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`;
}

/**
 * Clear all cookies for a site
 * @param {string} site
 */
export async function clearSiteCookies(site) {
  const cookies = await getCookiesForSite(site);
  await Promise.all(cookies.map(c =>
    chrome.cookies.remove({
      url: cookieUrl(c),
      name: c.name,
      storeId: c.storeId,
    }).catch(() => {})
  ));
}

/**
 * Migrate legacy data format
 */
export async function migrateFromLegacy() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.LEGACY_JARS]);
  if (!data.jars) return;
  const state = await getState();
  for (const key of Object.keys(data.jars)) {
    if (state.jarMeta[key]) continue;
    const cookies = data.jars[key];
    const [site, id] = key.split('::');
    state.jarMeta[key] = cookies.length > 0
      ? await parkCookies(site, id, cookies)
      : [];
  }
  await setState(state);
  await chrome.storage.local.remove([STORAGE_KEYS.LEGACY_JARS]);
}
