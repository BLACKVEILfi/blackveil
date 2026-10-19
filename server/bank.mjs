// Reads every BlackveilBank event from the chain and keeps a small derived state for the site.
// Nothing here is invented: each row is a log with its block and transaction hash.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { Interface, getAddress, formatUnits, decodeBytes32String } from 'ethers';
import { rpc, isLocal } from './rpc.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const ABI = JSON.parse(readFileSync(ROOT + 'public/abi/BlackveilBank.json', 'utf8'));
export const iface = new Interface(ABI);

export function loadConfig() {
  const box = { window: {} };
  vm.runInNewContext(readFileSync(ROOT + 'public/config.js', 'utf8'), box);
  const c = box.window.BLACKVEIL_CONFIG;
  if (process.env.BANK) c.bank = process.env.BANK;
  if (process.env.DEPLOY_BLOCK) c.deployBlock = Number(process.env.DEPLOY_BLOCK);
  return c;
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[bank]', ...a);
const U = v => Number(formatUnits(v, 6));
const ROUTE = ['Settles', 'Queues', 'Refuses'];
const REASON = ['None', 'Paused', 'Revoked', 'ZeroAmount', 'NotAllowlisted', 'OverPerPayment', 'OverDaily', 'InsufficientVault'];
const KIND = ['direct', 'request', 'agent', 'approved'];

function ref32(b) {
  if (!b || /^0x0+$/.test(b)) return '';
  try { return decodeBytes32String(b); } catch { return b.slice(0, 18) + '…'; }
}

// ───────── index file ─────────

let cfg = loadConfig();
let file = null;
let idx = { bank: null, lastBlock: 0, events: [] };
const tsCache = new Map();

function open() {
  cfg = loadConfig();
  if (!cfg.bank) return false;
  const bank = getAddress(cfg.bank);
  if (idx.bank === bank) return true;
  mkdirSync(ROOT + 'data', { recursive: true });
  file = ROOT + `data/index-${isLocal() ? 'local-' : ''}${bank.slice(2, 10).toLowerCase()}.json`;
  idx = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { bank, lastBlock: (cfg.deployBlock || 1) - 1, events: [] };
  idx.bank = bank;
  rebuild();
  return true;
}

function save() { if (file) writeFileSync(file, JSON.stringify(idx)); }

function decode(l) {
  let p;
  try { p = iface.parseLog({ topics: l.topics, data: l.data }); } catch { return null; }
  if (!p) return null;
  const a = {};
  p.fragment.inputs.forEach((inp, i) => {
    const v = p.args[i];
    a[inp.name] = typeof v === 'bigint' ? v.toString() : v;
  });
  return { name: p.name, block: parseInt(l.blockNumber, 16), tx: l.transactionHash, li: parseInt(l.logIndex, 16), args: a };
}

async function tsOf(block) {
  if (tsCache.has(block)) return tsCache.get(block);
  const t = await rpc.blockTs(block).catch(() => 0);
  tsCache.set(block, t);
  return t;
}

let busy = false;
export async function sync() {
  if (busy || !open()) return;
  busy = true;
  try {
    const head = await rpc.blockNumber();
    let from = idx.lastBlock + 1;
    let step = isLocal() ? 100_000 : 200_000;
    let added = 0;
    while (from <= head) {
      const to = Math.min(head, from + step - 1);
      let logs;
      try { logs = await rpc.getLogs({ address: idx.bank, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }); }
      catch (e) { if (step > 5_000) { step = Math.floor(step / 4); continue; } throw e; }
      for (const l of logs) {
        const e = decode(l);
        if (!e) continue;
        e.ts = await tsOf(e.block);
        idx.events.push(e);
        added++;
      }
      idx.lastBlock = to;
      from = to + 1;
    }
    if (added) { idx.events.sort((x, y) => x.block - y.block || x.li - y.li); rebuild(); log(`+${added} events, head ${head}`); }
    save();
  } finally { busy = false; }
}

// ───────── derived state ─────────

let state = emptyState();
function emptyState() {
  return {
    accounts: new Map(), handles: new Map(), agents: new Map(), requests: new Map(), pending: new Map(),
    totals: { deposits: 0, depositUsd: 0, withdrawals: 0, withdrawUsd: 0, payments: 0, paymentUsd: 0, fees: 0,
      agentSettled: 0, agentUsd: 0, queued: 0, approved: 0, rejected: 0, refused: 0, requests: 0, requestsPaid: 0, handles: 0 },
    activity: [],
  };
}

function acct(s, addr) {
  const k = getAddress(addr);
  let a = s.accounts.get(k);
  if (!a) { a = { address: k, handle: '', first: null }; s.accounts.set(k, a); }
  return a;
}

function rebuild() {
  const s = emptyState();
  const t = s.totals;
  for (const e of idx.events) {
    const a = e.args;
    const row = { name: e.name, block: e.block, tx: e.tx, ts: e.ts };
    switch (e.name) {
      case 'Deposited': t.deposits++; t.depositUsd += U(a.amount); acct(s, a.account).first ??= e.ts;
        Object.assign(row, { who: a.account, amount: U(a.amount) }); break;
      case 'Withdrawn': t.withdrawals++; t.withdrawUsd += U(a.amount); Object.assign(row, { who: a.account, to: a.to, amount: U(a.amount) }); break;
      case 'Payment': {
        const kind = KIND[Number(a.kind)] || 'direct';
        t.payments++; t.paymentUsd += U(a.amount); t.fees += U(a.fee);
        if (kind === 'agent') { t.agentSettled++; t.agentUsd += U(a.amount); }
        if (kind === 'request') { t.requestsPaid++; const r = s.requests.get(Number(a.refId)); if (r) r.state = 'paid'; }
        acct(s, a.from).first ??= e.ts;
        Object.assign(row, { who: a.from, to: a.to, amount: U(a.amount), fee: U(a.fee), kind, refId: Number(a.refId), ref: ref32(a.ref), toWallet: a.toWallet });
        break;
      }
      case 'HandleSet': {
        const ac = acct(s, a.account);
        if (a.previous) s.handles.delete(a.previous);
        if (a.handle) s.handles.set(a.handle, ac.address);
        ac.handle = a.handle; ac.first ??= e.ts;
        Object.assign(row, { who: a.account, handle: a.handle, previous: a.previous }); break;
      }
      case 'AgentCreated': s.agents.set(Number(a.id), { id: Number(a.id), owner: getAddress(a.owner), signer: getAddress(a.signer), status: 'active', settled: 0, settledUsd: 0, refused: 0, queued: 0, created: e.ts });
        acct(s, a.owner).first ??= e.ts; Object.assign(row, { who: a.owner, agentId: Number(a.id), signer: a.signer }); break;
      case 'MandateSet': { const g = s.agents.get(Number(a.id)); if (g) Object.assign(g, { perPayment: U(a.perPayment), perDay: U(a.perDay), reviewAbove: U(a.reviewAbove), allowlistOnly: a.allowlistOnly });
        Object.assign(row, { agentId: Number(a.id), perPayment: U(a.perPayment), perDay: U(a.perDay), reviewAbove: U(a.reviewAbove), allowlistOnly: a.allowlistOnly }); break; }
      case 'AgentStatus': { const g = s.agents.get(Number(a.id)); if (g) g.status = ['', 'active', 'paused', 'revoked'][Number(a.status)];
        Object.assign(row, { agentId: Number(a.id), status: ['', 'active', 'paused', 'revoked'][Number(a.status)] }); break; }
      case 'SignerRotated': { const g = s.agents.get(Number(a.id)); if (g) g.signer = getAddress(a.signer); Object.assign(row, { agentId: Number(a.id), signer: a.signer }); break; }
      case 'AgentFunded': case 'AgentDefunded': Object.assign(row, { agentId: Number(a.id), amount: U(a.amount) }); break;
      case 'AllowSet': Object.assign(row, { agentId: Number(a.id), to: a.recipient, allowed: a.allowed }); break;
      case 'AgentRefused': { t.refused++; const g = s.agents.get(Number(a.id)); if (g) g.refused++;
        Object.assign(row, { agentId: Number(a.id), to: a.to, amount: U(a.amount), reason: REASON[Number(a.reason)] || String(a.reason), ref: ref32(a.ref) }); break; }
      case 'Queued': { t.queued++; const g = s.agents.get(Number(a.agentId)); if (g) g.queued++;
        s.pending.set(Number(a.pendingId), { id: Number(a.pendingId), agentId: Number(a.agentId), to: a.to, amount: U(a.amount), state: 'open', ts: e.ts, tx: e.tx });
        Object.assign(row, { pendingId: Number(a.pendingId), agentId: Number(a.agentId), to: a.to, amount: U(a.amount), ref: ref32(a.ref) }); break; }
      case 'Approved': { t.approved++; const p = s.pending.get(Number(a.pendingId)); if (p) p.state = 'approved'; Object.assign(row, { pendingId: Number(a.pendingId) }); break; }
      case 'Rejected': { t.rejected++; const p = s.pending.get(Number(a.pendingId)); if (p) p.state = 'rejected'; Object.assign(row, { pendingId: Number(a.pendingId) }); break; }
      case 'RequestCreated': t.requests++; s.requests.set(Number(a.id), { id: Number(a.id), payee: getAddress(a.payee), amount: U(a.amount), expiry: Number(a.expiry), memo: ref32(a.memo), state: 'open', ts: e.ts, tx: e.tx });
        Object.assign(row, { who: a.payee, requestId: Number(a.id), amount: U(a.amount), memo: ref32(a.memo) }); break;
      case 'RequestCancelled': { const r = s.requests.get(Number(a.id)); if (r) r.state = 'cancelled'; Object.assign(row, { requestId: Number(a.id) }); break; }
      default: Object.assign(row, { args: a });
    }
    if (row.name === 'Payment' && row.kind === 'agent') {
      const g = s.agents.get(row.refId); if (g) { g.settled++; g.settledUsd += row.amount; }
    }
    s.activity.push(row);
  }
  t.handles = s.handles.size;
  s.activity.reverse();
  state = s;
}

// ───────── views for the API ─────────

const handleOf = addr => { try { return state.accounts.get(getAddress(addr))?.handle || ''; } catch { return ''; } };
const named = row => {
  const out = { ...row };
  for (const k of ['who', 'to']) if (out[k]) { out[k] = getAddress(out[k]); const h = handleOf(out[k]); if (h) out[k + 'Handle'] = h; }
  return out;
};

export function ready() { return !!idx.bank; }
export function info() { return { bank: idx.bank, lastBlock: idx.lastBlock, events: idx.events.length, config: cfg }; }

export function stats() {
  const t = state.totals;
  const agents = [...state.agents.values()];
  return {
    bank: idx.bank, lastBlock: idx.lastBlock,
    accounts: state.accounts.size, handles: t.handles,
    agents: agents.length, agentsActive: agents.filter(a => a.status === 'active').length,
    deposits: t.deposits, depositUsd: t.depositUsd, withdrawals: t.withdrawals, withdrawUsd: t.withdrawUsd,
    payments: t.payments, paymentUsd: t.paymentUsd, fees: t.fees,
    agentSettled: t.agentSettled, agentUsd: t.agentUsd, queued: t.queued, approved: t.approved, rejected: t.rejected, refused: t.refused,
    requests: t.requests, requestsPaid: t.requestsPaid,
  };
}

export function activity({ limit = 50, account = null, agent = null, kinds = null } = {}) {
  let rows = state.activity;
  if (account) {
    let A; try { A = getAddress(account); } catch { return []; }
    const mine = new Set([...state.agents.values()].filter(g => g.owner === A).map(g => g.id));
    rows = rows.filter(r => r.who && getAddress(r.who) === A || r.to && safeEq(r.to, A) || (r.agentId && mine.has(r.agentId)) || (r.kind === 'agent' && mine.has(r.refId)));
  }
  if (agent) rows = rows.filter(r => r.agentId === Number(agent) || (r.kind === 'agent' && r.refId === Number(agent)));
  if (kinds) { const k = new Set(kinds); rows = rows.filter(r => k.has(r.name)); }
  return rows.slice(0, Math.min(500, limit)).map(named);
}
const safeEq = (a, b) => { try { return getAddress(a) === b; } catch { return false; } };

export function firstOf(name, pred = () => true) {
  for (const e of idx.events) if (e.name === name) { const r = state.activity.find(x => x.tx === e.tx && x.name === name); if (r && pred(r)) return named(r); }
  return null;
}

export function agentsOf(addr) {
  let A; try { A = getAddress(addr); } catch { return []; }
  return [...state.agents.values()].filter(g => g.owner === A);
}
export function pendingFor(addr) {
  const mine = new Set(agentsOf(addr).map(g => g.id));
  return [...state.pending.values()].filter(p => mine.has(p.agentId));
}
export function requestsOf(addr) {
  let A; try { A = getAddress(addr); } catch { return []; }
  return [...state.requests.values()].filter(r => r.payee === A);
}
export function requestById(id) { return state.requests.get(Number(id)) || null; }
export function resolveHandle(h) { return state.handles.get(String(h).toLowerCase()) || null; }
export function handles(q = '', limit = 20) {
  q = String(q).toLowerCase();
  return [...state.handles.entries()].filter(([h]) => !q || h.includes(q)).slice(0, limit).map(([handle, address]) => ({ handle, address }));
}
