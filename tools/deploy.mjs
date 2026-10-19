// Deploy BlackveilBank.
//   node tools/deploy.mjs                       dry run on mainnet: shows deployer, balance, gas estimate — sends nothing
//   node tools/deploy.mjs --go                  deploy on Robinhood Chain, then write bank/deployBlock/deployTx into public/config.js
//   node tools/deploy.mjs --local [--go]        same against a local anvil fork (LOCAL_RPC, default http://127.0.0.1:8545); config untouched
// Deployer key: ~/.config/blackveil/deployer.json {"privateKey":"0x…"} (never in the project, never printed).
// Owner: OWNER env, default the deployer itself. Fee recipient: FEE_TO env, default the house fee wallet below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { ethers } from 'ethers';

const ROOT = new URL('..', import.meta.url).pathname;
const LOCAL = process.argv.includes('--local');
const GO = process.argv.includes('--go');
const RPC = LOCAL ? (process.env.LOCAL_RPC || 'http://127.0.0.1:8545') : (process.env.RPC_URL || 'https://robinhood-rpc.publicnode.com');
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const FEE_TO = process.env.FEE_TO || '0xe3cc4B8FDd939366B9D156f162D0d97E967c16E9';

const art = JSON.parse(readFileSync(ROOT + 'contracts/out/BlackveilBank.sol/BlackveilBank.json', 'utf8'));
const prov = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true, cacheTimeout: -1 });
const keyFile = process.env.DEPLOYER_FILE || homedir() + '/.config/blackveil/deployer.json';
let wallet;
if (LOCAL && !existsSync(keyFile)) wallet = new ethers.Wallet(ethers.id('blackveil.local.deployer'), prov);
else wallet = new ethers.Wallet(JSON.parse(readFileSync(keyFile, 'utf8')).privateKey, prov);

const net = await prov.getNetwork();
if (net.chainId !== 4663n) throw new Error('not Robinhood Chain (4663): ' + net.chainId);
const f = new ethers.ContractFactory(art.abi, art.bytecode.object, wallet);
const OWNER = process.env.OWNER || wallet.address;
const tx = await f.getDeployTransaction(USDG, OWNER, FEE_TO);
const [bal, gas, fee] = await Promise.all([prov.getBalance(wallet.address), prov.estimateGas({ ...tx, from: wallet.address }), prov.getFeeData()]);
const cost = gas * (fee.maxFeePerGas || fee.gasPrice);
console.log(`${LOCAL ? 'LOCAL fork' : 'Robinhood Chain'} · deployer ${wallet.address}`);
console.log(`balance ${ethers.formatEther(bal)} ETH · gas ${gas} · max cost ${ethers.formatEther(cost)} ETH`);
console.log(`owner ${OWNER} · fee recipient ${FEE_TO} · USDG ${USDG}`);
if (!GO) { console.log('dry run — add --go to deploy'); process.exit(0); }
if (bal < cost) { console.log('✗ not enough ETH for gas'); process.exit(1); }

const c = await f.deploy(USDG, OWNER, FEE_TO);
const rcpt = await c.deploymentTransaction().wait();
const addr = await c.getAddress();
console.log(`✓ BlackveilBank ${addr} · block ${rcpt.blockNumber} · tx ${rcpt.hash}`);

if (!LOCAL) {
  const file = ROOT + 'public/config.js';
  let s = readFileSync(file, 'utf8');
  s = s.replace(/(\n\s*bank:\s*)(null|'[^']*')/, `$1'${addr}'`)
    .replace(/(\n\s*deployBlock:\s*)(null|\d+)/, `$1${rcpt.blockNumber}`)
    .replace(/(\n\s*deployTx:\s*)(null|'[^']*')/, `$1'${rcpt.hash}'`);
  writeFileSync(file, s);
  const sdk = ROOT + 'public/sdk/blackveil-agent.mjs';
  writeFileSync(sdk, readFileSync(sdk, 'utf8').replace(/export const BANK = [^;]+;/, `export const BANK = '${addr}';`));
  console.log('✓ public/config.js updated — next: node tools/verify-sourcify.mjs, then ./deploy.sh config');
} else {
  console.log(`run the site against it:  LOCAL_RPC=${RPC} BANK=${addr} DEPLOY_BLOCK=${rcpt.blockNumber} npm run serve`);
}
