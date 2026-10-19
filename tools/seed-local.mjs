// LOCAL FORK ONLY: fills a fresh anvil fork with real transactions against BlackveilBank so the site can be
// tested end to end. Refuses to run against anything but 127.0.0.1.
//   node tools/seed-local.mjs 0xBank
import { ethers } from 'ethers';

const RPC = process.env.LOCAL_RPC || 'http://127.0.0.1:8545';
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error('local fork only');
const BANK = process.argv[2];
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const prov = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true, cacheTimeout: -1 });
const abi = (await import('../public/abi/BlackveilBank.json', { with: { type: 'json' } })).default;
const erc = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];

const w = name => new ethers.Wallet(ethers.id('blackveil.local.' + name), prov);
const people = { gwen: w('gwen'), atlas: w('atlas'), ledger: w('ledger-co'), bot: w('concierge-bot'), bot2: w('concierge-bot-2') };

// find USDG's balance mapping slot, then write balances directly (fork only)
const U = new ethers.Contract(USDG, erc, prov);
async function findSlot() {
  const probe = people.gwen.address;
  for (let i = 0; i < 80; i++) {
    const slot = ethers.solidityPackedKeccak256(['uint256', 'uint256'], [probe, i]);
    const before = await prov.send('eth_getStorageAt', [USDG, slot, 'latest']);
    await prov.send('anvil_setStorageAt', [USDG, slot, ethers.toBeHex(123456789n, 32)]);
    if ((await U.balanceOf(probe)) === 123456789n) return i;
    await prov.send('anvil_setStorageAt', [USDG, slot, before]);
  }
  throw new Error('USDG balance slot not found');
}
const slot = await findSlot();
for (const p of Object.values(people)) {
  await prov.send('anvil_setBalance', [p.address, '0x' + (10n ** 18n).toString(16)]);
  const s = ethers.solidityPackedKeccak256(['uint256', 'uint256'], [p.address, slot]);
  await prov.send('anvil_setStorageAt', [USDG, s, ethers.toBeHex(5_000n * 10n ** 6n, 32)]);
}
console.log('funded 5,000 USDG each (slot', slot + ')');

const bank = who => new ethers.Contract(BANK, abi, people[who]);
const usdg = who => new ethers.Contract(USDG, erc, people[who]);
const u = x => ethers.parseUnits(String(x), 6);
const b32 = s => ethers.encodeBytes32String(s);
const step = async (label, p) => { const tx = await p; await tx.wait(); console.log('·', label); };

for (const who of ['gwen', 'atlas', 'ledger']) await step(`${who} approves`, usdg(who).approve(BANK, ethers.MaxUint256));
await step('gwen handle', bank('gwen').setHandle('gwen'.padEnd(5, 'x')));
await step('atlas handle', bank('atlas').setHandle('atlas'));
await step('ledger handle', bank('ledger').setHandle('ledger-co'));
await step('gwen deposit 1,200', bank('gwen').deposit(u(1200)));
await step('atlas deposit 300', bank('atlas').deposit(u(300)));
await step('gwen → atlas 125.50', bank('gwen').payHandle('atlas', u('125.5'), b32('dinner, tuesday'), false, false));
await step('atlas requests 40 from anyone', bank('atlas').createRequest(u(40), 0, b32('invoice 0042')));
await step('ledger pays request #1 from wallet', bank('ledger').payRequest(1, true));
await step('gwen creates agent', bank('gwen').createAgent(people.bot.address, u(50), u(200), u(20), false));
await step('gwen funds agent 300', bank('gwen').fundAgent(1, u(300)));
await step('agent pays ledger-co 15 (settles)', bank('bot').agentPay(1, people.ledger.address, u(15), b32('inv 0x8a19'), false));
await step('agent pays atlas 12 (settles)', bank('bot').agentPay(1, people.atlas.address, u(12), b32('api credits'), false));
await step('agent asks 35 (queues)', bank('bot').agentPay(1, people.ledger.address, u(35), b32('gpu hours'), false));
await step('agent asks 80 (refused: per payment)', bank('bot').agentPay(1, people.ledger.address, u(80), b32('annual plan'), false));
await step('gwen approves #1', bank('gwen').approve(1));
await step('agent asks 30 (queues)', bank('bot').agentPay(1, people.atlas.address, u(30), b32('unknown vendor'), false));
await step('gwen rejects #2', bank('gwen').reject(2));
await step('gwen rotates agent key', bank('gwen').rotateSigner(1, people.bot2.address));
await step('old key tries again (reverts)', (async () => { try { await bank('bot').agentPay.staticCall(1, people.ledger.address, u(5), b32('x'), false); } catch { } return { wait: async () => 0 }; })());
await step('atlas withdraws 50', bank('atlas').withdraw(u(50), people.atlas.address));
console.log('done');
