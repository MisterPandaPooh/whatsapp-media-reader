<div align="center">

# WhatsApp Media Reader

**A reader for an exported WhatsApp chat, inverted: the media is the index, the conversation is the detail view.**

You browse what was sent, and use any file as a way back into its moment in the thread.

[![CI](https://github.com/MisterPandaPooh/whatsapp-media-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/MisterPandaPooh/whatsapp-media-reader/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Chromium required](https://img.shields.io/badge/browser-Chromium-4285F4)
![No backend](https://img.shields.io/badge/backend-none-success)

**[Open the latest release →](https://misterpandapooh.github.io/whatsapp-media-reader/)**

</div>

![The media grid: every photo, video, document, voice note and link in the export, newest first, with filters across the top](docs/screenshots/grid.png)

## Everything stays on your machine

There is no backend, no upload, no analytics, no network call of any kind. The app reads the export off your disk with the File System Access API, keeps extracted media in OPFS and the parsed chat in IndexedDB, and that is the whole data path. Close the tab and it is still yours; clear site data and it is gone.

## Running it

The [hosted build](https://misterpandapooh.github.io/whatsapp-media-reader/) is the latest release and needs no install — it is the same static app, and your export still never leaves your machine. To run it locally:

```bash
npm install
npm run dev
```

Then open the printed URL (usually `http://localhost:5173`).

**Chrome, Edge, or another Chromium browser is required.** Safari and Firefox don't implement the file and directory pickers this depends on, and the app says so plainly rather than half-working.

> **Just want to look around?** Paste [`scripts/demo-seed.js`](scripts/demo-seed.js) into the DevTools console and reload. It loads an invented chat with generated thumbnails — no export needed. It is also what produces the screenshots on this page.

## Getting an export out of WhatsApp

In WhatsApp: open the chat → tap the chat name → **Export Chat** → **Attach Media**. You'll get a `.zip`.

Drop that zip on the import screen. An already-unzipped folder works too — pick it with **Choose folder…** instead.

An export made *without* media still works: the messages and the timeline are all there, and the files that weren't included show as **Missing** tiles rather than disappearing.

## Using it

![The detail panel open beside the grid, showing the thread with the message that carried the selected photo highlighted](docs/screenshots/panel.png)

- **Grid** — every media item in the export, newest first. Photos and videos show thumbnails; documents, voice notes and links get cards. Thumbnails load as you scroll, so a chat with thousands of files opens instantly.
- **Filters compose** — type, sender, date (presets or a calendar range), free-text search, and starred-only, with a live result count.
- **Click any tile** to open the conversation beside it: the real thread, 50 messages either side, with the message that carried the file highlighted. The grid stays where it was.
- **↑ / ↓ in the panel** step through the media you've currently filtered to — so the panel becomes a way to read the chat one artefact at a time.
- **Double-click a photo or video** for the fullscreen lightbox, which pages through the same filtered set.
- **Star** anything; stars survive a reload. So does the chat itself — reopen the tab and it's still there.
- **Import chat…** in the header swaps in a different export; **Close chat** clears it and returns you to the drop screen. Importing replaces the current chat.

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
               bidi             the invisible format characters WhatsApp writes into every line
               id               deterministic message ids, stable across re-imports
  worker/      import runs off the main thread so the UI never freezes
               unzipStreaming   streaming unzip (one file in memory at a time, not the whole archive)
               zipExtract       writes media into OPFS as it decompresses
               mediaCatalog     reconciles referenced filenames against what is actually on disk
               importWorker     orchestrates zip vs. folder import, reports progress
  storage/     db, chatRepository (IndexedDB), fileAccess (OPFS + directory handles behind one interface)
  store/       Zustand state; selectors for filtering and the ±50 thread window
  components/  Header, ImportScreen, Grid, Toolbar, Panel, Gallery
scripts/       demo-seed.js (invented chat for development), screenshot.mjs
```

Four decisions worth knowing:

**Zip and folder imports converge.** A zip is streamed into OPFS; a picked folder is used in place. After that, everything reads through one `FileSystemDirectoryHandle`-shaped interface and never needs to know which it was.

**Message ids are content hashes**, not array positions. That is what lets stars and "jump to message" survive re-importing the same export.

**The parser is versioned.** Parsing happens once, at import, so a parser fix would otherwise only ever reach *new* imports while an already-loaded chat kept rendering the old, wrong result. Every stored chat records the parser build that produced it, and is silently re-parsed when that build is out of date.

**Filename matching is deliberately forgiving.** Export zips and filesystems disagree about filenames more than you would expect — macOS stores them decomposed (NFD) while transcripts spell them composed (NFC), and Finder's "Compress" writes UTF-8 names without setting the zip's UTF-8 flag. Both are reconciled before a file is declared missing, because "a file you know you sent shows as Missing" is the failure mode that makes a tool like this untrustworthy.

## Known gaps

- Video tiles have no duration badge and voice notes have no waveform — the design calls for both, but duration is never extracted from the media.
- Opening a tile does not reliably land the thread on the highlighted message; thumbnails loading underneath can push it out of view. **Jump to message** always gets you there.
- The fullscreen lightbox draws its title over the image counter in the top-left corner.
- The import summary is a plain line of counts; the design has a stats grid, a type-breakdown bar and participant chips.
- Search covers captions, filenames and senders. It does not find a media item by the text of a *neighbouring* message.
- One chat at a time — importing replaces what is loaded.

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). One rule above all others: **never commit anything from a real export.** The fixtures in this repo are invented, and they need to stay that way.

## License

[MIT](LICENSE)
