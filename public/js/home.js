import { CFG, $, $$, api, chrome, int, usd, esc, short, copy, toast } from './common.js';
import { rowHtml } from './ledger.js';

chrome();

// ───────── hero film: the poster paints at once; the storm video loads after the page is up ─────────
function loadFilm() {
  const v = $('#hero-video');
  if (!v || navigator.connection?.saveData || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const small = innerWidth < 760;
  v.src = small ? '/media/hero-720.mp4' : '/media/hero-1080.mp4';
  v.addEventListener('playing', () => v.classList.add('on'), { once: true });
  v.play().catch(() => { });
  // pause the film when the hero is off screen
  new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => { }); else v.pause(); }).observe(v);
}
// ───────── the 3D coin: placed over the beam in the film, whatever the screen size ─────────
const FILM = { w: 1596, h: 882, x: 0.5, y: 0.645, d: 0.165 };   // coin centre and diameter, as fractions of the film
function placeCoin() {
  const host = $('#coin3d'), hero = $('.hero');
  if (!host || !hero) return;
  const W = hero.clientWidth, H = hero.clientHeight;
  const s = Math.max(W / FILM.w, H / FILM.h);                       // object-fit: cover
  const vw = FILM.w * s, vh = FILM.h * s;
  const ox = (W - vw) * 0.5, oy = (H - vh) * 0.45;                    // object-position: 50% 45%
  let cx = ox + FILM.x * vw, cy = oy + FILM.y * vh, d = FILM.d * vw;
  if (W < 760) { cx = W / 2; d = Math.min(W * 0.36, 200); cy = Math.max(150 + d * 0.66, H * 0.3); }   // phones: in the open space above the headline
  const hw = d * 2.0, hh = d * 1.32;
  Object.assign(host.style, { left: cx - hw / 2 + 'px', top: cy - hh / 2 + 'px', width: hw + 'px', height: hh + 'px' });
}
placeCoin();
addEventListener('resize', placeCoin);
function loadCoin() {
  if (!document.createElement('canvas').getContext('webgl2')) return;
  import('./coin3d.js').then(m => m.mountCoin($('#coin3d'))).catch(e => console.warn('coin', e));
}

function idle(fn) { ('requestIdleCallback' in window) ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 300); }
if (document.readyState === 'complete') { idle(loadFilm); idle(loadCoin); } else addEventListener('load', () => { idle(loadFilm); idle(loadCoin); }, { once: true });

const HANDLE = /^[a-z0-9]([a-z0-9-]{1,18})[a-z0-9]$/;

// ───────── live data ─────────
let deployed = false;
async function live() {
  let p = null, rows = [];
  try { p = await api('/api/proof'); } catch { }
  deployed = !!p?.deployed;
  if (deployed) { try { rows = await api('/api/activity?limit=4'); } catch { } }

  $('#frame-block').textContent = deployed ? `live · block ${int(p.stats.lastBlock)}` : 'bank contract deploys before launch';
  $('#hero-feed').innerHTML = !deployed
    ? '<div class="empty">The ledger opens when the bank contract deploys. Nothing here is a mock-up.</div>'
    : rows.length ? rows.slice(0, 4).map(r => rowHtml(r)).join('') : '<div class="empty">No events yet.</div>';

  const s = p?.stats;
  const cells = deployed ? [
    ['Accounts', int(s.accounts)], ['Handles', int(s.handles)], ['Agents under mandate', int(s.agents)],
    ['Payments settled', int(s.payments)], ['Refused by mandate', int(s.refused)], ['Waiting for review', int(Math.max(0, s.queued - s.approved - s.rejected))],
    ['USDG in the house', usd(p.heldUsd)], ['Fees, all time', usd(s.fees, 2) + ' USDG'], ['Bank contract', short(p.bank)],
  ] : [
    ['Bank contract', 'deploys before launch'], ['Settlement', 'USDG on Robinhood Chain'], ['Fee', '0.10 %, max 2 USDG'],
    ['Agent slots', '1 · 10 with the charter'], ['Owner powers', 'cannot move funds'], ['Encrypted balances', 'planned'],
  ];
  const html = cells.map(([k, v]) => `<div class="cell"><span class="m">${esc(k)}</span><b class="num">${esc(v)}</b></div>`).join('');
  $('#strip').innerHTML = html + html;

  if (deployed) {
    const hs = await api('/api/handles').catch(() => []);
    $('#hcount').textContent = `${int(s.handles)} claimed`;
    $('#handles').innerHTML = hs.length ? hs.slice(0, 4).map(h => `<div class="it"><div class="what"><b>${esc(h.handle)}</b><span class="dim">.veil</span><span class="sub">${esc(h.address)}</span></div><span></span><span></span></div>`).join('') : '<div class="empty">No handles yet.</div>';
  } else {
    $('#handles').innerHTML = '<div class="empty">Handles are claimed on the bank contract — it deploys before launch.</div>';
  }
}
live();
setInterval(() => { if (!document.hidden) live(); }, 15000);

// ───────── resolve(handle) lookup ─────────
let lTimer;
$('#lookup').addEventListener('input', e => {
  const h = e.target.value = e.target.value.trim().toLowerCase();
  clearTimeout(lTimer);
  $('#lk-h').textContent = h ? `${h}.veil` : '—';
  $('#lk-a').textContent = '—';
  if (!h) { $('#lk-s').textContent = 'type a handle'; $('#lk-s').className = 'mono dim'; return; }
  if (!HANDLE.test(h)) { $('#lk-s').textContent = 'not a valid handle'; $('#lk-s').className = 'mono route Refuses'; return; }
  lTimer = setTimeout(async () => {
    if (!deployed) { $('#lk-s').textContent = 'contract not deployed yet'; $('#lk-s').className = 'mono dim'; return; }
    const r = await fetch(`/api/handle/${h}`).catch(() => null);
    if (r?.ok) { const j = await r.json(); $('#lk-a').textContent = short(j.address); $('#lk-s').textContent = 'claimed'; $('#lk-s').className = 'mono route Settles'; }
    else { $('#lk-s').textContent = 'free to claim'; $('#lk-s').className = 'mono route Queues'; }
  }, 250);
});

// ───────── charter band ─────────
$('#band-ca').innerHTML = `<span class="k">CA</span><span class="v ${CFG.ca ? '' : 'pending'}">${CFG.ca ? esc(CFG.ca) : esc(CFG.caPlaceholder || 'ANNOUNCED AT LAUNCH')}</span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"/></svg>`;
$('#band-ca').addEventListener('click', () => CFG.ca ? copy(CFG.ca, 'Contract address copied') : toast('$BLVE is not launched yet — the CA appears here the moment it is.'));
if (CFG.ca) { $('#trade').href = CFG.pons + CFG.ca; $('#trade').target = '_blank'; }
else $('#trade').addEventListener('click', e => { e.preventDefault(); toast('$BLVE opens on Pons at launch.'); });

// ───────── mandate study: the same order of checks as routeFor() in BlackveilBank.sol ─────────
const M = {};
const FEE = a => Math.min(a * 0.001, 2);
function route() {
  const { per, day, review, spent, vault, amount } = M;
  const lines = [];
  const ok = t => lines.push(`<span class="y">✓ ${t}</span>`);
  const no = t => lines.push(`<span class="x">✗ ${t}</span>`);
  if (amount > per) { no(`amount ${amount} > per payment ${per}`); return ['Refuses', lines]; }
  ok(`per payment ${amount} ≤ ${per}`);
  if (vault < amount + FEE(amount)) { no(`vault ${vault} < amount + fee ${usd(amount + FEE(amount))}`); return ['Refuses', lines]; }
  ok('vault covers amount + fee');
  if (amount > review) { lines.push(`<span>→ above review line ${review}: waits for you</span>`); return ['Queues', lines]; }
  ok(`under review line ${review}`);
  if (spent + amount > day) { no(`today ${spent} + ${amount} > per 24h ${day}`); return ['Refuses', lines]; }
  ok(`today ${spent} + ${amount} ≤ ${day}`);
  return ['Settles', lines];
}
function paint() {
  for (const inp of $$('#sim input')) {
    M[inp.dataset.k] = Number(inp.value);
    inp.style.setProperty('--p', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%');
    $(`[data-o="${inp.dataset.k}"]`).textContent = `${inp.value} USDG`;
  }
  const [r, lines] = route();
  const v = $('#verdict');
  v.textContent = r; v.className = `verdict route ${r}`;
  $('#why').innerHTML = lines.join('');
  $('#meter').style.width = Math.min(100, (M.spent + (r === 'Settles' ? M.amount : 0)) / M.day * 100) + '%';
}
$$('#sim input').forEach(i => i.addEventListener('input', paint));
paint();
