# Identity Switcher

A minimal Chromium (MV3) extension for per-site multi-account switching. Save
multiple cookie-based login states for the same site and switch between them
with one click.

## Design

- **Site key** = eTLD+1 (heuristic, with a small compound-TLD whitelist).
- **Identity** = a named, colored snapshot of all cookies belonging to that site.
- **Switch** = save current browser cookies into the old identity's jar, clear
  browser cookies for that site, write the target identity's jar into the
  browser, then reload the tab.
- Only cookies are managed. `localStorage` / `IndexedDB` / cache are not
  touched. Works great for sites whose login state lives in (usually HttpOnly)
  cookies: GitHub, Google, most forums, Twitter/X, Taobao/JD, etc.
- Not a true isolation / parallel container. Two tabs of the same site still
  share the same cookie store. Use separate windows with sequential switching.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this directory.
4. Pin the extension icon for convenience.

## Usage

1. Open the target site (e.g. `https://github.com`).
2. Click the extension icon. On first use per site, click **授予权限** to grant
   host permission for that domain.
3. Click **+ 新建身份**. Current login state (if any) is automatically
   preserved — on first use it becomes an auto-named identity (e.g. `身份 1`);
   thereafter it is saved back into the currently active identity's jar.
   Then the browser's cookies for this site are cleared and the tab is
   reloaded so you can log in with a different account.
4. Switch between identities at any time via the popup.

## Notes / limitations

- Cookie-only. If the site stores auth tokens in `localStorage` (some SPAs),
  switching won't help.
- Single cookie store: having two tabs on the same site simultaneously will
  cause one of them to be in an inconsistent state after a switch. Either
  close other tabs first, or reload them.
- Session-only cookies are preserved across switches (stored in
  `chrome.storage.local`), so identities don't silently expire on restart.
- `__Host-` / `__Secure-` prefixed cookies may occasionally fail to restore
  if original attributes are unusual; check the service worker console.
- No sync: identities live in local storage only.

## File layout

- `manifest.json` — MV3 manifest
- `background.js` — service worker, owns the cookie jars and all state
- `popup.html` / `popup.css` / `popup.js` — UI

## Permissions

- `cookies`, `storage`, `tabs`, `activeTab` — declared at install time.
- Host permissions — requested **per site** on first use. Nothing is requested
  up front.
