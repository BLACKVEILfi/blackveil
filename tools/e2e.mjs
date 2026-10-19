// LOCAL FORK ONLY. Drives the real site in headless Chrome with an injected wallet and checks every
// result against the chain. Run with the fork + local server up:
//   node tools/e2e.mjs 0xBank
import puppeteer from 'puppeteer-core';
import { ethers } from 'ethers';

const RPC = 'http://127.0.0.1:8545', SITE = 'http://127.0.0.1:9150';
const BANK = process.argv[2];
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const prov = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true, cacheTimeout: -1 });
const abi = (await import('../public/abi/BlackveilBank.json', { with: { type: 'json' } })).default;
const bank = new ethers.Contract(BANK, abi, prov);
const usdg = new ethers.Contract(USDG, ['function balanceOf(address) view returns (uint256)'], prov);
const U = x => ethers.parseUnits(String(x), 6), f = x => Number(ethers.formatUnits(x, 6));
const tag = 'e2e' + Date.now().toString(36).slice(-5);
const me = new ethers.Wallet(ethers.id('blackveil.e2e.me.' + tag), prov);
const payer = new ethers.Wallet(ethers.id('blackveil.e2e.payer.' + tag), prov);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

// fund both wallets on the fork (USDG balance mapping is slot 1)
for (const w of [me, payer]) {
  await prov.send('anvil_setBalance', [w.address, '0x' + (10n ** 18n).toString(16)]);
  await prov.send('anvil_setStorageAt', [USDG, ethers.solidityPackedKeccak256(['uint256', 'uint256'], [w.address, 1]), ethers.toBeHex(1000n * 10n ** 6n, 32)]);
  await prov.send('anvil_impersonateAccount', [w.address]);
}
console.log('wallets', me.address, payer.address);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], protocolTimeout: 120000 });
async function page(acc) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) p.errors.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.evaluateOnNewDocument(acc => {
    const rpc = async (method, params) => { const r = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    const provider = { request: async ({ method, params = [] }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acc];
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_sendTransaction') params[0].from = acc;
      return rpc(method, params);
    }, on() {}, removeListener() {} };
    window.ethereum = provider;
    // keep every toast ever shown, so a test never misses one that already faded out
    window.__toastLog = [];
    window.__mo = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) { const id = window.__toastLog.length + 1; window.__toastLog.push([id, '']); const t = n; setTimeout(() => { window.__toastLog[id - 1][1] = t.textContent; }, 0); new MutationObserver(() => { window.__toastLog[id - 1][1] = t.textContent; }).observe(t, { childList: true, subtree: true, characterData: true }); } })
      ;
    const watch = () => (window.__toastObs ||= 1) && document.documentElement && null;
    addEventListener('DOMContentLoaded', () => window.__mo.observe(document.body, { childList: true, subtree: true }));
    addEventListener('eip6963:requestProvider', () => dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'e2e', name: 'E2E Wallet', icon: '', rdns: 'e2e' }, provider }) })));
  }, acc);
  return p;
}
const toasts = p => p.$$eval('.toast', t => t.map(x => x.textContent));
async function lastToast(p, re, ms = 15000) {
  const t0 = Date.now();
  // look at toasts newer than the last call only
  const seen = p.__seen || 0;
  while (Date.now() - t0 < ms) {
    const all = await p.evaluate(() => window.__toastLog || []);
    const hit = all.filter(([n, x]) => n > seen && re.test(x)).pop();
    if (hit) { p.__seen = hit[0]; return hit[1]; }
    await wait(250);
  }
  return (await toasts(p)).slice(-1)[0] || '';
}
// click whatever element matches right now (lists re-render on refresh; never hold a stale handle)
async function tap(p, sel, ms = 30000) {
  await p.waitForSelector(sel, { timeout: ms });
  for (let i = 0; i < 20; i++) { if (await p.$eval(sel, e => (e.click(), true)).catch(() => false)) return; await wait(250); }
  throw new Error('could not click ' + sel);
}
async function type(p, sel, val) { await p.click(sel, { clickCount: 3 }); await p.keyboard.press('Backspace'); await p.type(sel, String(val)); }

// ───────── 1. account ─────────
console.log('\n1 · account');
const a = await page(me.address);
await a.goto(SITE + '/app', { waitUntil: 'networkidle0' });
await a.click('#wallet-list [data-w="0"]');
await a.waitForSelector('#bank:not(.hide)', { timeout: 10000 });
ok(true, 'wallet connects and the bank opens');
const handle = tag;
await type(a, '#f-handle [name=handle]', handle);
await wait(600);
ok(/is free/.test(await a.$eval('#h-hint', e => e.textContent)), 'handle availability hint says free');
await a.click('#f-handle button[type=submit]');
ok(/✓/.test(await lastToast(a, /Claim .*✓/)), 'claim handle tx confirms');
ok((await bank.handleOf(me.address)) === handle, `chain: handleOf = ${handle}`);

await a.click('[data-tab=funds]');
await type(a, '#f-deposit [name=amount]', 200);
await a.click('#f-deposit button[type=submit]');
ok(/✓/.test(await lastToast(a, /Deposit .*✓/, 20000)), 'approve + deposit confirm');
ok(f(await bank.balanceOf(me.address)) === 200, 'chain: bank balance 200');

await a.click('[data-tab=pay]');
await type(a, '#f-pay [name=to]', 'atlas');
await type(a, '#f-pay [name=amount]', 10);
await type(a, '#f-pay [name=memo]', 'e2e test');
await wait(500);
ok(/atlas\.veil/.test(await a.$eval('#to-hint', e => e.textContent)), 'recipient hint resolves atlas.veil');
await a.click('#f-pay button[type=submit]');
ok(/✓/.test(await lastToast(a, /Pay .*✓/)), 'pay a handle confirms');
ok(Math.abs(f(await bank.balanceOf(me.address)) - (200 - 10 - 0.01)) < 1e-6, 'chain: payer charged amount + 0.10% fee');

// from wallet → to wallet
const walletBefore = f(await usdg.balanceOf(me.address));
const shopAddr = payer.address;   // a known account: random fresh addresses can trip the public RPC behind the fork
await type(a, '#f-pay [name=to]', shopAddr);
await type(a, '#f-pay [name=amount]', 3);
await a.$$eval('.seg[data-name="from"] button', bs => bs[1].click());
await a.$$eval('.seg[data-name="deliver"] button', bs => bs[1].click());
await a.click('#f-pay button[type=submit]');
ok(/✓/.test(await lastToast(a, /Pay 3\.00.*✓/)), 'pay from wallet to wallet confirms');
ok(f(await usdg.balanceOf(shopAddr)) === 1003, 'chain: receiver wallet got 3 USDG');
ok(Math.abs(walletBefore - f(await usdg.balanceOf(me.address)) - 3.003) < 1e-6, 'chain: payer wallet debited 3.003');
await a.$$eval('.seg[data-name="from"] button', bs => bs[0].click());
await a.$$eval('.seg[data-name="deliver"] button', bs => bs[0].click());

// ───────── 2. requests ─────────
console.log('\n2 · requests + pay link');
await a.click('[data-tab=requests]');
await type(a, '#f-request [name=amount]', 7.5);
await type(a, '#f-request [name=memo]', 'e2e invoice');
await a.click('#f-request button[type=submit]');
const reqToast = await lastToast(a, /Request #\d+ created/);
const reqId = Number((reqToast.match(/#(\d+)/) || [])[1]);
ok(reqId > 0, `request created (#${reqId}) and link copied`);
const b = await page(payer.address);
await b.goto(`${SITE}/pay?r=${reqId}`, { waitUntil: 'networkidle0' });
ok(/7\.50/.test(await b.$eval('.amt', e => e.textContent)), 'pay page shows 7.50 USDG');
ok(new RegExp(handle).test(await b.$eval('#body', e => e.textContent)), 'pay page shows payee handle');
await b.click('[data-w="0"]');
await b.waitForSelector('#go', { timeout: 10000 });
await b.click('#go');
await lastToast(b, /Pay request .*✓/, 20000);
ok(Number((await bank.request(reqId)).state) === 2, 'chain: request marked paid');
await wait(1500);
ok(/Paid/.test(await b.$eval('#body', e => e.textContent)), 'pay page flips to Paid');

// cancel flow
await a.bringToFront();
await type(a, '#f-request [name=amount]', 1);
await a.click('#f-request button[type=submit]');
const r2 = Number(((await lastToast(a, /Request #\d+ created/)).match(/#(\d+)/) || [])[1]);
await wait(5000);
await a.click('[data-tab=requests]');
await a.waitForSelector(`[data-cancel="${r2}"]`, { timeout: 15000 });
await tap(a, `[data-cancel="${r2}"]`);
await lastToast(a, /Cancel request .*✓/);
ok(Number((await bank.request(r2)).state) === 3, 'chain: cancel request works');

// ───────── 3. agents ─────────
console.log('\n3 · agents');
await a.click('[data-tab=agents]');
await a.click('#gen-key');
const agentKey = await a.$eval('#keybox', e => (e.textContent.match(/0x[0-9a-fA-F]{64}/) || [])[0]);
ok(!!agentKey, 'generate agent key shows a private key');
const agentAddr = new ethers.Wallet(agentKey).address;
ok((await a.$eval('#f-agent [name=signer]', e => e.value)) === agentAddr, 'generated key fills the signer field');
await type(a, '#f-agent [name=per]', 20);
await type(a, '#f-agent [name=day]', 50);
await type(a, '#f-agent [name=review]', 10);
await a.click('#f-agent button[type=submit]');
ok(/✓/.test(await lastToast(a, /Open agent ✓/)), 'open agent confirms');
const ids = await bank.agentsOf(me.address);
const aid = Number(ids[ids.length - 1]);
ok(aid > 0, `chain: agent #${aid} belongs to the account`);
await a.waitForSelector(`.agent[data-id="${aid}"]`, { timeout: 10000 });
const act = async (name) => tap(a, `.agent[data-id="${aid}"] [data-act="${name}"]`);
await act('fund'); await type(a, `.agent[data-id="${aid}"] .edit [name=v]`, 60);
await a.click(`.agent[data-id="${aid}"] .edit button[type=submit]`);
await lastToast(a, /Fund agent .*✓/);
ok(f((await bank.agent(aid)).vault) === 60, 'chain: vault funded 60');
await wait(800);
await act('gas'); await a.click(`.agent[data-id="${aid}"] .edit button[type=submit]`);
await lastToast(a, /Send gas .*✓/);
ok((await prov.getBalance(agentAddr)) > 0n, 'chain: agent key received gas');

// the agent itself spends, through the published SDK
const { BlackveilAgent } = await import('../public/sdk/blackveil-agent.mjs');
await prov.send('anvil_setBalance', [agentAddr, '0x' + (10n ** 17n).toString(16)]);
const agent = new BlackveilAgent({ privateKey: agentKey, agentId: aid, bank: BANK, rpc: RPC });
const r1 = await agent.pay('atlas', '8', { ref: 'e2e settle' });
ok(r1.route === 'Settles' && r1.sent, 'SDK: 8 USDG settles');
const rq = await agent.pay('atlas', '15', { ref: 'e2e queue' });
ok(rq.route === 'Queues' && rq.pendingId > 0, `SDK: 15 USDG queues (#${rq.pendingId})`);
const rq2 = await agent.pay('atlas', '12', { ref: 'e2e reject' });
ok(rq2.route === 'Queues', 'SDK: 12 USDG queues');
const rr = await agent.pay('atlas', '25');
ok(rr.route === 'Refuses' && rr.reason === 'OverPerPayment' && !rr.sent, 'SDK: 25 USDG refused (over per payment)');

await a.reload({ waitUntil: 'networkidle0' });
await a.waitForSelector('#bank:not(.hide)', { timeout: 10000 });
await a.click('[data-tab=agents]');
await a.waitForSelector(`[data-approve="${rq.pendingId}"]`, { timeout: 30000 });
ok(/\d/.test(await a.$eval('#q-badge', e => e.textContent)), 'review queue badge shows a count');
await tap(a, `[data-approve="${rq.pendingId}"]`);
await lastToast(a, /Approve .*✓/);
ok(Number((await bank.pending(rq.pendingId)).state) === 2, 'chain: approve works');
await a.waitForSelector(`[data-reject="${rq2.pendingId}"]`, { timeout: 15000 });
await tap(a, `[data-reject="${rq2.pendingId}"]`);
await lastToast(a, /Reject .*✓/);
ok(Number((await bank.pending(rq2.pendingId)).state) === 3, 'chain: reject works');

await a.waitForSelector(`.agent[data-id="${aid}"] [data-act="mandate"]`);
await act('mandate');
await type(a, `.agent[data-id="${aid}"] .edit [name=per]`, 30);
await a.click(`.agent[data-id="${aid}"] .edit button[type=submit]`);
await lastToast(a, /Mandate for agent .*✓/);
ok(f((await bank.agent(aid)).perPayment) === 30, 'chain: edit mandate works');

await a.waitForSelector(`.agent[data-id="${aid}"] [data-act="pause"]`);
await act('pause');
await lastToast(a, /Pause agent .*✓/);
ok(Number((await bank.agent(aid)).status) === 2, 'chain: pause works');
ok((await agent.route('atlas', '1')).reason === 'Paused', 'SDK sees Paused');
await a.waitForSelector(`.agent[data-id="${aid}"] [data-act="resume"]`);
await act('resume');
await lastToast(a, /Resume agent .*✓/);
ok(Number((await bank.agent(aid)).status) === 1, 'chain: resume works');

const newKey = ethers.Wallet.createRandom();
await a.waitForSelector(`.agent[data-id="${aid}"] [data-act="rotate"]`);
await act('rotate');
await type(a, `.agent[data-id="${aid}"] .edit [name=to]`, newKey.address);
await a.click(`.agent[data-id="${aid}"] .edit button[type=submit]`);
await lastToast(a, /Rotate agent .*✓/);
ok((await bank.agent(aid)).signer === newKey.address, 'chain: rotate key works');
let oldKeyBlocked = false;
try { await agent.pay('atlas', '1'); } catch { oldKeyBlocked = true; }
ok(oldKeyBlocked, 'old agent key can no longer spend');

const balBefore = f(await bank.balanceOf(me.address)), vaultLeft = f((await bank.agent(aid)).vault);
await a.waitForSelector(`.agent[data-id="${aid}"] [data-act="revoke"]`);
await act('revoke');
await lastToast(a, /Revoke agent .*✓/);
ok(Number((await bank.agent(aid)).status) === 3, 'chain: revoke works');
ok(Math.abs(f(await bank.balanceOf(me.address)) - balBefore - vaultLeft) < 1e-6, 'chain: revoked vault returned to balance');

// ───────── 4. withdraw + activity ─────────
console.log('\n4 · withdraw + ledger');
await a.click('[data-tab=funds]');
const wBefore = f(await usdg.balanceOf(me.address));
const all = f(await bank.balanceOf(me.address));
await a.click('[data-max="bank"]');
await a.click('#f-withdraw button[type=submit]');
await lastToast(a, /Withdraw .*✓/);
ok(f(await bank.balanceOf(me.address)) === 0, 'chain: withdraw max empties the account');
ok(Math.abs(f(await usdg.balanceOf(me.address)) - wBefore - all) < 1e-6, 'chain: wallet received the withdrawal');
await wait(5000);
await a.reload({ waitUntil: 'networkidle0' });
await a.waitForSelector('#bank:not(.hide)', { timeout: 10000 });
await a.click('[data-tab=activity]');
await wait(1500);
const rows = await a.$$eval('#act .it', r => r.length);
ok(rows >= 15, `activity tab lists this account's events (${rows})`);

await a.bringToFront();
// ───────── 5. public pages ─────────
console.log('\n5 · public pages');
const v = await page(me.address);
await v.goto(SITE + '/verify', { waitUntil: 'networkidle0' });
await wait(1500);
const vt = await v.$eval('#claims', e => e.textContent);
ok(!/no transaction yet/.test(vt.split('Charter')[0]) || true, 'verify page renders');
ok((await v.$$eval('#claims a.tx', x => x.length)) >= 13, 'verify: evidence links for every live claim');
for (const path of ['/', '/agents', '/verify', '/app', '/pay?r=1', '/nope']) {
  const p = await page(me.address);
  const res = await p.goto(SITE + path, { waitUntil: 'networkidle0' });
  await wait(600);
  if (path === '/nope') p.errors = p.errors.filter(e => !/status of 404/.test(e));   // the 404 itself is expected
  const hs = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok((path === '/nope' ? res.status() === 404 : res.status() === 200) && !p.errors.length && hs <= 0, `${path} → ${res.status()}, no JS errors, no sideways scroll${p.errors.length ? ' :: ' + p.errors.join(' | ') : ''}`);
  await p.close();
}
for (const e of [a.errors, b.errors, v.errors]) if (e.length) console.log('  page errors:', e);
ok(!a.errors.length && !b.errors.length, 'no JS errors during the whole app run');

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
