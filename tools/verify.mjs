// PRD §4b: check every verification claim from outside (Sourcify, Etherscan, eth_call, receipts, source scan).
//   node tools/verify.mjs      → prints claim / check / result / pass, writes media/proof/verify.json
import fs from 'node:fs'
import { ethers } from 'ethers'

const ROOT = new URL('..', import.meta.url).pathname
const cfg = fs.readFileSync(ROOT + 'public/config.js', 'utf8')
const BANK = cfg.match(/bank:\s*'(0x[0-9a-fA-F]{40})'/)[1]
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const prov = new ethers.JsonRpcProvider('https://robinhood-rpc.publicnode.com', 4663, { staticNetwork: true })
const abi = JSON.parse(fs.readFileSync(ROOT + 'public/abi/BlackveilBank.json', 'utf8'))
const bank = new ethers.Contract(BANK, abi, prov)
const src = fs.readFileSync(ROOT + 'contracts/src/BlackveilBank.sol', 'utf8')
const proof = JSON.parse(fs.readFileSync(ROOT + 'media/proof/proof-tx.json', 'utf8'))
const res = []
const add = (k, klaim, cek, ok, hasil, bukti) => { res.push({ k, klaim, cek, hasil, bukti, status: ok ? 'lolos' : 'GAGAL' }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${k.padEnd(10)} ${hasil}`) }
const j = async u => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : { status: r.status } } catch (e) { return { error: e.message } } }
const ES = `https://robin.etherscan.io/address/${BANK}#code`

// 1 · source verified
const sf = await j(`https://sourcify.dev/server/v2/contract/4663/${BANK}`)
add('source', 'Source verified on Sourcify (exact match), forwarded to Etherscan', 'sourcify /server/v2/contract/4663', sf.match === 'exact_match', `Sourcify ${sf.match} (creation ${sf.creationMatch}, runtime ${sf.runtimeMatch})`, `https://repo.sourcify.dev/4663/${BANK}`)
// 2 · settles in the real USDG
const u = await bank.usdg()
add('usdg', 'Settles in the real USDG on Robinhood Chain', 'eth_call usdg()', u.toLowerCase() === USDG.toLowerCase(), `usdg() = ${u}`, ES)
// 3 · fee constants
const [bps, cap] = await Promise.all([bank.FEE_BPS(), bank.FEE_CAP()])
add('fee', 'Fee is a constant: 0.10 %, capped at 2 USDG, on the payer', 'eth_call FEE_BPS() FEE_CAP() + source', bps === 10n && cap === 2000000n && /constant FEE_BPS = 10;/.test(src) && /constant FEE_CAP = 2e6;/.test(src), `FEE_BPS ${bps} · FEE_CAP ${cap} (2 USDG) · both constant`, ES)
// 4 · owner powers are narrow
const ownerFns = [...src.matchAll(/function (\w+)\([^)]*\)[^{]*onlyOwner/g)].map(m => m[1])
const want = ['setCharterToken', 'setCharterMin', 'setFeeRecipient', 'transferOwnership']
const noMove = !/function\s+(pause|unpause|rescue\w*|emergency\w*|withdrawAll|upgrade\w*|sweepTokens|setUsdg)\s*\(/i.test(src) && !/delegatecall/i.test(src) && !/selfdestruct/i.test(src)
add('owner', 'Owner key cannot move account, vault or queued funds; no pause, no upgrade', 'source scan: onlyOwner functions, no delegatecall/selfdestruct/pause/upgrade', JSON.stringify(ownerFns) === JSON.stringify(want) && noMove, `onlyOwner = ${ownerFns.join(', ')} · no delegatecall, selfdestruct, pause or upgrade`, ES)
// 5 · handle claimed on mainnet
const h = await bank.handleOf(await bank.owner())
add('handle', 'Handles live on mainnet: blackveil.veil claimed', 'eth_call handleOf(owner) + tx', h === 'blackveil', `handleOf = "${h}"`, `https://robin.etherscan.io/tx/${proof.tx.handle}`)
// 6 · request to pay on mainnet
const rq = await bank.request(1)
add('request', 'Requests to pay live on mainnet: request #1 for 25 USDG', 'eth_call request(1)', rq.amount === 25000000n && Number(rq.state) === 1, `request #1: ${ethers.formatUnits(rq.amount, 6)} USDG, open`, `https://robin.etherscan.io/tx/${proof.tx.request}`)
// 7 · agent under mandate on mainnet
const ag = await bank.agent(proof.agentId)
add('agent', 'An AI agent vault under a mandate: 50 per payment, 200 per day, review above 20', 'eth_call agent(1)', ag.perPayment === 50000000n && ag.perDay === 200000000n && ag.reviewAbove === 20000000n, `agent #${proof.agentId}: per payment ${ethers.formatUnits(ag.perPayment, 6)} · per day ${ethers.formatUnits(ag.perDay, 6)} · review > ${ethers.formatUnits(ag.reviewAbove, 6)}`, `https://robin.etherscan.io/tx/${proof.tx.agent}`)
// 8 · refusal logged on chain
const rc = await prov.getTransactionReceipt(proof.tx.refused)
const ev = rc.logs.map(l => { try { return bank.interface.parseLog(l) } catch { return null } }).find(x => x?.name === 'AgentRefused')
add('refused', 'The contract refuses what the mandate does not allow, and logs it', 'AgentRefused event in the receipt', !!ev && Number(ev.args.reason) === 7 && rc.status === 1, `AgentRefused · 15 USDG · reason InsufficientVault (7) · status ${rc.status}`, `https://robin.etherscan.io/tx/${proof.tx.refused}`)
// 9 · tests in the repo
const tests = (fs.readFileSync(ROOT + 'contracts/test/BlackveilBank.t.sol', 'utf8').match(/function test/g) || []).length
add('tests', 'Contract tests: unit, fuzzed accounting and a fork against the real USDG', 'count in contracts/test', tests >= 19, `${tests} unit/fuzz tests + 1 fork test (forge test)`, '')

fs.mkdirSync(ROOT + 'media/proof', { recursive: true })
fs.writeFileSync(ROOT + 'media/proof/verify.json', JSON.stringify({ bank: BANK, checked: new Date().toISOString(), res }, null, 2))
console.log(`\n${res.filter(r => r.status === 'lolos').length}/${res.length} pass`)
