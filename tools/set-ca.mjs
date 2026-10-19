// After $BLVE launches on Pons:
//   node tools/set-ca.mjs 0x…            dry run: checks the token on chain and shows what will happen — sends nothing
//   node tools/set-ca.mjs 0x… --go       writes public/config.js (ca), then from the bank owner key:
//                                        setCharterToken(ca) (one time, irreversible) + setCharterMin(1,000,000 BLVE)
//   options: --min 1000000  --force (skip the Pons/ticker checks)
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import vm from 'node:vm';
import { ethers } from 'ethers';

const ROOT = new URL('..', import.meta.url).pathname, FILE = ROOT + 'public/config.js';
const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const args = process.argv.slice(2);
const CA = args.find(a => /^0x[0-9a-fA-F]{40}$/.test(a));
const GO = args.includes('--go'), FORCE = args.includes('--force');
const MIN = args.includes('--min') ? args[args.indexOf('--min') + 1] : '1000000';
if (!CA) { console.log('usage: node tools/set-ca.mjs 0x<BLVE CA> [--go] [--min 1000000] [--force]'); process.exit(2); }

const box = { window: {} }; vm.runInNewContext(readFileSync(FILE, 'utf8'), box);
const CFG = box.window.BLACKVEIL_CONFIG;
const prov = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://robinhood-rpc.publicnode.com', 4663, { staticNetwork: true, cacheTimeout: -1 });
const ca = ethers.getAddress(CA);

const code = await prov.getCode(ca);
if (code === '0x') { console.log('✗ not a contract on Robinhood Chain (wallet address or typo) — nothing changed'); process.exit(1); }
const erc = new ethers.Contract(ca, ['function symbol() view returns (string)', 'function name() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)'], prov);
const [sym, name, dec, supply] = await Promise.all([erc.symbol(), erc.name(), erc.decimals(), erc.totalSupply()]);
const lt = await prov.call({ to: PONS_FACTORY, data: '0x3cf28b5a' + ca.slice(2).toLowerCase().padStart(64, '0') }).catch(() => '0x');
const isPons = lt.length >= 2 + 64 * 15 && BigInt('0x' + lt.slice(2 + 14 * 64, 2 + 15 * 64)) === 1n;
console.log(`token ${name} ($${sym}) · ${dec} decimals · supply ${ethers.formatUnits(supply, dec)} · born on Pons v2: ${isPons ? 'yes' : 'NO'}`);
if (!FORCE && (!isPons || sym.replace(/^\$/, '').toUpperCase() !== 'BLVE')) { console.log('✗ not a Pons token with ticker BLVE — nothing changed (add --force if this really is it)'); process.exit(1); }

const bank = new ethers.Contract(CFG.bank, ['function owner() view returns (address)', 'function charterToken() view returns (address)', 'function charterMin() view returns (uint256)',
  'function setCharterToken(address)', 'function setCharterMin(uint256)'], prov);
const [owner, current, curMin] = await Promise.all([bank.owner(), bank.charterToken(), bank.charterMin()]);
const minUnits = ethers.parseUnits(MIN, dec);
console.log(`bank ${CFG.bank} · owner ${owner} · charter token now ${current} · min now ${curMin}`);
console.log(`plan: config.ca = ${ca}; ${current === ethers.ZeroAddress ? 'setCharterToken(' + ca + ')' : 'charter token already set — skip'}; setCharterMin(${MIN} ${sym})`);
if (current !== ethers.ZeroAddress && current !== ca) { console.log('✗ the bank already points at a different charter token — it can only be set once'); process.exit(1); }
if (!GO) { console.log('dry run — add --go'); process.exit(0); }

// 1) site config
const before = readFileSync(FILE, 'utf8');
const after = before.replace(/(\n\s*ca:\s*)(null|'[^']*')/, `$1'${ca}'`);
writeFileSync(FILE, after);
const sdk = ROOT + 'public/sdk/blackveil-agent.mjs';
console.log('✓ public/config.js ca set');

// 2) bank owner transactions
const key = JSON.parse(readFileSync(homedir() + '/.config/blackveil/deployer.json', 'utf8')).privateKey;
const w = new ethers.NonceManager(new ethers.Wallet(key, prov));
if ((await w.getAddress()) !== owner) { console.log('✗ the deployer key is not the bank owner any more — set the charter from the owner wallet'); process.exit(1); }
const B = bank.connect(w);
if (current === ethers.ZeroAddress) { const r = await (await B.setCharterToken(ca)).wait(); console.log('✓ setCharterToken', r.hash); }
if (curMin !== minUnits) { const r = await (await B.setCharterMin(minUnits)).wait(); console.log('✓ setCharterMin', MIN, r.hash); }
console.log('next: upload public/config.js to the live site (./deploy.sh config) and check /verify');
