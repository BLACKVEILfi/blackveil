import { CFG, $, $$, api, chrome, esc, usd, short, copy, toast, addrUrl, ICON } from './common.js';
import { ethers, state, wallets, connect, disconnect, reconnect, onChange, bankR, usdgR, bankW, send, ensureAllowance, U, fromU, memo, read, ROUTE, REASON } from './wallet.js';
import { rowHtml } from './ledger.js';
import { renderPicker } from './walletpicker.js';

chrome();
const show = (id, on) => $(id).classList.toggle('hide', !on);
const fee = a => Math.min(a * 0.001, 2);
const amountOf = v => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
let me = { bal: 0n, wallet: 0n, eth: 0n, handle: '', charter: false, slots: 1, live: 0 };

// ───────── layout by state ─────────
function layout() {
  if (!CFG.bank) { show('#nobank', true); show('#connect', false); show('#bank', false); return; }
  show('#nobank', false);
  show('#connect', !state.address);
  show('#bank', !!state.address);
  if (!state.address) renderWallets();
  else refresh();
}

function renderWallets() {
  renderPicker($('#wallet-list'), eip => connect(eip).catch(e => toast(esc(e.message || e), 'err')));
}
// EIP-6963 wallets can announce a moment after load: redraw the picker once they have
setTimeout(() => { if (!state.address && CFG.bank) renderWallets(); }, 600);

// the ledger comes from the server's indexer, which trails the chain by a few seconds: after a write, refresh a few times
function refreshSoon() { refresh(); for (const ms of [2500, 5500, 9500]) setTimeout(refresh, ms); }

// ───────── account ─────────
async function refresh() {
  const a = state.address;
  if (!a) return;
  const [bal, wallet, eth, handle, charter, slots, live] = await Promise.all([
    bankR.balanceOf(a), usdgR.balanceOf(a), read.getBalance(a), bankR.handleOf(a), bankR.hasCharter(a), bankR.agentSlots(a), bankR.liveAgents(a),
  ]);
  me = { bal, wallet, eth, handle, charter, slots: Number(slots), live: Number(live) };
  $('#a-handle').innerHTML = handle ? `${esc(handle)}<em>.veil</em>` : '<span class="dim">No handle</span>';
  $('#a-addr').innerHTML = `<a href="${addrUrl(a)}" target="_blank" rel="noopener">${esc(a)}</a>`;
  $('#a-bal').innerHTML = `<img class="tok" src="/img/tokens/USDG.svg" alt="">${usd(fromU(bal))}<small>USDG</small>`;
  $('#a-wallet').innerHTML = `<img class="tok sm" src="/img/tokens/USDG.svg" alt="">${usd(fromU(wallet))} USDG`;
  $('#a-eth').innerHTML = `<img class="tok sm" src="/img/tokens/ETH.png" alt="">${Number(ethers.formatEther(eth)).toFixed(5)} ETH`;
  $('#a-charter').innerHTML = charter ? '<span class="chip live">Holder</span>' : '<span class="chip off">None</span>';
  $('#a-slots').textContent = `${me.live} / ${me.slots}`;
  $('#f-handle button').textContent = handle ? 'Change handle' : 'Claim handle';
  if (!$('#f-withdraw [name=to]').value) $('#f-withdraw [name=to]').value = a;
  await Promise.all([loadAccount(), agentsRender()]).catch(e => console.warn(e));
}

let acctData = { agents: [], pending: [], requests: [], activity: [] };
async function loadAccount() {
  try { acctData = await api(`/api/account/${state.address}`); } catch { return; }
  $('#act').innerHTML = acctData.activity.length ? acctData.activity.map(r => rowHtml(r)).join('') : '<div class="empty">Nothing yet.</div>';
  renderRequests();
  renderQueue();
}

// handle
$('#f-handle [name=handle]').addEventListener('input', async e => {
  const h = e.target.value.trim().toLowerCase();
  e.target.value = h;
  const hint = $('#h-hint');
  if (!h) { hint.textContent = ''; return; }
  if (!/^[a-z0-9]([a-z0-9-]{1,18})[a-z0-9]$/.test(h)) { hint.className = 'hint bad'; hint.textContent = '3–20 characters, a–z 0–9, inner hyphens'; return; }
  if (h.length <= 4 && !me.charter) { hint.className = 'hint bad'; hint.textContent = '3–4 letters need the charter'; return; }
  const owner = await bankR.resolve(h).catch(() => ethers.ZeroAddress);
  if (owner === ethers.ZeroAddress) { hint.className = 'hint ok'; hint.textContent = `${h}.veil is free`; }
  else if (owner === state.address) { hint.className = 'hint ok'; hint.textContent = 'already yours'; }
  else { hint.className = 'hint bad'; hint.textContent = `taken by ${short(owner)}`; }
});
$('#f-handle').addEventListener('submit', async e => {
  e.preventDefault();
  const h = e.target.handle.value.trim().toLowerCase();
  if (!h) return;
  if (await send(`Claim ${h}.veil`, () => bankW().setHandle(h))) { e.target.reset(); $('#h-hint').textContent = ''; refreshSoon(); }
});
$('#disconnect').onclick = () => disconnect();

// ───────── tabs ─────────
function tab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach(p => p.classList.toggle('hide', p.dataset.pane !== name));
  history.replaceState(null, '', '#' + name);
}
$$('.tabs button').forEach(b => b.onclick = () => tab(b.dataset.tab));
if (/^#(pay|funds|requests|agents|activity)$/.test(location.hash)) tab(location.hash.slice(1));

$$('.seg').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $$('button', seg).forEach(x => x.classList.toggle('on', x === b));
}));
const segVal = name => $(`.seg[data-name="${name}"] .on`).dataset.v;

// ───────── pay ─────────
async function resolveTo(raw) {
  raw = raw.trim().replace(/\.veil$/, '');
  if (ethers.isAddress(raw)) return { address: ethers.getAddress(raw), handle: null };
  if (/^[a-z0-9-]{3,20}$/.test(raw.toLowerCase())) {
    const a = await bankR.resolve(raw.toLowerCase());
    return a === ethers.ZeroAddress ? null : { address: a, handle: raw.toLowerCase() };
  }
  return null;
}
let toTimer;
$('#f-pay [name=to]').addEventListener('input', e => {
  clearTimeout(toTimer);
  toTimer = setTimeout(async () => {
    const hint = $('#to-hint');
    if (!e.target.value.trim()) { hint.textContent = ''; return; }
    const r = await resolveTo(e.target.value).catch(() => null);
    if (!r) { hint.className = 'hint bad'; hint.textContent = 'no account holds that handle'; return; }
    const h = r.handle || await bankR.handleOf(r.address).catch(() => '');
    hint.className = 'hint ok'; hint.textContent = h ? `${h}.veil → ${r.address}` : r.address;
  }, 250);
});
$('#f-pay [name=amount]').addEventListener('input', e => { $('#pay-fee').textContent = `${usd(fee(amountOf(e.target.value)), 4)} USDG`; });
$('#f-pay').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const r = await resolveTo(f.to.value).catch(() => null);
  if (!r) return toast('Enter a handle or a 0x address.', 'err');
  const amt = amountOf(f.amount.value);
  if (!amt) return toast('Enter an amount.', 'err');
  let ref; try { ref = memo(f.memo.value); } catch (er) { return toast(er.message, 'err'); }
  const fromWallet = segVal('from') === 'wallet', toWallet = segVal('deliver') === 'wallet';
  const v = U(amt);
  if (fromWallet && !(await ensureAllowance(v + U(fee(amt).toFixed(6))))) return;
  const label = `Pay ${usd(amt)} USDG to ${r.handle ? r.handle + '.veil' : short(r.address)}`;
  const ok = r.handle
    ? await send(label, () => bankW().payHandle(r.handle, v, ref, fromWallet, toWallet))
    : await send(label, () => bankW().pay(r.address, v, ref, fromWallet, toWallet));
  if (ok) { f.amount.value = ''; f.memo.value = ''; refreshSoon(); }
});

// ───────── deposit / withdraw ─────────
$$('[data-max]').forEach(b => b.onclick = () => {
  const v = b.dataset.max === 'wallet' ? me.wallet : me.bal;
  b.previousElementSibling.value = ethers.formatUnits(v, 6);
});
$('#f-deposit').addEventListener('submit', async e => {
  e.preventDefault();
  const amt = amountOf(e.target.amount.value);
  if (!amt) return toast('Enter an amount.', 'err');
  const v = U(amt);
  if (v > me.wallet) return toast('Your wallet holds less USDG than that.', 'err');
  if (!(await ensureAllowance(v))) return;
  if (await send(`Deposit ${usd(amt)} USDG`, () => bankW().deposit(v))) { e.target.amount.value = ''; refreshSoon(); }
});
$('#f-withdraw').addEventListener('submit', async e => {
  e.preventDefault();
  const amt = amountOf(e.target.amount.value);
  const to = e.target.to.value.trim();
  if (!amt) return toast('Enter an amount.', 'err');
  if (!ethers.isAddress(to)) return toast('Withdraw to a 0x address.', 'err');
  if (await send(`Withdraw ${usd(amt)} USDG`, () => bankW().withdraw(U(amt), to))) { e.target.amount.value = ''; refreshSoon(); }
});

// ───────── requests ─────────
const payLink = id => `${location.origin}/pay?r=${id}`;
function renderRequests() {
  const list = [...acctData.requests].sort((a, b) => b.id - a.id);
  $('#req-list').innerHTML = list.length ? list.map(r => {
    const expired = r.state === 'open' && r.expiry && r.expiry < Date.now() / 1000;
    const st = expired ? '<span class="chip off">Expired</span>' : { open: '<span class="chip plan">Open</span>', paid: '<span class="chip live">Paid</span>', cancelled: '<span class="chip off">Cancelled</span>' }[r.state];
    return `<div class="req"><div><b class="num">${usd(r.amount)} USDG</b> <span class="dim">· #${r.id}${r.memo ? ' · “' + esc(r.memo) + '”' : ''}</span></div>${st}
      <div class="acts">${r.state === 'open' && !expired ? `<button class="btn xs" data-copy="${r.id}">Copy link</button><button class="btn xs" data-cancel="${r.id}">Cancel</button>` : ''}</div></div>`;
  }).join('') : '<div class="empty">No requests yet.</div>';
  $$('[data-copy]').forEach(b => b.onclick = () => copy(payLink(b.dataset.copy), 'Payment link copied'));
  $$('[data-cancel]').forEach(b => b.onclick = async () => { if (await send(`Cancel request #${b.dataset.cancel}`, () => bankW().cancelRequest(b.dataset.cancel))) refreshSoon(); });
}
$('#f-request').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const amt = amountOf(f.amount.value);
  if (!amt) return toast('Enter an amount.', 'err');
  let m; try { m = memo(f.memo.value); } catch (er) { return toast(er.message, 'err'); }
  const secs = Number(f.expiry.value);
  const exp = secs ? Math.floor(Date.now() / 1000) + secs : 0;
  const rcpt = await send(`Request ${usd(amt)} USDG`, () => bankW().createRequest(U(amt), exp, m));
  if (!rcpt) return;
  const ev = rcpt.logs.map(l => { try { return bankR.interface.parseLog(l); } catch { return null; } }).find(x => x?.name === 'RequestCreated');
  if (ev) copy(payLink(ev.args.id.toString()), `Request #${ev.args.id} created — link copied`);
  f.reset();
  refreshSoon();
});

// ───────── agents ─────────
function renderQueue() {
  const open = acctData.pending.filter(p => p.state === 'open');
  const badge = $('#q-badge');
  badge.textContent = open.length; badge.classList.toggle('hide', !open.length);
  $('#queue').innerHTML = open.length ? open.map(p => `<div class="qrow">
      <div><b>Agent #${p.agentId}</b> wants to pay <span class="mono">${esc(short(p.to))}</span><div class="dim mono" style="font-size:11.5px">queued #${p.id}</div></div>
      <span class="num">${usd(p.amount)} USDG</span>
      <div class="acts"><button class="btn xs brass" data-approve="${p.id}">Approve</button><button class="btn xs" data-reject="${p.id}">Reject</button></div></div>`).join('')
    : '<div class="empty">Nothing waiting.</div>';
  $$('[data-approve]').forEach(b => b.onclick = async () => { if (await send(`Approve #${b.dataset.approve}`, () => bankW().approve(b.dataset.approve))) refreshSoon(); });
  $$('[data-reject]').forEach(b => b.onclick = async () => { if (await send(`Reject #${b.dataset.reject}`, () => bankW().reject(b.dataset.reject))) refreshSoon(); });
}

async function agentsRender() {
  const box = $('#agent-list');
  // never redraw under the user's hands: an open editor or a focused field keeps the cards as they are
  if (box.querySelector('.edit:not(.hide)') || box.contains(document.activeElement)) return;
  const ids = await bankR.agentsOf(state.address);
  if (!ids.length) { box.innerHTML = ''; return; }
  const agents = await Promise.all(ids.map(async id => ({ id: Number(id), a: await bankR.agent(id) })));
  box.innerHTML = agents.reverse().map(({ id, a }) => {
    const status = ['', 'active', 'paused', 'revoked'][Number(a.status)];
    const chip = { active: '<span class="chip live">Active</span>', paused: '<span class="chip plan">Paused</span>', revoked: '<span class="chip off">Revoked</span>' }[status];
    const live = status !== 'revoked';
    return `<div class="panel agent" data-id="${id}">
      <div class="ph"><span>Agent #${id}</span>${chip}<span class="r mono" title="${esc(a.signer)}">key ${esc(short(a.signer))}</span></div>
      <div class="stat">
        <div><div class="k">Vault</div><div class="v">${usd(fromU(a.vault))}</div></div>
        <div><div class="k">Spent · 24h</div><div class="v">${usd(fromU(a.spent))} <span class="dim" style="font-size:12px">/ ${usd(fromU(a.perDay), 0)}</span></div></div>
        <div><div class="k">Per payment</div><div class="v">${usd(fromU(a.perPayment), 0)}</div></div>
        <div><div class="k">Review above</div><div class="v">${usd(fromU(a.reviewAbove), 0)}</div></div>
      </div>
      ${live ? `<div class="acts">
        <button class="btn xs brass" data-act="fund">Fund vault</button>
        <button class="btn xs" data-act="defund">Return to balance</button>
        <button class="btn xs" data-act="mandate">Edit mandate</button>
        <button class="btn xs" data-act="allow">Allowlist${a.allowlistOnly ? ' (on)' : ''}</button>
        <button class="btn xs" data-act="gas">Send gas</button>
        <button class="btn xs" data-act="${status === 'paused' ? 'resume' : 'pause'}">${status === 'paused' ? 'Resume' : 'Pause'}</button>
        <button class="btn xs" data-act="rotate">Rotate key</button>
        <button class="btn xs" data-act="revoke">Revoke</button>
      </div><div class="edit hide"></div>` : '<div class="acts dim" style="font-size:13px">Revoked — vault returned, slot freed. History stays on chain.</div>'}
    </div>`;
  }).join('');
  for (const card of $$('.agent', box)) {
    const id = Number(card.dataset.id), a = agents.find(x => x.id === id).a;
    $$('[data-act]', card).forEach(b => b.onclick = () => agentAction(card, id, a, b.dataset.act));
  }
}

function editor(card, html, onSubmit) {
  const ed = $('.edit', card);
  ed.innerHTML = `<form class="form-grid">${html}<div style="display:flex;gap:8px"><button class="btn sm solid" type="submit">Confirm</button><button class="btn sm" type="button" data-x>Cancel</button></div></form>`;
  ed.classList.remove('hide');
  $('[data-x]', ed).onclick = () => ed.classList.add('hide');
  $('form', ed).onsubmit = async e => { e.preventDefault(); if (await onSubmit(e.target)) { ed.classList.add('hide'); refreshSoon(); } };
  $('input', ed)?.focus();
}

async function agentAction(card, id, a, act) {
  const B = bankW();
  if (act === 'pause') return send(`Pause agent #${id}`, () => B.pauseAgent(id, true)).then(r => r && refreshSoon());
  if (act === 'resume') return send(`Resume agent #${id}`, () => B.pauseAgent(id, false)).then(r => r && refreshSoon());
  if (act === 'revoke') { if (!confirm(`Revoke agent #${id}? Its vault returns to your balance and the key stops working for good.`)) return; return send(`Revoke agent #${id}`, () => B.revokeAgent(id)).then(r => r && refreshSoon()); }
  if (act === 'fund') return editor(card, `<label class="field"><span>Move from your bank balance (${usd(fromU(me.bal))} USDG)</span><input class="input num" name="v" inputmode="decimal"></label>`,
    f => { const v = amountOf(f.v.value); return v && send(`Fund agent #${id}`, () => B.fundAgent(id, U(v))); });
  if (act === 'defund') return editor(card, `<label class="field"><span>Return to your balance (vault ${usd(fromU(a.vault))} USDG)</span><input class="input num" name="v" inputmode="decimal" value="${ethers.formatUnits(a.vault, 6)}"></label>`,
    f => { const v = amountOf(f.v.value); return v && send(`Return from agent #${id}`, () => B.defundAgent(id, U(v))); });
  if (act === 'mandate') return editor(card, `<div class="three">
      <label class="field"><span>Per payment</span><input class="input num" name="per" value="${fromU(a.perPayment)}"></label>
      <label class="field"><span>Per 24 hours</span><input class="input num" name="day" value="${fromU(a.perDay)}"></label>
      <label class="field"><span>Review above</span><input class="input num" name="review" value="${fromU(a.reviewAbove)}"></label></div>
      <label class="check"><input type="checkbox" name="allow" ${a.allowlistOnly ? 'checked' : ''}> <span>Only pay allowlisted recipients</span></label>`,
    f => send(`Mandate for agent #${id}`, () => B.setMandate(id, U(Number(f.per.value) || 0), U(Number(f.day.value) || 0), U(Number(f.review.value) || 0), f.allow.checked)));
  if (act === 'allow') return editor(card, `<label class="field"><span>Recipient (handle or 0x)</span><input class="input mono" name="to"></label>
      <div class="seg" data-name="allow-op"><button type="button" data-v="1" class="on">Allow</button><button type="button" data-v="0">Remove</button></div>`,
    async f => { const r = await resolveTo(f.to.value).catch(() => null); if (!r) { toast('Unknown recipient.', 'err'); return null; } const on = $('.seg[data-name="allow-op"] .on', card).dataset.v === '1'; return send(`${on ? 'Allow' : 'Remove'} ${short(r.address)}`, () => B.setAllowed(id, r.address, on)); });
  if (act === 'rotate') return editor(card, `<label class="field"><span>New agent key (address)</span><input class="input mono" name="to" placeholder="0x…"></label>`,
    f => ethers.isAddress(f.to.value.trim()) ? send(`Rotate agent #${id}`, () => B.rotateSigner(id, f.to.value.trim())) : (toast('Enter an address.', 'err'), null));
  if (act === 'gas') return editor(card, `<label class="field"><span>ETH from your wallet to the agent key ${esc(short(a.signer))}</span><input class="input num" name="v" value="0.0005"></label>`,
    f => send('Send gas to agent', () => state.signer.sendTransaction({ to: a.signer, value: ethers.parseEther(String(Number(f.v.value) || 0)) })));
}

$('#gen-key').onclick = () => {
  const w = ethers.Wallet.createRandom();
  $('#f-agent [name=signer]').value = w.address;
  const box = $('#keybox');
  box.innerHTML = `<b>Agent key generated in this browser — save it now, it is shown once.</b>
    <div>Address <code>${w.address}</code></div><div>Private key <code>${w.privateKey}</code></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn xs" id="k-copy">Copy private key</button><button type="button" class="btn xs" id="k-dl">Download .json</button></div>
    <span class="dim" style="font-size:12px">Give this key to your agent only. It can spend from this agent's vault inside the mandate and nothing else; you can rotate or revoke it at any time.</span>`;
  box.classList.remove('hide');
  $('#k-copy').onclick = () => copy(w.privateKey, 'Private key copied');
  $('#k-dl').onclick = () => {
    const blob = new Blob([JSON.stringify({ address: w.address, privateKey: w.privateKey, bank: CFG.bank, chainId: CFG.chainId }, null, 2)], { type: 'application/json' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `blackveil-agent-${w.address.slice(2, 8)}.json` });
    link.click(); URL.revokeObjectURL(link.href);
  };
};
$('#f-agent').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const signer = f.signer.value.trim();
  if (!ethers.isAddress(signer)) return toast('Enter the agent key address, or generate one.', 'err');
  if (me.live >= me.slots) return toast(me.charter ? 'All ten charter slots are in use.' : 'One agent per account without the charter — revoke one or hold $BLVE.', 'err');
  const rcpt = await send('Open agent', () => bankW().createAgent(signer, U(Number(f.per.value) || 0), U(Number(f.day.value) || 0), U(Number(f.review.value) || 0), f.allow.checked));
  if (rcpt) { f.signer.value = ''; $('#keybox').classList.add('hide'); refreshSoon(); }
});

// ───────── boot ─────────
onChange(layout);
layout();
{ const qh = new URLSearchParams(location.search).get('handle'); if (qh) $('#f-handle [name=handle]').value = qh.toLowerCase().slice(0, 20); }
reconnect();
setInterval(() => { if (state.address && !document.hidden) refresh(); }, 8000);
