// Identity Switcher — popup

const COMPOUND_TLDS = new Set([
  'co.uk','com.cn','com.hk','com.tw','com.au','co.jp','co.kr',
  'com.br','org.uk','ac.uk','ne.jp','or.jp','com.sg','com.my',
  'co.in','co.nz','co.za',
]);

function getSiteKey(hostname) {
  if (!hostname) return '';
  hostname = hostname.replace(/^www\./, '');
  // If it's an IP, use as-is.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const last2 = parts.slice(-2).join('.');
  if (COMPOUND_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

const PALETTE = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#64748b'];

let currentTab = null;
let currentSite = '';
let siteState = null; // { identities, activeId }

async function send(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];
  if (!currentTab || !currentTab.url) return renderUnsupported('没有活动标签页');

  let url;
  try { url = new URL(currentTab.url); } catch { return renderUnsupported('无法解析当前页面 URL'); }

  if (!/^https?:$/.test(url.protocol)) {
    return renderUnsupported('仅支持 http/https 页面');
  }

  currentSite = getSiteKey(url.hostname);
  document.getElementById('site').textContent = currentSite;

  const origins = originsForSite(currentSite);
  const granted = await chrome.permissions.contains({ origins });
  if (!granted) return renderGrant(origins);

  await refresh();
}

function originsForSite(site) {
  return [`*://*.${site}/*`, `*://${site}/*`];
}

function renderUnsupported(msg) {
  document.getElementById('content').innerHTML = `<div class="hint">${msg}</div>`;
}

function renderGrant(origins) {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="grant">
      <p>需要授予 <b>${currentSite}</b> 的访问权限才能管理 cookie。</p>
      <button class="primary" id="btn-grant">授予权限</button>
    </div>
  `;
  document.getElementById('btn-grant').onclick = async () => {
    const ok = await chrome.permissions.request({ origins });
    if (ok) await refresh();
  };
}

async function refresh() {
  const res = await send({ type: 'listSite', site: currentSite });
  if (!res?.ok) return renderUnsupported(res?.error || '读取失败');
  siteState = res.data;
  render();
}

function render() {
  const c = document.getElementById('content');
  c.innerHTML = '';

  if (!siteState.identities.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '尚未为此站点创建任何身份。';
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
  bNew.textContent = '+ 新建身份';
  bNew.onclick = () => openDialog({});
  actions.appendChild(bNew);
  c.appendChild(actions);
}

function renderIdentity(idn) {
  const tpl = document.getElementById('tpl-identity');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.dot').style.background = idn.color || '#888';
  node.querySelector('.name').textContent = idn.name || '(未命名)';
  const isActive = idn.id === siteState.activeId;
  if (isActive) {
    node.classList.add('active');
    node.querySelector('.active-badge').hidden = false;
  }

  node.querySelector('.btn-switch').onclick = () => doSwitch(idn.id);
  node.querySelector('.btn-edit').onclick   = () => openEdit(idn);
  node.querySelector('.btn-del').onclick    = () => doDelete(idn);
  return node;
}

// ---------- dialogs ----------
function openDialog({ editing }) {
  const c = document.getElementById('content');
  // remove existing dialog if any
  c.querySelector('.dialog')?.remove();

  const defaultName = editing
    ? editing.name
    : (siteState.suggestedName || `身份 ${siteState.identities.length + 1}`);
  const defaultColor = editing
    ? editing.color
    : PALETTE[siteState.identities.length % PALETTE.length];

  const d = document.createElement('div');
  d.className = 'dialog';
  d.innerHTML = `
    <label>名称</label>
    <input type="text" id="d-name" maxlength="40" value="${escapeHtml(defaultName)}">
    <label>颜色</label>
    <div class="swatches" id="d-swatches"></div>
    ${editing ? '' : `<div class="hint" style="padding:6px 0">当前登录状态将自动保留，随后页面会清空 cookie 并重载以便登录新账号。</div>`}
    <div class="error" id="d-err" hidden></div>
    <div class="dialog-actions">
      <button id="d-cancel">取消</button>
      <button class="primary" id="d-ok">${editing ? '保存' : '创建'}</button>
    </div>
  `;
  c.appendChild(d);

  // swatches
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
      err.textContent = '名称不能为空';
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
      err.textContent = res?.error || '创建失败';
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

function openEdit(idn) {
  openDialog({ editing: idn });
}

async function doSwitch(toId) {
  if (toId === siteState.activeId) return;
  const res = await send({ type: 'switchIdentity', site: currentSite, toId });
  if (!res?.ok) return showToast(res?.error || '切换失败');
  await chrome.tabs.reload(currentTab.id);
  window.close();
}

async function doDelete(idn) {
  const isActive = idn.id === siteState.activeId;
  const warn = isActive
    ? `删除当前激活身份 "${idn.name}"？该站 cookie 会被清空。`
    : `删除身份 "${idn.name}"？`;
  const ok = await inlineConfirm(warn);
  if (!ok) return;
  const res = await send({ type: 'deleteIdentity', site: currentSite, id: idn.id });
  if (!res?.ok) return showToast(res?.error || '删除失败');
  if (res.data?.wasActive) {
    await chrome.tabs.reload(currentTab.id);
    window.close();
    return;
  }
  await refresh();
}

function inlineConfirm(message) {
  return new Promise(resolve => {
    const c = document.getElementById('content');
    c.querySelector('.dialog')?.remove();
    const d = document.createElement('div');
    d.className = 'dialog';
    d.innerHTML = `
      <div style="font-size:13px">${escapeHtml(message)}</div>
      <div class="dialog-actions">
        <button id="c-no">取消</button>
        <button class="primary danger" id="c-yes" style="background:var(--danger);border-color:var(--danger)">确认</button>
      </div>
    `;
    c.appendChild(d);
    d.querySelector('#c-no').onclick = () => { d.remove(); resolve(false); };
    d.querySelector('#c-yes').onclick = () => { d.remove(); resolve(true); };
  });
}

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

document.getElementById('btn-settings').onclick = () => chrome.runtime.openOptionsPage();
init();
