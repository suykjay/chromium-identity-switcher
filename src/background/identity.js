/**
 * Identity management operations
 */

import { PALETTE, autoNameFor, uniquifyName } from '../shared/utils.js';
import {
  getState, setState, ensureSite, parkCookies, unparkCookies,
  clearVaultCookies, getCookiesForSite, clearSiteCookies
} from './storage.js';

/**
 * List identities for a site
 * @param {string} site
 * @returns {Promise<Object>}
 */
export async function listSite(site) {
  const state = await getState();
  const s = state.sites[site] || { identities: [], activeId: null };

  let willAutoCapture = false;
  if (s.activeId === null) {
    const cookies = await getCookiesForSite(site);
    willAutoCapture = cookies.length > 0;
  }
  const reserved = s.identities.map(i => i.name);
  if (willAutoCapture) reserved.push(autoNameFor(s.identities));
  const suggestedName = autoNameFor(reserved.map(name => ({ name })));

  return { site, identities: s.identities, activeId: s.activeId, suggestedName };
}

/**
 * Create a new identity
 * @param {Object} params
 * @param {string} params.site
 * @param {string} params.name
 * @param {string} params.color
 * @returns {Promise<Object>}
 */
export async function createIdentity({ site, name, color }) {
  const state = await getState();
  const s = ensureSite(state, site);

  const currentCookies = await getCookiesForSite(site);

  if (s.activeId) {
    state.jarMeta[`${site}::${s.activeId}`] = await parkCookies(site, s.activeId, currentCookies);
  } else if (currentCookies.length > 0) {
    const implicitId = crypto.randomUUID();
    s.identities.push({
      id: implicitId,
      name: autoNameFor(s.identities),
      color: PALETTE[s.identities.length % PALETTE.length],
      createdAt: Date.now(),
    });
    state.jarMeta[`${site}::${implicitId}`] = await parkCookies(site, implicitId, currentCookies);
  }

  const id = crypto.randomUUID();
  const identity = { id, name: uniquifyName(name, s.identities), color, createdAt: Date.now() };
  s.identities.push(identity);
  state.jarMeta[`${site}::${id}`] = [];
  s.activeId = id;

  await setState(state);
  await clearSiteCookies(site);
  return { identity, reloadNeeded: true };
}

/**
 * Switch to another identity
 * @param {Object} params
 * @param {string} params.site
 * @param {string} params.toId
 * @returns {Promise<Object>}
 */
export async function switchIdentity({ site, toId }) {
  const state = await getState();
  const s = ensureSite(state, site);
  if (s.activeId === toId) return { changed: false };

  if (s.activeId) {
    const currentCookies = await getCookiesForSite(site);
    state.jarMeta[`${site}::${s.activeId}`] = await parkCookies(site, s.activeId, currentCookies);
  }

  await clearSiteCookies(site);

  const targetMeta = state.jarMeta[`${site}::${toId}`] || [];
  await unparkCookies(site, targetMeta);
  state.jarMeta[`${site}::${toId}`] = [];

  s.activeId = toId;
  await setState(state);
  return { changed: true };
}

/**
 * Delete an identity
 * @param {Object} params
 * @param {string} params.site
 * @param {string} params.id
 * @returns {Promise<Object>}
 */
export async function deleteIdentity({ site, id }) {
  const state = await getState();
  const s = state.sites[site];
  if (!s) return { changed: false };

  await clearVaultCookies(site, state.jarMeta[`${site}::${id}`] || []);
  delete state.jarMeta[`${site}::${id}`];

  s.identities = s.identities.filter(i => i.id !== id);
  let wasActive = false;
  if (s.activeId === id) {
    s.activeId = null;
    wasActive = true;
  }
  await setState(state);
  if (wasActive) await clearSiteCookies(site);
  return { changed: true, wasActive };
}

/**
 * Rename an identity
 * @param {Object} params
 * @param {string} params.site
 * @param {string} params.id
 * @param {string} params.name
 * @param {string} params.color
 * @returns {Promise<Object>}
 */
export async function renameIdentity({ site, id, name, color }) {
  const state = await getState();
  const s = state.sites[site];
  const it = s?.identities.find(x => x.id === id);
  if (!it) return { changed: false };
  if (typeof name === 'string') it.name = name;
  if (typeof color === 'string') it.color = color;
  await setState(state);
  return { changed: true };
}

/**
 * Clear all data
 * @returns {Promise<Object>}
 */
export async function clearAllData() {
  const state = await getState();
  for (const key of Object.keys(state.jarMeta)) {
    const s = key.split('::')[0];
    await clearVaultCookies(s, state.jarMeta[key]);
  }
  const { SITES, JAR_META } = (await import('../shared/utils.js')).STORAGE_KEYS;
  await chrome.storage.local.remove([SITES, JAR_META]);
  return { success: true };
}
