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
await page.evaluate(seed)
await page.reload()
await page.waitForSelector('.media-tile img', { timeout: 15000 })
// Tiles load their thumbnails lazily; give the last of them time to decode.
await page.waitForTimeout(2500)

await page.screenshot({ path: `${OUT}/grid.png` })
console.log('grid.png')

await page.getByRole('button', { name: 'tiles all the way up', exact: true }).first().click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Jump to message' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/panel.png` })
console.log('panel.png')

await browser.close()
