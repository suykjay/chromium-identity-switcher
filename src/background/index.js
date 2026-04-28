/**
 * Identity Switcher - Background Service Worker (MV3)
 */

import { STORAGE_KEYS } from '../shared/utils.js';
import { migrateFromLegacy, getState, setState, clearVaultCookies } from './storage.js';
import { listSite, createIdentity, switchIdentity, deleteIdentity, renameIdentity, clearAllData } from './identity.js';
import { updateBadgeForTab, updateBadgeForSite, updateAllBadges } from './badge.js';

// Operations that require badge updates
const BADGE_OPS = new Set(['createIdentity', 'switchIdentity', 'deleteIdentity', 'renameIdentity']);

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      let result;
      switch (msg?.type) {
        case 'listSite':
          result = await listSite(msg.site);
          break;
        case 'createIdentity':
          result = await createIdentity(msg);
          break;
        case 'switchIdentity':
          result = await switchIdentity(msg);
          break;
        case 'deleteIdentity':
          result = await deleteIdentity(msg);
          break;
        case 'renameIdentity':
          result = await renameIdentity(msg);
          break;
        case 'clearAllData':
          result = await clearAllData();
          break;
        default:
          return sendResponse({ ok: false, error: 'unknown message type' });
      }
      sendResponse({ ok: true, data: result });

      if (BADGE_OPS.has(msg.type)) {
        await updateBadgeForSite(msg.site);
      }
      if (msg.type === 'clearAllData') {
        await updateAllBadges();
      }
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // Keep channel open for async response
});

// Tab event listeners for badge updates
chrome.tabs.onActivated.addListener(({ tabId }) => updateBadgeForTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateBadgeForTab(tabId);
  }
});

// Cleanup jarMeta for sites with no identities on startup
chrome.runtime.onStartup.addListener(async () => {
  await migrateFromLegacy();
  const state = await getState();
  let dirty = false;
  for (const key of Object.keys(state.jarMeta)) {
    const [site, id] = key.split('::');
    const s = state.sites[site];
    if (!s || !s.identities.some(i => i.id === id)) {
      await clearVaultCookies(site, state.jarMeta[key]);
      delete state.jarMeta[key];
      dirty = true;
    }
  }
  if (dirty) await setState(state);
  await updateAllBadges();
});

chrome.runtime.onInstalled.addListener(() => migrateFromLegacy());
