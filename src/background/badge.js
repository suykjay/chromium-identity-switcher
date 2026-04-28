/**
 * Badge management for Identity Switcher
 */

import { getSiteKey } from '../shared/utils.js';
import { getState } from './storage.js';

/**
 * Update badge for a specific tab
 * @param {number} tabId
 */
export async function updateBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    let url;
    try {
      url = new URL(tab.url);
    } catch {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    if (!/^https?:$/.test(url.protocol)) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const site = getSiteKey(url.hostname);
    const state = await getState();
    const s = state.sites[site];
    if (!s || !s.activeId) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    const identity = s.identities.find(i => i.id === s.activeId);
    if (!identity) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text: identity.name.slice(0, 4) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: identity.color || '#888' });
  } catch {
    // Tab may have been closed
  }
}

/**
 * Update badge for all tabs of a site
 * @param {string} site
 */
export async function updateBadgeForSite(site) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      if (!tab.url) continue;
      const url = new URL(tab.url);
      if (getSiteKey(url.hostname) === site) {
        await updateBadgeForTab(tab.id);
      }
    } catch {}
  }
}

/**
 * Update badges for all tabs
 */
export async function updateAllBadges() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await updateBadgeForTab(tab.id);
  }
}
