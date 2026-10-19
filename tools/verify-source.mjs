// Publishes the BlackveilBank source for the deployed address: Sourcify (exact metadata match) and Blockscout
// (standard JSON input, sent from inside a Blockscout page because its API sits behind Cloudflare).
//   node tools/verify-source.mjs            (address from public/config.js)
//   node tools/verify-source.mjs 0x…
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const ROOT = new URL('..', import.meta.url).pathname
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const EX = 'https://robinhoodchain.blockscout.com'
const cfg = fs.readFileSync(ROOT + 'public/config.js', 'utf8')
const ADDR = process.argv[2] || (cfg.match(/bank:\s*'(0x[0-9a-fA-F]{40})'/) || [])[1]
if (!ADDR) { console.log('no contract address'); process.exit(1) }

const out = JSON.parse(fs.readFileSync(ROOT + 'contracts/out/BlackveilBank.sol/BlackveilBank.json', 'utf8'))
const metadata = out.rawMetadata
const meta = JSON.parse(metadata)
const source = fs.readFileSync(ROOT + 'contracts/src/BlackveilBank.sol', 'utf8')
console.log(`BlackveilBank ${ADDR} · solc ${meta.compiler.version}`)

// 1) Sourcify
try {
  const r = await fetch('https://sourcify.dev/server/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: ADDR, chain: '4663', files: { 'metadata.json': metadata, 'src/BlackveilBank.sol': source } }),
  })
  const j = await r.json()
  console.log('sourcify:', r.status, JSON.stringify(j.result?.[0] || j).slice(0, 300))
} catch (e) { console.log('sourcify failed:', e.message) }

// 2) Blockscout, standard JSON input from forge
const std = execFileSync('forge', ['verify-contract', '--show-standard-json-input', ADDR, 'src/BlackveilBank.sol:BlackveilBank'], { cwd: ROOT + 'contracts', encoding: 'utf8', maxBuffer: 1 << 26 })
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--user-data-dir=/tmp/blackveil-verify-' + process.pid] })
try {
  const page = await b.newPage()
  await page.goto(`${EX}/address/${ADDR}`, { waitUntil: 'networkidle2', timeout: 120000 })
  const res = await page.evaluate(async ({ addr, std, ver }) => {
    const fd = new FormData()
    fd.append('compiler_version', 'v' + ver)
    fd.append('license_type', 'mit')
    fd.append('contract_name', 'BlackveilBank')
    fd.append('autodetect_constructor_args', 'true')
    fd.append('files[0]', new Blob([std], { type: 'application/json' }), 'standard-input.json')
    const r = await fetch(`/api/v2/smart-contracts/${addr}/verification/via/standard-input`, { method: 'POST', body: fd })
    return { status: r.status, text: (await r.text()).slice(0, 400) }
  }, { addr: ADDR, std, ver: meta.compiler.version })
  console.log('blockscout submit:', res.status, res.text)
  // poll until Blockscout shows it verified
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const s = await page.evaluate(async (addr) => { const r = await fetch(`/api/v2/smart-contracts/${addr}`); return r.ok ? r.json() : null }, ADDR)
    if (s?.is_verified || s?.is_fully_verified) { console.log(`blockscout: verified (${s.is_fully_verified ? 'full' : 'partial'} match) · ${EX}/address/${ADDR}?tab=contract`); break }
    if (i === 23) console.log('blockscout: not verified yet, check', `${EX}/address/${ADDR}?tab=contract`)
  }
} finally { await b.close() }
const sc = await fetch(`https://sourcify.dev/server/v2/contract/4663/${ADDR}`).then((r) => r.json()).catch(() => null)
console.log('sourcify status:', sc?.match || sc?.runtimeMatch || JSON.stringify(sc).slice(0, 160), `· https://repo.sourcify.dev/4663/${ADDR}`)
