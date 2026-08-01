# WhatsApp Media Reader

A reader for an exported WhatsApp group chat, inverted: **media is the index, the conversation is the detail view.** You browse what was sent, and use any file as a way back into its moment in the thread.

Everything happens in your browser. The export is never uploaded anywhere — there is no backend.

## Running it

```bash
npm install
npm run dev
```

Then open the printed URL (usually `http://localhost:5173`).

**Chrome, Edge, or another Chromium browser is required.** The app reads files straight off your disk using the File System Access API and stores extracted media in OPFS; Safari and Firefox don't support the pickers, and the app will say so rather than half-work.

## Getting an export out of WhatsApp

In WhatsApp: open the chat → tap the chat name → **Export Chat** → **Attach Media**. You'll get a `.zip`.

Drop that zip on the import screen. An already-unzipped folder works too — pick it with "Choose folder…" instead.

An export made *without* media still works: the messages and the timeline are all there, and the files that weren't included show as "Missing" tiles.

## Using it

- **Grid** — every media item in the export, newest first. Photos and videos show thumbnails; documents, voice notes and links get cards. Thumbnails load as you scroll, so a chat with thousands of files opens instantly.
- **Filters compose** — type, sender, date (presets or a calendar range), free-text search, and starred-only, with a live result count.
- **Click any tile** to open the conversation beside it: the real thread, 50 messages either side, scrolled to the highlighted message that carried the file. The grid stays where it was.
- **↑ / ↓ in the panel** step through the media you've currently filtered to — so the panel becomes a way to read the chat one artefact at a time.
- **Star** anything; stars survive a reload. So does the chat itself — reopen the tab and it's still there.
- **Double-click a photo or video** — in the grid or in the message feed — to open it fullscreen. Arrow keys move between items, Escape or a click outside closes.
- **"Import chat…"** in the header swaps in a different export. Importing replaces the current chat.
- **"Close chat"** goes back to the drop screen and clears the export from the browser: the stored record, your stars, and — for a zip import — the unpacked media. Your own files are never touched, so a folder import only loses the reader's record of it.

## Feature flags

Optional features are off by default and switched on from the browser console. Set the key, then reload.

```js
localStorage.setItem('wmr.flag.occasions', 'on')
```

| Key | What it turns on |
| --- | --- |
| `wmr.flag.occasions` | The **Occasion** pickers in the DATE popover — jump the date filter to Pessah, Souccot, Hanouka, Été or Hiver, for one year or all of them. |

`'on'`, `'1'`, `'true'`, `'yes'` and `'enabled'` all count as on; anything else, including an absent key, is off.

### Supplying your own occasions

The occasion list is data, not code. Set `wmr.data.occasions` to replace it — useful for a different calendar, a different language, or years past the built-in table (which runs 2020–2026).

```js
localStorage.setItem('wmr.data.occasions', JSON.stringify({
  padDays: 3,
  occasions: [
    // A dated occasion: exact days, because the Hebrew calendar cannot be
    // derived from the Gregorian one. `end` may fall in the next year.
    { id: 'noel', label: 'Noël', dates: [
      { year: 2025, start: '2025-12-24', end: '2025-12-25' },
    ]},
    // A season: the same MM-DD window every year. A day past the end of the
    // month is clamped, so '02-29' means "end of February" in any year.
    { id: 'printemps', label: 'Printemps', season: { from: '03-01', to: '05-31' } },
  ],
}))
```

- `padDays` widens every **dated** occasion by that many days on each side — the travelling, the cooking the day before, the drive home. Seasons are already approximate and are never padded. Defaults to 3.
- The year dropdown is built from the years your dated occasions mention, unless you give an explicit `years: [...]`.
- A malformed value is ignored: the built-in list is used and a warning is logged, so a typo cannot break the toolbar.

## Commands

```bash
npm run dev      # dev server
npm test         # test suite
npm run build    # typecheck + production build
npm run lint     # oxlint
```

Note: use `npx tsc -b` to typecheck, not `tsc --noEmit`. The root `tsconfig.json` is a solution file with no `files`, so the `--noEmit` form silently checks nothing.

## How it fits together

```
src/
  parser/      _chat.txt → messages + media items
               dateFormats      regional date/time prefixes (US, EU, ISO, German, iOS bracketed, …)
               mediaIndicators  attachment markers, media kinds, system-message detection
               chatParser       line walker: message boundaries, multiline joins, media linking
               id               deterministic message ids, stable across re-imports
  worker/      import runs off the main thread so the UI never freezes
               unzipStreaming   streaming unzip (one file in memory at a time, not the whole archive)
               zipExtract       writes media into OPFS as it decompresses
               mediaCatalog     reconciles referenced filenames against what is actually on disk
               importWorker     orchestrates zip vs. folder import, reports progress
  storage/     db, chatRepository (IndexedDB), fileAccess (OPFS + directory handles behind one interface)
  store/       Zustand state; selectors for filtering and the ±50 thread window
  components/  Header, ImportScreen, Grid, Toolbar, Panel
```

Three decisions worth knowing:

**Zip and folder imports converge.** A zip is streamed into OPFS; a picked folder is used in place. After that, everything reads through one `FileSystemDirectoryHandle`-shaped interface and never needs to know which it was.

**Message ids are content hashes**, not array positions. That is what lets stars and "jump to message" survive re-importing the same export.

**Filename matching is deliberately forgiving.** Export zips and filesystems disagree about filenames more than you would expect — macOS stores them decomposed (NFD) while transcripts spell them composed (NFC), and Finder's "Compress" writes UTF-8 names without setting the zip's UTF-8 flag. Both are reconciled before a file is declared missing, because "a file you know you sent shows as Missing" is the failure mode that makes a tool like this untrustworthy.

## Known gaps

- Video tiles have no duration badge and voice notes have no waveform — the design calls for both, but duration is never extracted from the media.
- The import summary is a plain line of counts; the design has a stats grid, a type-breakdown bar and participant chips.
- Search covers captions, filenames and senders. It does not find a media item by the text of a *neighbouring* message.
- One chat at a time — importing replaces what is loaded.
