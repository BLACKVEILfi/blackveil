import { glitter } from './logo-glitter.js';
// Shared chrome for every page: header (brand, full CA, nav, X, Open account), footer, toasts, formatting.
export const CFG = window.BLACKVEIL_CONFIG || {};

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON = {
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M12.2 1.5h2.2L9.6 7l5.6 7.5h-4.4L7.4 10l-4 4.5H1.2l5.2-5.9L1 1.5h4.5l3.1 4.1 3.6-4.1Zm-.8 11.7h1.2L4.9 2.7H3.6l7.8 10.5Z"/></svg>',
  tg: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.6 2.3 1.9 7.2c-.9.3-.8 1.6.1 1.8l3.1.9 1.2 3.8c.2.7 1.1.9 1.6.4l1.8-1.7 3.3 2.4c.6.4 1.4.1 1.6-.6l2-10.6c.2-.9-.7-1.6-1.6-1.3ZM6.4 9.4l6-5.2-4.7 6.1-.3 2.2-1-3.1Z"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  ext: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3H3.5A1 1 0 0 0 2.5 4v8.5a1 1 0 0 0 1 1H12a1 1 0 0 0 1-1V10M9 2.5h4.5V7M13.5 2.5 7 9"/></svg>',
  menu: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 5h12M2 11h12"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3.5 3.5 9 9m0-9-9 9"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 8.5 3 3 7-7"/></svg>',
  // brand mark: a keyhole behind two veils (placeholder until the owner's logo is in)
  mark: '<svg class="mark" viewBox="0 0 24 24" fill="none"><rect x="1" y="1" width="22" height="22" rx="5" fill="#141413" stroke="#2d2b29"/><path d="M6 5.5h12v4.2c0 4.6-2.6 7.6-6 8.8-3.4-1.2-6-4.2-6-8.8V5.5Z" fill="url(#bvg)"/><circle cx="12" cy="10.2" r="1.7" fill="#090909"/><path d="M11.2 11.2h1.6l.5 3.4h-2.6l.5-3.4Z" fill="#090909"/><defs><linearGradient id="bvg" x1="6" y1="5" x2="18" y2="19"><stop stop-color="#e2c891"/><stop offset="1" stop-color="#9c7f47"/></linearGradient></defs></svg>',
};

// ───────── formatting ─────────
export const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
export const usd = (n, d = 2) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const int = n => (n ?? 0).toLocaleString('en-US');
export const ago = ts => {
  if (!ts) return '';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
export const txUrl = h => `${CFG.explorer}/tx/${h}`;
export const addrUrl = a => `${CFG.explorer}/address/${a}`;
export const who = (addr, handle) => handle ? `<b>${esc(handle)}</b><span class="dim">.veil</span>` : `<span class="mono">${esc(short(addr))}</span>`;

export async function api(path) {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// ───────── toasts ─────────
export function toast(html, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = html;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 9000 : 5200);
}

export async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(`${label}`, 'ok'); }
  catch { toast('Copy failed — select and copy by hand', 'err'); }
}

// ───────── chrome ─────────
const NAV = [['/#account', 'Account'], ['/#mandates', 'Mandates'], ['/#charter', 'Charter'], ['/agents', 'Agents'], ['/verify', 'Verify'], ['/app', 'Bank']];

function caInner(cls) {
  const ca = CFG.ca;
  return `<span class="k">CA</span><span class="v ${ca ? '' : 'pending'}">${ca ? esc(ca) : esc(CFG.caPlaceholder || 'ANNOUNCED AT LAUNCH')}</span>${ICON.copy}`;
}

function social(kind) {
  const url = CFG[kind];
  const label = kind === 'x' ? 'X' : 'Telegram';
  return url
    ? `<a class="icon-btn" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${label}">${ICON[kind === 'x' ? 'x' : 'tg']}</a>`
    : `<button class="icon-btn" data-soon="${label}" aria-label="${label}">${ICON[kind === 'x' ? 'x' : 'tg']}</button>`;
}

export function chrome() {
  const here = location.pathname.replace(/\/+$/, '') || '/';
  const hdr = document.createElement('header');
  hdr.className = 'hdr';
  hdr.innerHTML = `<div class="in">
    <a class="brand" href="/" aria-label="BLACK VEIL home"><img class="mark" src="/img/logo-mark.png" alt="" width="34" height="33"><img class="lockup" src="/img/logo-lockup.png" alt="" width="108" height="120"><span>BLACK VEIL</span></a>
    <div class="ca" role="button" tabindex="0" title="Copy contract address">${caInner()}</div>
    <nav class="nav">${NAV.map(([h, l]) => `<a href="${h}" class="${h === here ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="right">${social('x')}<a class="btn solid sm" href="/app">Open account</a><button class="icon-btn menu-btn" aria-label="Menu">${ICON.menu}</button></div></div>`;
  const strip = document.createElement('div');
  strip.className = 'ca-strip';
  strip.innerHTML = caInner();
  document.body.prepend(strip);
  document.body.prepend(hdr);
  for (const im of hdr.querySelectorAll('.brand img')) if (getComputedStyle(im).display !== 'none') glitter(im, { cell: 2, still: true });

  for (const el of [$('.ca', hdr), strip]) {
    const go = () => CFG.ca ? copy(CFG.ca, 'Contract address copied') : toast('$BLVE is not launched yet — the CA appears here the moment it is.');
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-soon]');
    if (b) toast(`${esc(b.dataset.soon)} opens at launch.`);
  });
  let sheet = null;
  $('.menu-btn', hdr).addEventListener('click', () => {
    if (sheet) { sheet.remove(); sheet = null; $('.menu-btn', hdr).innerHTML = ICON.menu; return; }
    sheet = document.createElement('nav');
    sheet.className = 'sheet';
    sheet.innerHTML = NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('');
    document.body.append(sheet);
    $('.menu-btn', hdr).innerHTML = ICON.close;
  });

  const foot = document.createElement('footer');
  foot.className = 'foot';
  foot.innerHTML = `
    <div class="bar">
      <span>© ${new Date().getFullYear()} BLACKVEIL · Robinhood Chain 4663</span>
      <div class="ca" role="button" tabindex="0">${caInner()}</div>
      ${CFG.bank ? `<a href="${addrUrl(CFG.bank)}" target="_blank" rel="noopener">Bank contract <span class="mono">${esc(short(CFG.bank))}</span></a>` : '<span class="dim">Bank contract deploys before launch</span>'}
      <a href="/verify">Verify</a>
      <a href="/agents">Agents</a>
      <div class="links">${social('x')}${social('telegram')}</div>
    </div>
    <p class="fine">BLACKVEIL is software on a public blockchain, not a licensed bank. Accounts hold USDG in an immutable contract on Robinhood Chain; nobody, including the team, can move them for you. Amounts are public on chain today — encrypted balances are planned and marked as such on every page. $BLVE is a charter token that unlocks features; it pays no yield and is not an investment product.</p>`;
  document.body.append(foot);
  $('.ca', foot).addEventListener('click', () => CFG.ca ? copy(CFG.ca, 'Contract address copied') : toast('$BLVE is not launched yet — the CA appears here the moment it is.'));
}
