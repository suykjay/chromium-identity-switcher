/**
 * Identity Switcher - Popup
 */

import { getSiteKey, PALETTE, escapeHtml } from '../shared/utils.js';
import { initI18n, applyI18nToDocument, getMessage } from '../shared/i18n.js';

let currentTab = null;
let currentSite = '';
let siteState = null; // { identities, activeId }

/**
 * Send message to background script
 * @param {Object} msg
 * @returns {Promise<Object>}
 */
async function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

/**
 * Get origins for a site
 * @param {string} site
 * @returns {Array}
 */
function originsForSite(site) {
  return [`*://*.${site}/*`, `*://${site}/*`];
}

/**
 * Initialize popup
 */
async function init() {
  // Initialize i18n first
  await initI18n();
  applyI18nToDocument();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];
  if (!currentTab || !currentTab.url) {
    return renderUnsupported(getMessage('noActiveTab'));
  }

  let url;
  try {
    url = new URL(currentTab.url);
  } catch {
    return renderUnsupported(getMessage('invalidUrl'));
  }

  if (!/^https?:$/.test(url.protocol)) {
    return renderUnsupported(getMessage('unsupportedProtocol'));
  }

  currentSite = getSiteKey(url.hostname);
  document.getElementById('site').textContent = currentSite;

  const origins = originsForSite(currentSite);
  const granted = await chrome.permissions.contains({ origins });
  if (!granted) return renderGrant(origins);

  await refresh();
}

/**
 * Render unsupported state
 * @param {string} msg
 */
function renderUnsupported(msg) {
  document.getElementById('content').innerHTML = `<div class="hint">${escapeHtml(msg)}</div>`;
}

/**
 * Render permission grant UI
 * @param {Array} origins
 */
function renderGrant(origins) {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="grant">
      <p>${getMessage('permissionRequired', [currentSite])}</p>
      <button class="primary" id="btn-grant">${getMessage('grantPermission')}</button>
    </div>
  `;
  document.getElementById('btn-grant').onclick = async () => {
    const ok = await chrome.permissions.request({ origins });
    if (ok) await refresh();
  };
}

/**
 * Refresh identity list
 */
async function refresh() {
  const res = await send({ type: 'listSite', site: currentSite });
  if (!res?.ok) {
    return renderUnsupported(res?.error || getMessage('readFailed'));
  }
  siteState = res.data;
  render();
}

/**
 * Render identity list
 */
function render() {
  const c = document.getElementById('content');
  c.innerHTML = '';

  if (!siteState.identities.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = getMessage('noIdentities');
    c.appendChild(hint);
  } else {
    for (const idn of siteState.identities) {
      c.appendChild(renderIdentity(idn));
    }
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const bNew = document.createElement('button');
  bNew.className = 'primary';
  bNew.textContent = getMessage('newIdentity');
  bNew.onclick = () => openDialog({});
  actions.appendChild(bNew);
  c.appendChild(actions);
}

/**
 * Render single identity row
 * @param {Object} idn
 * @returns {HTMLElement}
 */
function renderIdentity(idn) {
  const tpl = document.getElementById('tpl-identity');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.dot').style.background = idn.color || '#888';
  node.querySelector('.name').textContent = idn.name || getMessage('unnamed');
  const isActive = idn.id === siteState.activeId;
  if (isActive) {
    node.classList.add('active');
    node.querySelector('.active-badge').hidden = false;
  }

  node.querySelector('.btn-switch').onclick = () => doSwitch(idn.id);
  node.querySelector('.btn-edit').onclick = () => openEdit(idn);
  node.querySelector('.btn-del').onclick = () => doDelete(idn);

  applyI18nToDocument(node);
  return node;
}

/**
 * Open create/edit dialog
 * @param {Object} params
 * @param {Object} [params.editing]
 */
function openDialog({ editing }) {
  const c = document.getElementById('content');
  c.querySelector('.dialog')?.remove();

  const defaultName = editing
    ? editing.name
    : (siteState.suggestedName || getMessage('identityNamePattern', [String(siteState.identities.length + 1)]));
  const defaultColor = editing
    ? editing.color
    : PALETTE[siteState.identities.length % PALETTE.length];

  const d = document.createElement('div');
  d.className = 'dialog';
  d.innerHTML = `
    <label>${getMessage('identityName')}</label>
    <input type="text" id="d-name" maxlength="40" value="${escapeHtml(defaultName)}">
    <label>${getMessage('color')}</label>
    <div class="swatches" id="d-swatches"></div>
    ${editing ? '' : `<div class="hint" style="padding:6px 0">${getMessage('autoCaptureHint')}</div>`}
    <div class="error" id="d-err" hidden></div>
    <div class="dialog-actions">
      <button id="d-cancel">${getMessage('cancel')}</button>
      <button class="primary" id="d-ok">${editing ? getMessage('save') : getMessage('create')}</button>
    </div>
  `;
  c.appendChild(d);

  let selectedColor = defaultColor;
  const sw = d.querySelector('#d-swatches');
  for (const color of PALETTE) {
    const s = document.createElement('span');
    s.className = 'swatch' + (color === selectedColor ? ' selected' : '');
    s.style.background = color;
    s.onclick = () => {
      selectedColor = color;
      sw.querySelectorAll('.swatch').forEach(el => el.classList.toggle('selected', el === s));
    };
    sw.appendChild(s);
  }

  const nameInput = d.querySelector('#d-name');
  nameInput.focus();
  nameInput.select();

  d.querySelector('#d-cancel').onclick = () => d.remove();
  d.querySelector('#d-ok').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      const err = d.querySelector('#d-err');
      err.textContent = getMessage('nameRequired');
      err.hidden = false;
      return;
    }

    if (editing) {
      await send({ type: 'renameIdentity', site: currentSite, id: editing.id, name, color: selectedColor });
      await refresh();
      return;
    }

    const res = await send({
      type: 'createIdentity',
      site: currentSite,
      name,
      color: selectedColor,
    });
    if (!res?.ok) {
      const err = d.querySelector('#d-err');
      err.textContent = res?.error || getMessage('createFailed');
      err.hidden = false;
      return;
    }
    if (res.data?.reloadNeeded) {
      await chrome.tabs.reload(currentTab.id);
      window.close();
      return;
    }
    await refresh();
  };

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') d.querySelector('#d-ok').click();
    if (e.key === 'Escape') d.remove();
  });
}

/**
 * Open edit dialog
 * @param {Object} idn
 */
function openEdit(idn) {
  openDialog({ editing: idn });
}

/**
 * Switch to identity
 * @param {string} toId
 */
async function doSwitch(toId) {
  if (toId === siteState.activeId) return;
  const res = await send({ type: 'switchIdentity', site: currentSite, toId });
  if (!res?.ok) return showToast(res?.error || getMessage('switchFailed'));
  await chrome.tabs.reload(currentTab.id);
  window.close();
}

/**
 * Delete identity
 * @param {Object} idn
 */
async function doDelete(idn) {
  const isActive = idn.id === siteState.activeId;
  const warn = isActive
    ? getMessage('deleteConfirmActive', [idn.name])
    : getMessage('deleteConfirm', [idn.name]);
  const ok = await inlineConfirm(warn);
  if (!ok) return;
  const res = await send({ type: 'deleteIdentity', site: currentSite, id: idn.id });
  if (!res?.ok) return showToast(res?.error || getMessage('deleteFailed'));
  if (res.data?.wasActive) {
    await chrome.tabs.reload(currentTab.id);
    window.close();
    return;
  }
  await refresh();
}

/**
 * Show inline confirmation dialog
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function inlineConfirm(message) {
  return new Promise(resolve => {
    const c = document.getElementById('content');
    c.querySelector('.dialog')?.remove();
    const d = document.createElement('div');
    d.className = 'dialog';
    d.innerHTML = `
      <div style="font-size:13px">${escapeHtml(message)}</div>
      <div class="dialog-actions">
        <button id="c-no">${getMessage('cancel')}</button>
        <button class="primary danger" id="c-yes" style="background:var(--danger);border-color:var(--danger)">${getMessage('confirm')}</button>
      </div>
    `;
    c.appendChild(d);
    d.querySelector('#c-no').onclick = () => { d.remove(); resolve(false); };
    d.querySelector('#c-yes').onclick = () => { d.remove(); resolve(true); };
  });
}

/**
 * Show toast message
 * @param {string} msg
 */
function showToast(msg) {
  const c = document.getElementById('content');
  let t = c.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast error';
    t.style.marginTop = '8px';
    c.appendChild(t);
  }
  t.textContent = msg;
  setTimeout(() => t.remove(), 3000);
}

// Settings button
document.getElementById('btn-settings').onclick = () => chrome.runtime.openOptionsPage();

// Initialize
init();
