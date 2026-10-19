// blackveil-agent.mjs — drop-in module for an AI agent that spends from a BLACKVEIL vault.
// Needs ethers v6 (npm i ethers). Works in Node 18+ and in the browser.
//
//   import { BlackveilAgent } from './blackveil-agent.mjs'
//   const agent = new BlackveilAgent({ privateKey: process.env.AGENT_KEY, agentId: 1 })
//   const r = await agent.pay('ledger-co', '15.00', { ref: 'inv 0x8a19' })
//   // r.route is 'Settles' | 'Queues' | 'Refuses'; r.reason explains a refusal
//
// CLI:  AGENT_KEY=0x… AGENT_ID=1 node blackveil-agent.mjs route|pay|status <to> <amount> [ref]
import { ethers } from 'ethers';

export const BANK = '0xA47c92A006C3d8565310aB669ccde65AF229F78A'; // filled in at launch — or pass { bank } to the constructor
export const RPC = 'https://robinhood-rpc.publicnode.com';
export const ROUTE = ['Settles', 'Queues', 'Refuses'];
export const REASON = ['None', 'Paused', 'Revoked', 'ZeroAmount', 'NotAllowlisted', 'OverPerPayment', 'OverDaily', 'InsufficientVault'];

const ABI = [
  'function routeFor(uint256 id, address to, uint256 amount) view returns (uint8 route, uint8 reason)',
  'function agentPay(uint256 id, address to, uint256 amount, bytes32 ref, bool toWallet) returns (uint8 route, uint256 pendingId)',
  'function agent(uint256 id) view returns (tuple(address owner, address signer, uint256 perPayment, uint256 perDay, uint256 reviewAbove, uint256 vault, uint256 spent, uint256 windowStart, uint8 status, bool allowlistOnly))',
  'function resolve(string handle) view returns (address)',
  'function feeFor(uint256 amount) pure returns (uint256)',
  'event Queued(uint256 indexed pendingId, uint256 indexed agentId, address indexed to, uint256 amount, bytes32 ref)',
  'event AgentRefused(uint256 indexed id, address indexed to, uint256 amount, uint8 reason, bytes32 ref)',
];

export class BlackveilAgent {
  constructor({ privateKey, agentId, bank = BANK, rpc = RPC, recordRefusals = false }) {
    if (!bank) throw new Error('bank address missing');
    // no response cache + a nonce manager, so back-to-back payments never reuse a nonce
    this.provider = new ethers.JsonRpcProvider(rpc, 4663, { staticNetwork: true, cacheTimeout: -1 });
    this.wallet = new ethers.NonceManager(new ethers.Wallet(privateKey, this.provider));
    this.bank = new ethers.Contract(bank, ABI, this.wallet);
    this.id = BigInt(agentId);
    this.recordRefusals = recordRefusals; // true = send refused attempts anyway so they are logged on chain
  }

  async to(recipient) {
    const r = String(recipient).replace(/\.veil$/, '');
    if (ethers.isAddress(r)) return ethers.getAddress(r);
    const a = await this.bank.resolve(r.toLowerCase());
    if (a === ethers.ZeroAddress) throw new Error(`no account holds the handle "${r}"`);
    return a;
  }

  /** What the contract would do right now — no transaction. */
  async route(recipient, amount) {
    const to = await this.to(recipient);
    const [route, reason] = await this.bank.routeFor(this.id, to, ethers.parseUnits(String(amount), 6));
    return { to, route: ROUTE[Number(route)], reason: REASON[Number(reason)] };
  }

  /** Pay inside the mandate. Settles at once, queues for the owner above the review line, or is refused. */
  async pay(recipient, amount, { ref = '', toWallet = false } = {}) {
    const pre = await this.route(recipient, amount);
    if (pre.route === 'Refuses' && !this.recordRefusals) return { ...pre, sent: false };
    const tx = await this.bank.agentPay(this.id, pre.to, ethers.parseUnits(String(amount), 6), ref ? ethers.encodeBytes32String(ref.slice(0, 31)) : ethers.ZeroHash, toWallet);
    const rcpt = await tx.wait();
    let pendingId = null;
    for (const l of rcpt.logs) {
      try { const p = this.bank.interface.parseLog(l); if (p?.name === 'Queued') pendingId = Number(p.args.pendingId); } catch { }
    }
    return { ...pre, sent: true, hash: rcpt.hash, pendingId };
  }

  async status() {
    const a = await this.bank.agent(this.id);
    const u = v => Number(ethers.formatUnits(v, 6));
    return {
      owner: a.owner, signer: a.signer, status: ['', 'active', 'paused', 'revoked'][Number(a.status)],
      vault: u(a.vault), spentToday: u(a.spent), perPayment: u(a.perPayment), perDay: u(a.perDay), reviewAbove: u(a.reviewAbove), allowlistOnly: a.allowlistOnly,
    };
  }
}

// ───────── CLI ─────────
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [cmd, to, amount, ref] = process.argv.slice(2);
  const agent = new BlackveilAgent({ privateKey: process.env.AGENT_KEY, agentId: process.env.AGENT_ID, bank: process.env.BANK || BANK, rpc: process.env.RPC || RPC });
  const out = cmd === 'status' ? await agent.status() : cmd === 'route' ? await agent.route(to, amount) : cmd === 'pay' ? await agent.pay(to, amount, { ref }) : 'usage: route|pay|status <to> <amount> [ref]';
  console.log(out);
}
