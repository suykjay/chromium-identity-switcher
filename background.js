// Identity Switcher — background service worker (MV3)

const SK = 'sites';
const JK = 'jars';

// ---------- storage helpers ----------
async function getState() {
  const data = await chrome.storage.local.get([SK, JK]);
  return { sites: data[SK] || {}, jars: data[JK] || {} };
}

async function setState(state) {
  await chrome.storage.local.set({ [SK]: state.sites, [JK]: state.jars });
}

function ensureSite(state, site) {
  if (!state.sites[site]) state.sites[site] = { identities: [], activeId: null };
  return state.sites[site];
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

async function restoreJar(jar) {
  for (const c of jar) {
    const details = {
      url: cookieUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      storeId: c.storeId,
    };
    if (!c.hostOnly) details.domain = c.domain;
    if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
    try {
      await chrome.cookies.set(details);
    } catch (e) {
      console.warn('cookies.set failed', c.name, e);
    }
  }
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
// - If there is an active identity, current cookies are first saved into
//   its jar (normal case).
// - If there is no active identity but the browser has cookies for this
//   site, an implicit identity is auto-created to hold them so the user
//   does not lose any existing login.
// Then a fresh, blank identity is created and becomes active; the
// browser's cookie store is cleared so the caller can reload the tab
// and log in with a new account.
async function createIdentity({ site, name, color }) {
  const state = await getState();
  const s = ensureSite(state, site);

  const currentCookies = await getCookiesForSite(site);

  if (s.activeId) {
    state.jars[`${site}::${s.activeId}`] = currentCookies;
  } else if (currentCookies.length > 0) {
    const implicitId = crypto.randomUUID();
    s.identities.push({
      id: implicitId,
      name: autoNameFor(s.identities),
      color: PALETTE[s.identities.length % PALETTE.length],
      createdAt: Date.now(),
    });
    state.jars[`${site}::${implicitId}`] = currentCookies;
  }

  const id = crypto.randomUUID();
  const identity = { id, name: uniquifyName(name, s.identities), color, createdAt: Date.now() };
  s.identities.push(identity);
  state.jars[`${site}::${id}`] = [];
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
    state.jars[`${site}::${s.activeId}`] = await getCookiesForSite(site);
  }
  await clearSiteCookies(site);
  const jar = state.jars[`${site}::${toId}`] || [];
  await restoreJar(jar);
  s.activeId = toId;
  await setState(state);
  return { changed: true };
}

async function deleteIdentity({ site, id }) {
  const state = await getState();
  const s = state.sites[site];
  if (!s) return { changed: false };
  s.identities = s.identities.filter(i => i.id !== id);
  delete state.jars[`${site}::${id}`];
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
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'listSite':       return sendResponse({ ok: true, data: await listSite(msg.site) });
        case 'createIdentity': return sendResponse({ ok: true, data: await createIdentity(msg) });
        case 'switchIdentity': return sendResponse({ ok: true, data: await switchIdentity(msg) });
        case 'deleteIdentity': return sendResponse({ ok: true, data: await deleteIdentity(msg) });
        case 'renameIdentity': return sendResponse({ ok: true, data: await renameIdentity(msg) });
        default:               return sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (e) {
      console.error(e);
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // keep channel open for async response
});

// Cleanup jars for sites with no identities (rare, but keep storage tidy)
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  let dirty = false;
  for (const key of Object.keys(state.jars)) {
    const [site, id] = key.split('::');
    const s = state.sites[site];
    if (!s || !s.identities.some(i => i.id === id)) {
      delete state.jars[key];
      dirty = true;
    }
  }
  if (dirty) await setState(state);
});
