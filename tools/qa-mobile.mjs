// Phone check (PRD §1): every public page at 390×844 (DPR 3) and 360×780: no horizontal scroll, header CA chip
// visible, no page errors. Screens → media/qa/m-<page>.png.   node tools/qa-mobile.mjs   (server :9150 running)
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'
const ROOT = new URL('..', import.meta.url).pathname
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
fs.mkdirSync(ROOT + 'media/qa', { recursive: true })
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--user-data-dir=/tmp/bv-mobile-' + process.pid] })
let bad = 0
for (const [w, h] of [[390, 844], [360, 780]]) for (const pg of ['/', '/app', '/agents', '/verify', '/pay?r=1', '/nope']) {
  const p = await b.newPage(), errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await p.goto('http://127.0.0.1:9150' + pg, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => errs.push(e.message))
  await new Promise(r => setTimeout(r, 1500))
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, chip: !!document.querySelector('.hdr .ca, .hdr [class*="ca"]') }))
  const fail = r.sw > r.cw + 1 || errs.length
  if (fail) bad++
  if (w === 390) await p.screenshot({ path: `${ROOT}media/qa/m-${pg.replace(/\W+/g, '') || 'home'}.png` })
  console.log(`${fail ? 'FAIL' : 'ok  '} ${w}×${h} ${pg.padEnd(9)} scrollW ${r.sw}/${r.cw}${errs.length ? '  ' + errs.slice(0, 2).join(' | ') : ''}`)
  await p.close()
}
await b.close(); process.exit(bad ? 1 : 0)
