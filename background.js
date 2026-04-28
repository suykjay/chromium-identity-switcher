// Identity Switcher — background service worker (MV3)

const SK = 'sites';
const MK = 'jarMeta';
const VAULT_BASE = 'isw-vault.invalid';

// ---------- storage helpers ----------
async function getState() {
  const data = await chrome.storage.local.get([SK, MK]);
  return { sites: data[SK] || {}, jarMeta: data[MK] || {} };
}

async function setState(state) {
  await chrome.storage.local.set({ [SK]: state.sites, [MK]: state.jarMeta });
}

function ensureSite(state, site) {
  if (!state.sites[site]) state.sites[site] = { identities: [], activeId: null };
  return state.sites[site];
}

// ---------- site key helper ----------
const COMPOUND_TLDS = new Set([
  'co.uk','com.cn','com.hk','com.tw','com.au','co.jp','co.kr',
  'com.br','org.uk','ac.uk','ne.jp','or.jp','com.sg','com.my',
  'co.in','co.nz','co.za',
]);

function getSiteKey(hostname) {
  if (!hostname) return '';
  hostname = hostname.replace(/^www\./, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const last2 = parts.slice(-2).join('.');
  if (COMPOUND_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

// ---------- vault helpers ----------
function vaultDomain(site) {
  return site.replace(/\./g, '-') + '.' + VAULT_BASE;
}

function vaultUrl(site) {
  return `http://${vaultDomain(site)}/`;
}

async function parkCookies(site, identityId, cookies) {
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

async function unparkCookies(site, meta) {
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

async function clearVaultCookies(site, meta) {
  if (!meta || !meta.length) return;
  const url = vaultUrl(site);
  for (const m of meta) {
    try { await chrome.cookies.remove({ url, name: m.vaultName }); } catch {}
  }
}

// ---------- cookie helpers ----------
async function getCookiesForSite(site) {
  try {
    return await chrome.cookies.getAll({ domain: site });
  } catch (e) {
    console.warn('getAll failed', site, e);
    return [];
  }
}

function cookieUrl(c) {
  const host = c.domain.replace(/^\./, '');
  return `http${c.secure ? 's' : ''}://${host}${c.path || '/'}`;
}

async function clearSiteCookies(site) {
  const cookies = await getCookiesForSite(site);
  await Promise.all(cookies.map(c =>
    chrome.cookies.remove({
      url: cookieUrl(c),
      name: c.name,
      storeId: c.storeId,
    }).catch(() => {})
  ));
}

// ---------- actions ----------
async function listSite(site) {
  const state = await getState();
  const s = state.sites[site] || { identities: [], activeId: null };
  // Predict whether `createIdentity` will auto-create an implicit identity
  // (happens when there is no active identity but the browser currently has
  // cookies for this site). Use that to reserve the next auto-name so the
  // user's default suggestion won't collide.
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

const PALETTE = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#64748b'];

function autoNameFor(identities) {
  const used = new Set(identities.map(i => i.name));
  for (let n = 1; n < 10000; n++) {
    const candidate = `身份 ${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `身份 ${Date.now()}`;
}

function uniquifyName(name, identities) {
  const used = new Set(identities.map(i => i.name));
  if (!used.has(name)) return name;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${name} (${n})`;
    if (!used.has(candidate)) return candidate;
  }
  return `${name} (${Date.now()})`;
}

// Always-safe create: current cookie state is never silently discarded.
// - If there is an active identity, current cookies are first parked
//   into the vault on a .invalid domain (normal case).
// - If there is no active identity but the browser currently has
//   cookies for this site, an implicit identity is auto-created to
//   hold them so the user does not lose any existing login.
// Then a fresh, blank identity is created and becomes active; the
// browser's cookie store is cleared so the caller can reload the tab
// and log in with a new account.
async function createIdentity({ site, name, color }) {
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

async function switchIdentity({ site, toId }) {
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

async function deleteIdentity({ site, id }) {
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

async function renameIdentity({ site, id, name, color }) {
  const state = await getState();
  const s = state.sites[site];
  const it = s?.identities.find(x => x.id === id);
  if (!it) return { changed: false };
  if (typeof name === 'string') it.name = name;
  if (typeof color === 'string') it.color = color;
  await setState(state);
  return { changed: true };
}

// ---------- messaging ----------
const BADGE_OPS = new Set(['createIdentity','switchIdentity','deleteIdentity','renameIdentity']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      let result;
      switch (msg?.type) {
        case 'listSite':       result = await listSite(msg.site); break;
        case 'createIdentity': result = await createIdentity(msg); break;
        case 'switchIdentity': result = await switchIdentity(msg); break;
        case 'deleteIdentity': result = await deleteIdentity(msg); break;
        case 'renameIdentity': result = await renameIdentity(msg); break;
        case 'clearAllData': {
          const state = await getState();
          for (const key of Object.keys(state.jarMeta)) {
            const s = key.split('::')[0];
            await clearVaultCookies(s, state.jarMeta[key]);
          }
          await chrome.storage.local.remove([SK, MK]);
          result = { success: true };
          break;
        }
        default:               return sendResponse({ ok: false, error: 'unknown message type' });
      }
      sendResponse({ ok: true, data: result });
      if (BADGE_OPS.has(msg.type)) updateBadgeForSite(msg.site);
      if (msg.type === 'clearAllData') updateAllBadges();
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // keep channel open for async response
});

// ---------- badge ----------
async function updateBadgeForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) { await chrome.action.setBadgeText({ tabId, text: '' }); return; }
    let url;
    try { url = new URL(tab.url); } catch { await chrome.action.setBadgeText({ tabId, text: '' }); return; }
    if (!/^https?:$/.test(url.protocol)) { await chrome.action.setBadgeText({ tabId, text: '' }); return; }
    const site = getSiteKey(url.hostname);
    const state = await getState();
    const s = state.sites[site];
    if (!s || !s.activeId) { await chrome.action.setBadgeText({ tabId, text: '' }); return; }
    const identity = s.identities.find(i => i.id === s.activeId);
    if (!identity) { await chrome.action.setBadgeText({ tabId, text: '' }); return; }
    await chrome.action.setBadgeText({ tabId, text: identity.name.slice(0, 4) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: identity.color || '#888' });
  } catch { /* tab may have been closed */ }
}

async function updateBadgeForSite(site) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      if (!tab.url) continue;
      const url = new URL(tab.url);
      if (getSiteKey(url.hostname) === site) updateBadgeForTab(tab.id);
    } catch {}
  }
}

async function updateAllBadges() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) updateBadgeForTab(tab.id);
}

chrome.tabs.onActivated.addListener(({ tabId }) => updateBadgeForTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') updateBadgeForTab(tabId);
});

// ---------- legacy migration ----------
async function migrateFromLegacy() {
  const data = await chrome.storage.local.get(['jars']);
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
  await chrome.storage.local.remove(['jars']);
}

// Cleanup jarMeta for sites with no identities (rare, but keep storage tidy)
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
  updateAllBadges();
});

chrome.runtime.onInstalled.addListener(() => migrateFromLegacy());
