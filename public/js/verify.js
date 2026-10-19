import { CFG, $, api, chrome, esc, usd, int, short, txUrl, addrUrl, ago } from './common.js';
chrome();

const link = (a, label) => a ? `<a class="brass" href="${addrUrl(a)}" target="_blank" rel="noopener">${esc(label || a)}</a>` : '<span class="dim">—</span>';
const evid = e => e ? `<a class="tx" href="${txUrl(e.tx)}" target="_blank" rel="noopener">${esc(e.tx.slice(0, 10))}…</a> <span class="dim" style="font-size:12px">${ago(e.ts)}</span>` : '<span class="dim">no transaction yet</span>';

const CLAIMS = [
  ['Handles — claim, change, resolve', 'handle', 'setHandle'],
  ['USDG deposits', 'deposit', 'deposit'],
  ['Payments to a handle or address, fee on the payer', 'payment', 'payHandle · pay'],
  ['Requests to pay — created', 'request', 'createRequest'],
  ['Requests to pay — settled', 'requestPaid', 'payRequest'],
  ['Agent vaults with a mandate', 'agentCreated', 'createAgent'],
  ['Agent payments settled inside the mandate', 'agentSettled', 'agentPay → Settles'],
  ['Payments above the review line wait for the owner', 'queued', 'agentPay → Queues'],
  ['Owner approves a queued payment', 'approved', 'approve'],
  ['Owner rejects a queued payment', 'rejected', 'reject'],
  ['Payments outside the mandate are refused and logged', 'refused', 'agentPay → Refuses'],
  ['Rotate an agent key', 'rotated', 'rotateSigner'],
  ['Revoke an agent, vault returns', 'revoked', 'revokeAgent'],
  ['Withdraw any time', 'withdrawal', 'withdraw'],
];

async function load() {
  let p;
  try { p = await api('/api/proof'); } catch { $('#facts').innerHTML = '<div><div class="k">Status</div><div class="v">API unreachable — try again shortly.</div></div>'; return; }
  if (!p.deployed) {
    $('#v-at').textContent = 'not deployed yet';
    $('#facts').innerHTML = `<div><div class="k">Bank contract</div><div class="v">Deploys before launch</div></div>
      <div><div class="k">Settlement token</div><div class="v">${link(CFG.usdg, 'USDG ' + short(CFG.usdg))}</div></div>
      <div><div class="k">Chain</div><div class="v">Robinhood Chain · 4663</div></div>`;
    $('#claims').innerHTML = `<thead><tr><th>Claim</th><th>Function</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${CLAIMS.map(([c, , f]) =>
      `<tr><td>${c}</td><td class="mono dim">${f}</td><td><span class="chip off">Awaiting deploy</span></td><td class="dim">—</td></tr>`).join('')}
      <tr><td>Encrypted balances</td><td class="mono dim">—</td><td><span class="chip plan">Planned</span></td><td class="dim">not built</td></tr></tbody>`;
    howto(null);
    return;
  }
  $('#v-at').textContent = `block ${int(p.stats.lastBlock)} · read ${new Date(p.at).toLocaleTimeString()}`;
  const src = p.sourcify;
  $('#v-src').innerHTML = src && src !== 'not verified'
    ? `<a class="brass" href="${CFG.sourcify}${p.bank}/" target="_blank" rel="noopener">Sourcify: ${esc(src)}</a> · <a class="brass" href="${CFG.explorer}/address/${p.bank}?tab=contract" target="_blank" rel="noopener">Blockscout: verified</a>`
    : `<span>Sourcify: ${esc(src || 'checking…')}</span>`;
  $('#facts').innerHTML = [
    ['Bank contract', link(p.bank)],
    ['Bytecode on chain', `${int(p.codeBytes)} bytes`],
    ['Deployed', CFG.deployTx ? `<a class="brass" href="${txUrl(CFG.deployTx)}" target="_blank" rel="noopener">block ${int(CFG.deployBlock)}</a>` : (CFG.deployBlock ? 'block ' + int(CFG.deployBlock) : '—')],
    ['Settlement token', link(p.usdg, 'USDG ' + short(p.usdg))],
    ['USDG held by the contract', `${usd(p.heldUsd)} USDG`],
    ['Fees accrued, not yet swept', `${usd(p.feesAccruedUsd, 4)} USDG`],
    ['Fee', `${(p.feeBps / 100).toFixed(2)} % · max ${usd(p.feeCapUsd, 0)} USDG (constants)`],
    ['Agent slots', `${p.freeSlots} without charter · ${p.charterSlots} with`],
    ['Charter token', p.charterToken ? link(p.charterToken) : '<span class="dim">set once at launch</span>'],
    ['Owner', link(p.owner, short(p.owner))],
    ['Fee recipient', link(p.feeRecipient, short(p.feeRecipient))],
    ['Event log', `${int(p.stats.payments)} payments · ${int(p.stats.refused)} refusals · ${int(p.stats.accounts)} accounts`],
  ].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  $('#claims').innerHTML = `<thead><tr><th>Claim</th><th>Function</th><th>Status</th><th>First transaction</th></tr></thead><tbody>${CLAIMS.map(([c, k, f]) => {
    const e = p.evidence[k];
    return `<tr><td>${c}</td><td class="mono dim">${f}</td><td>${e ? '<span class="chip live">Live · shown</span>' : '<span class="chip live">Live · not used yet</span>'}</td><td class="ev">${evid(e)}</td></tr>`;
  }).join('')}
    <tr><td>Charter slots and short handles</td><td class="mono dim">hasCharter</td><td>${p.charterToken ? '<span class="chip live">Live</span>' : '<span class="chip plan">Token at launch</span>'}</td><td class="ev">${p.charterToken ? link(p.charterToken, short(p.charterToken)) : '<span class="dim">—</span>'}</td></tr>
    <tr><td>Encrypted balances</td><td class="mono dim">—</td><td><span class="chip plan">Planned</span></td><td class="dim">not built</td></tr>
    <tr><td>Letters of disclosure</td><td class="mono dim">—</td><td><span class="chip plan">Planned</span></td><td class="dim">needs encrypted balances</td></tr></tbody>`;
  howto(p);
}

function howto(p) {
  const s = p?.stats;
  const rows = [
    ['Accounts', s && int(s.accounts), 'distinct addresses that deposited, paid, claimed a handle or opened an agent (Deposited, Payment.from, HandleSet, AgentCreated)'],
    ['Agents under mandate', s && int(s.agents), 'AgentCreated events (revoked agents included; active now: ' + (s ? int(s.agentsActive) : '—') + ')'],
    ['Payments settled', s && int(s.payments), 'Payment events of every kind: direct, request, agent, approved'],
    ['Refused by mandate', s && int(s.refused), 'AgentRefused events — attempts the contract refused without moving funds'],
    ['USDG in the house', p && usd(p.heldUsd), 'USDG.balanceOf(bank), read live — balances + vaults + queued reserves + unswept fees'],
    ['Volume', s && usd(s.paymentUsd), 'sum of Payment.amount'],
  ];
  $('#howto').innerHTML = `<thead><tr><th>Number</th><th class="num">Now</th><th>Counted from</th></tr></thead><tbody>${rows.map(([a, b, c]) =>
    `<tr><td>${a}</td><td class="num">${b ?? '—'}</td><td class="dim">${c}</td></tr>`).join('')}</tbody>`;
}

load();
setInterval(() => { if (!document.hidden) load(); }, 30000);
