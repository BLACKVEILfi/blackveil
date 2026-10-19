// Real mainnet evidence that costs only gas (no USDG): from the bank owner key, claim the house handle, post a request
// to pay, open an agent under a mandate, then let the agent ask to pay from an empty vault → the contract refuses and logs it.
//   node tools/proof-tx.mjs          dry run (balances, plan)
//   node tools/proof-tx.mjs --go     send; results → media/proof/proof-tx.json
// Keys: ~/.config/blackveil/deployer.json (owner) and ~/.config/blackveil/agent-proof.json (created here). Never printed.
import fs from 'node:fs'
import { homedir } from 'node:os'
import { ethers } from 'ethers'

const ROOT = new URL('..', import.meta.url).pathname
const GO = process.argv.includes('--go')
const prov = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://robinhood-rpc.publicnode.com', 4663, { staticNetwork: true, cacheTimeout: -1 })
const cfgSrc = fs.readFileSync(ROOT + 'public/config.js', 'utf8')
const BANK = cfgSrc.match(/bank:\s*'(0x[0-9a-fA-F]{40})'/)[1]
const abi = JSON.parse(fs.readFileSync(ROOT + 'public/abi/BlackveilBank.json', 'utf8'))
const owner = new ethers.NonceManager(new ethers.Wallet(JSON.parse(fs.readFileSync(homedir() + '/.config/blackveil/deployer.json', 'utf8')).privateKey, prov))
const agentFile = homedir() + '/.config/blackveil/agent-proof.json'
if (!fs.existsSync(agentFile)) { const w = ethers.Wallet.createRandom(); fs.writeFileSync(agentFile, JSON.stringify({ address: w.address, privateKey: w.privateKey, purpose: 'BLACKVEIL proof agent key' }, null, 2), { mode: 0o600 }) }
const agentW = new ethers.Wallet(JSON.parse(fs.readFileSync(agentFile, 'utf8')).privateKey, prov)
const bank = new ethers.Contract(BANK, abi, owner)
const me = await owner.getAddress()
const U = x => ethers.parseUnits(String(x), 6)
console.log(`bank ${BANK} · owner ${me} · ${ethers.formatEther(await prov.getBalance(me))} ETH · agent key ${agentW.address}`)
console.log(`now: handle "${await bank.handleOf(me)}" · agents ${await bank.agentCount()} · requests ${await bank.requestCount()}`)
if (!GO) { console.log('plan: setHandle("blackveil") · createRequest(25 USDG, "first request") · createAgent(agentKey, 50/200/20) · gas to agent · agentPay(15) → refused (empty vault)'); process.exit(0) }

const out = { bank, at: new Date().toISOString(), tx: {} }; out.bank = BANK
const run = async (k, p) => { const r = await (await p).wait(); out.tx[k] = r.hash; console.log(`✓ ${k.padEnd(10)} ${r.hash}`); return r }
if (!(await bank.handleOf(me))) await run('handle', bank.setHandle('blackveil'))
const rq = await run('request', bank.createRequest(U(25), 0, ethers.encodeBytes32String('first request')))
const agentRc = await run('agent', bank.createAgent(agentW.address, U(50), U(200), U(20), false))
const id = bank.interface.parseLog(agentRc.logs.find(l => { try { return bank.interface.parseLog(l).name === 'AgentCreated' } catch { return false } })).args.id
out.agentId = Number(id)
await run('gas', owner.sendTransaction({ to: agentW.address, value: ethers.parseEther('0.00005') }))
const route = await bank.routeFor(id, me, U(15))
console.log(`routeFor(agent ${id}, 15 USDG) = route ${route[0]} reason ${route[1]} (2/7 = Refuses/InsufficientVault expected)`)
const rr = await run('refused', bank.connect(agentW).agentPay(id, me, U(15), ethers.encodeBytes32String('cloud bill'), false))
const ev = rr.logs.map(l => { try { return bank.interface.parseLog(l) } catch { return null } }).find(x => x?.name === 'AgentRefused')
out.refusedReason = ev ? Number(ev.args.reason) : null
console.log('AgentRefused reason', out.refusedReason)
fs.mkdirSync(ROOT + 'media/proof', { recursive: true })
fs.writeFileSync(ROOT + 'media/proof/proof-tx.json', JSON.stringify(out, null, 2))
console.log('owner left', ethers.formatEther(await prov.getBalance(me)), 'ETH')
