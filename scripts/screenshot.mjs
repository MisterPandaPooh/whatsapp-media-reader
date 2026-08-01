// Regenerates the screenshots in docs/screenshots from the demo chat in
// scripts/demo-seed.js, so the README never has to show anyone's real export.
//
//   npm run dev                       # in another terminal
//   node scripts/screenshot.mjs http://localhost:5173
//
// Playwright is deliberately not a devDependency: it is a large install and
// only the screenshots need it. Run `npm i -D playwright` first, or use npx.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const URL = process.argv[2] || 'http://localhost:5173'
const OUT = process.argv[3] || 'docs/screenshots'
const seed = readFileSync(new URL('./demo-seed.js', import.meta.url), 'utf8')

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

await page.goto(URL)
console.log(await page.evaluate(seed))
await page.reload()

// Tiles load their thumbnails lazily, one object URL per tile as it intersects.
// Screenshotting on a timer catches half of them still blank, so wait for the
// count to stop climbing and for every image to have actually decoded.
async function tilesSettled() {
  let last = -1
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(
      () => [...document.querySelectorAll('.media-tile img')].filter((i) => i.complete && i.naturalWidth > 0).length,
    )
    if (n > 0 && n === last) return n
    last = n
    await page.waitForTimeout(500)
  }
  return last
}

await page.waitForSelector('.media-tile img', { timeout: 30000 })

// The grid is virtualized and a tile revokes its object URL when it unmounts,
// so rows that were never scrolled through can screenshot blank. Walk to the
// bottom and back to make every row load, then let the top settle again.
async function sweep() {
  const el = await page.$('.grid-scroll')
  if (!el) return
  await page.evaluate((e) => { e.scrollTop = e.scrollHeight }, el)
  await page.waitForTimeout(1500)
  await page.evaluate((e) => { e.scrollTop = 0 }, el)
  await page.waitForTimeout(1000)
}
await sweep()
console.log(`${await tilesSettled()} thumbnails decoded`)

await page.screenshot({ path: `${OUT}/grid.png` })
console.log('grid.png')

await page.getByRole('button', { name: 'the street we kept getting lost on', exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Jump to message' }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${OUT}/panel.png` })
console.log('panel.png')

await browser.close()
