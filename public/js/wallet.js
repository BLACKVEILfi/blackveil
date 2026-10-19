// Wallet + contract access. Reads go through a public RPC; writes go through the user's injected wallet (EIP-6963 / window.ethereum).
import { CFG, toast, txUrl, esc } from './common.js';

const { ethers } = window;
export { ethers };
export const ABI = await (await fetch('/abi/BlackveilBank.json')).json();
export const ERC20 = [
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
];
export const read = new ethers.JsonRpcProvider(CFG.rpc, CFG.chainId, { staticNetwork: true });
export const bankR = CFG.bank ? new ethers.Contract(CFG.bank, ABI, read) : null;
export const usdgR = new ethers.Contract(CFG.usdg, ERC20, read);
export const U = v => ethers.parseUnits(String(v), 6);
export const fromU = v => Number(ethers.formatUnits(v, 6));
export const ROUTE = ['Settles', 'Queues', 'Refuses'];
export const REASON = ['None', 'Paused', 'Revoked', 'ZeroAmount', 'NotAllowlisted', 'OverPerPayment', 'OverDaily', 'InsufficientVault'];

// ───────── wallet discovery ─────────
const found = new Map();
addEventListener('eip6963:announceProvider', e => found.set(e.detail.info.uuid, e.detail));
dispatchEvent(new Event('eip6963:requestProvider'));
export function wallets() {
  const list = [...found.values()];
  if (!list.length && window.ethereum) list.push({ info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: window.ethereum });
  return list;
}

export const state = { eip: null, provider: null, signer: null, address: null, listeners: new Set() };
const emit = () => state.listeners.forEach(f => f(state));
export const onChange = f => state.listeners.add(f);

const CHAIN_HEX = '0x' + Number(CFG.chainId).toString(16);
async function ensureChain(eip) {
  const id = await eip.request({ method: 'eth_chainId' });
  if (id === CHAIN_HEX) return;
  try { await eip.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); }
  catch (e) {
    if (e.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(e.message || '')) throw e;
    await eip.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: CHAIN_HEX, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: [CFG.local ? CFG.rpc : 'https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [CFG.explorer],
    }] });
  }
}

export async function connect(eip) {
  await eip.request({ method: 'eth_requestAccounts' });
  await ensureChain(eip);
  state.eip = eip;
  state.provider = new ethers.BrowserProvider(eip, 'any');
  state.signer = await state.provider.getSigner();
  state.address = ethers.getAddress(await state.signer.getAddress());
  try { localStorage.setItem('bv.wallet', '1'); } catch { }
  eip.on?.('accountsChanged', a => { if (!a.length) disconnect(); else connect(eip).catch(() => { }); });
  eip.on?.('chainChanged', () => location.reload());
  emit();
}

export function disconnect() {
  Object.assign(state, { eip: null, provider: null, signer: null, address: null });
  try { localStorage.removeItem('bv.wallet'); } catch { }
  emit();
}

export async function reconnect() {
  let want = false;
  try { want = localStorage.getItem('bv.wallet') === '1'; } catch { }
  if (!want) return;
  await new Promise(r => setTimeout(r, 150));
  const w = wallets()[0];
  if (!w) return;
  const acc = await w.provider.request({ method: 'eth_accounts' }).catch(() => []);
  if (acc.length) await connect(w.provider).catch(() => { });
}

export const bankW = () => new ethers.Contract(CFG.bank, ABI, state.signer);
export const usdgW = () => new ethers.Contract(CFG.usdg, ERC20, state.signer);

// ───────── sending ─────────
const ERRORS = {
  InsufficientBalance: 'Your bank balance is too low for that (the fee is added on top).', InsufficientVault: 'The agent vault is too low for that.',
  BadHandle: 'Handles are 3–20 characters: a–z, 0–9 and inner hyphens.', HandleTaken: 'That handle is taken.',
  CharterRequired: 'Three- and four-letter handles are for charter holders.', NoSlot: 'No free agent slot — hold the charter for ten.',
  NotOpen: 'That is no longer open.', Expired: 'That request has expired.', NoHandle: 'No account holds that handle.',
  NotAgentOwner: 'Only the account that opened this agent can do that.', NotSigner: 'Only the agent key can spend from its vault.',
  AgentNotLive: 'That agent is revoked.', ZeroAmount: 'Enter an amount.', ZeroAddress: 'Enter an address.', TransferFailed: 'The USDG transfer failed — check balance and approval.',
};
export function why(e) {
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  try {
    const err = new ethers.Interface(ABI).parseError(typeof data === 'string' ? data : data?.data);
    if (err) return ERRORS[err.name] || err.name;
  } catch { }
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001) return 'You cancelled it in the wallet.';
  const m = e?.shortMessage || e?.reason || e?.message || String(e);
  for (const k of Object.keys(ERRORS)) if (m.includes(k)) return ERRORS[k];
  return m.slice(0, 180);
}

export async function send(label, fn) {
  if (!state.signer) { toast('Connect a wallet first.', 'err'); return null; }
  try {
    toast(`${esc(label)} — confirm in your wallet`);
    const tx = await fn();
    const rcpt = await tx.wait();
    toast(`${esc(label)} ✓ <a href="${txUrl(rcpt.hash)}" target="_blank" rel="noopener">view transaction</a>`, 'ok');
    return rcpt;
  } catch (e) {
    toast(`${esc(label)}: ${esc(why(e))}`, 'err');
    return null;
  }
}

export async function ensureAllowance(amount) {
  const have = await usdgR.allowance(state.address, CFG.bank);
  if (have >= amount) return true;
  return !!(await send('Approve USDG', () => usdgW().approve(CFG.bank, ethers.MaxUint256)));
}

export function memo(s) {
  s = String(s || '').trim();
  if (!s) return ethers.ZeroHash;
  if (new TextEncoder().encode(s).length > 31) throw new Error('Memo is limited to 31 bytes.');
  return ethers.encodeBytes32String(s);
}
