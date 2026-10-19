// JSON-RPC client for Robinhood Chain.
// Logs come from the official RPC (wide block ranges). Its hostname is DNS-blocked on some networks,
// so we connect to the Cloudflare IP with SNI + Host set by hand. Reads go to publicnode first.
// LOCAL_RPC=http://127.0.0.1:8545 sends everything to a local anvil fork instead.
import https from 'node:https';

export const CHAIN_ID = 4663;
const OFFICIAL = { host: 'rpc.mainnet.chain.robinhood.com', ip: process.env.RH_RPC_IP || '104.20.46.209' };
const PUBLIC = process.env.RPC_URL || 'https://robinhood-rpc.publicnode.com';
const LOCAL = process.env.LOCAL_RPC || '';

let nextSlot = 0;
const GAP_MS = Number(process.env.RPC_GAP_MS || 220);
async function pace() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

function postOfficial(body, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: OFFICIAL.ip, servername: OFFICIAL.host, port: 443, method: 'POST', path: '/',
      headers: { host: OFFICIAL.host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      timeout,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function postUrl(url, body, timeout = 30000) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(timeout) });
  return { status: r.status, text: await r.text() };
}

export class RpcError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

async function call(where, method, params, tries = 6) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let wait = 600;
  for (let i = 0; i < tries; i++) {
    if (where === 'official') await pace();
    let res;
    try {
      res = LOCAL ? await postUrl(LOCAL, body) : where === 'official' ? await postOfficial(body) : await postUrl(PUBLIC, body);
    } catch (e) { if (i === tries - 1) throw e; await new Promise(r => setTimeout(r, wait)); wait *= 2; continue; }
    let j;
    try { j = JSON.parse(res.text); } catch { j = null; }
    if (res.status === 429 || (j && j.error && j.error.code === 429)) { await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 15000); continue; }
    if (!j) { if (i === tries - 1) throw new RpcError(`HTTP ${res.status}: ${res.text.slice(0, 120)}`); await new Promise(r => setTimeout(r, wait)); wait *= 2; continue; }
    if (j.error) throw new RpcError(j.error.message || 'rpc error', j.error.code);
    return j.result;
  }
  throw new RpcError('rpc: too many retries (429)');
}

export const rpc = {
  async read(m, p) { try { return await call('public', m, p, 3); } catch (e) { if (LOCAL) throw e; return call('official', m, p); } },
  async blockNumber() { return parseInt(await this.read('eth_blockNumber', []), 16); },
  async blockTs(n) { const b = await this.read('eth_getBlockByNumber', ['0x' + n.toString(16), false]); return b ? parseInt(b.timestamp, 16) : 0; },
  async getLogs(f) {
    try { return await call('official', 'eth_getLogs', [f]); }
    catch (e) { if (LOCAL) throw e; return call('public', 'eth_getLogs', [f], 3); }
  },
  async ethCall(to, data) { return this.read('eth_call', [{ to, data }, 'latest']); },
  async code(addr) { return this.read('eth_getCode', [addr, 'latest']); },
};
export const hex = n => '0x' + BigInt(n).toString(16);
export const isLocal = () => !!LOCAL;
