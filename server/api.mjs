// JSON API. Every figure comes from the BlackveilBank event log (server/bank.mjs) or a live eth_call.
import { Interface, getAddress, formatUnits } from 'ethers';
import * as B from './bank.mjs';
import { rpc } from './rpc.mjs';
import { hit } from './ratelimit.mjs';

const ERC20 = new Interface(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)']);
const json = (res, code, body, maxAge = 5) =>
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, 'access-control-allow-origin': '*' })
    .end(JSON.stringify(body));

async function call(to, iface, fn, args = []) {
  const out = await rpc.ethCall(to, iface.encodeFunctionData(fn, args));
  return iface.decodeFunctionResult(fn, out);
}

// ───────── /api/proof: the facts behind every claim on the site ─────────

let proofCache = { at: 0, body: null };
let sourcify = { at: 0, status: null };

async function sourcifyStatus(addr) {
  if (Date.now() - sourcify.at < 10 * 60_000 && sourcify.addr === addr) return sourcify.status;
  let status = null;
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/4663/${addr}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { const j = await r.json(); status = j.match || j.runtimeMatch || 'match'; }
    else if (r.status === 404) status = 'not verified';
  } catch { status = null; }
  sourcify = { at: Date.now(), addr, status };
  return status;
}

async function proof() {
  if (Date.now() - proofCache.at < 20_000 && proofCache.body) return proofCache.body;
  const { bank, config } = B.info();
  if (!bank) return { deployed: false, config: publicCfg(config) };
  const I = B.iface;
  const [code, owner, feeRecipient, charterToken, charterMin, usdg, feeBps, feeCap, free, charterSlots, fees] = await Promise.all([
    rpc.code(bank),
    call(bank, I, 'owner'), call(bank, I, 'feeRecipient'), call(bank, I, 'charterToken'), call(bank, I, 'charterMin'),
    call(bank, I, 'usdg'), call(bank, I, 'FEE_BPS'), call(bank, I, 'FEE_CAP'), call(bank, I, 'FREE_AGENT_SLOTS'),
    call(bank, I, 'CHARTER_AGENT_SLOTS'), call(bank, I, 'feesAccrued'),
  ]);
  const [held] = await call(usdg[0], ERC20, 'balanceOf', [bank]);
  const s = B.stats();
  const ev = (name, pred) => B.firstOf(name, pred);
  const body = {
    deployed: code && code !== '0x',
    bank, codeBytes: code ? (code.length - 2) / 2 : 0,
    sourcify: await sourcifyStatus(bank),
    owner: owner[0], feeRecipient: feeRecipient[0], usdg: usdg[0],
    charterToken: charterToken[0] === '0x0000000000000000000000000000000000000000' ? null : charterToken[0],
    charterMin: charterMin[0].toString(),
    feeBps: Number(feeBps[0]), feeCapUsd: Number(formatUnits(feeCap[0], 6)),
    freeSlots: Number(free[0]), charterSlots: Number(charterSlots[0]),
    heldUsd: Number(formatUnits(held, 6)), feesAccruedUsd: Number(formatUnits(fees[0], 6)),
    stats: s,
    evidence: {
      handle: ev('HandleSet', r => !!r.handle),
      deposit: ev('Deposited'),
      payment: ev('Payment', r => r.kind === 'direct'),
      request: ev('RequestCreated'),
      requestPaid: ev('Payment', r => r.kind === 'request'),
      agentCreated: ev('AgentCreated'),
      agentSettled: ev('Payment', r => r.kind === 'agent'),
      queued: ev('Queued'),
      approved: ev('Approved'),
      rejected: ev('Rejected'),
      refused: ev('AgentRefused'),
      rotated: ev('SignerRotated'),
      revoked: ev('AgentStatus', r => r.status === 'revoked'),
      withdrawal: ev('Withdrawn'),
    },
    config: publicCfg(config),
    at: Date.now(),
  };
  proofCache = { at: Date.now(), body };
  return body;
}
const publicCfg = c => c && ({ bank: c.bank, deployBlock: c.deployBlock, deployTx: c.deployTx, ca: c.ca, usdg: c.usdg, explorer: c.explorer });

// ───────── router ─────────

export default async function api(req, res, url) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (!hit(ip)) return json(res, 429, { error: 'slow down' }, 0);
  const p = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;

  if (p === '/api/health') return json(res, 200, { ok: true, ...(() => { const i = B.info(); return { bank: i.bank, lastBlock: i.lastBlock, events: i.events }; })() }, 0);
  if (p === '/api/stats') return json(res, 200, B.ready() ? B.stats() : { deployed: false });
  if (p === '/api/activity') {
    return json(res, 200, B.activity({ limit: Number(q.get('limit') || 50), account: q.get('account'), agent: q.get('agent') }));
  }
  if (p === '/api/proof') return json(res, 200, await proof(), 10);

  let m;
  if ((m = p.match(/^\/api\/account\/(0x[0-9a-fA-F]{40})$/))) {
    const a = getAddress(m[1]);
    return json(res, 200, {
      address: a,
      agents: B.agentsOf(a), pending: B.pendingFor(a), requests: B.requestsOf(a),
      activity: B.activity({ account: a, limit: Number(q.get('limit') || 60) }),
    }, 2);
  }
  if ((m = p.match(/^\/api\/request\/(\d+)$/))) {
    const r = B.requestById(m[1]);
    return r ? json(res, 200, r, 2) : json(res, 404, { error: 'unknown request' }, 2);
  }
  if ((m = p.match(/^\/api\/handle\/([a-z0-9-]{3,20})$/))) {
    const a = B.resolveHandle(m[1]);
    return a ? json(res, 200, { handle: m[1], address: a }) : json(res, 404, { error: 'unknown handle' });
  }
  if (p === '/api/handles') return json(res, 200, B.handles(q.get('q') || '', 20));

  return json(res, 404, { error: 'not found' }, 0);
}
