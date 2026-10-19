// Rebuild check: compares the runtime bytecode compiled from this repository with the code deployed on chain.
// Immutable slots (the USDG address) are filled in from the chain before comparing; everything else, including the
// metadata hash at the end, must match byte for byte.
//   cd contracts && forge build && cd .. && node tools/compare-bytecode.mjs [address]
import fs from 'node:fs'
import { ethers } from 'ethers'

const ROOT = new URL('..', import.meta.url).pathname
const cfg = fs.readFileSync(ROOT + 'public/config.js', 'utf8')
const ADDR = process.argv[2] || cfg.match(/bank:\s*'(0x[0-9a-fA-F]{40})'/)[1]
const RPC = process.env.RPC_URL || 'https://robinhood-rpc.publicnode.com'
const art = JSON.parse(fs.readFileSync(ROOT + 'contracts/out/BlackveilBank.sol/BlackveilBank.json', 'utf8'))
const prov = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true })

const onchain = (await prov.getCode(ADDR)).slice(2).toLowerCase()
let local = art.deployedBytecode.object.replace(/^0x/, '').toLowerCase()
const refs = art.deployedBytecode.immutableReferences || {}
const usdg = await new ethers.Contract(ADDR, ['function usdg() view returns (address)'], prov).usdg()
const want = usdg.slice(2).toLowerCase().padStart(64, '0')
let filled = 0
for (const list of Object.values(refs)) for (const { start, length } of list) {
  const a = start * 2, b = a + length * 2
  // the only immutable is the settlement token: every slot must hold exactly usdg()
  if (onchain.slice(a, b) !== want) { console.log('✗ immutable slot at byte', start, 'is not usdg()'); process.exit(1) }
  local = local.slice(0, a) + onchain.slice(a, b) + local.slice(b)
  filled++
}
console.log(`contract      ${ADDR} (chain 4663)`)
console.log(`on-chain code ${onchain.length / 2} bytes · local build ${local.length / 2} bytes · ${filled} immutable slot(s) filled (usdg = ${usdg})`)
const same = local === onchain
console.log(same ? '✓ runtime bytecode matches this repository byte for byte' : '✗ bytecode differs — check the compiler settings in contracts/foundry.toml')
process.exit(same ? 0 : 1)
