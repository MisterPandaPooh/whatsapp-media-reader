# Contributing

Thanks for looking. This is a small, focused app and contributions are welcome — bug reports especially, since the interesting bugs here all come from real-world exports that nobody anticipated.

## The one rule: never commit real chat data

This tool exists to read private conversations. That makes the usual "just paste the failing input into a test" instinct dangerous, because the failing input is somebody's family group chat.

**Every fixture in this repo is invented** — the names, the messages, the filenames, the phone numbers. Keep it that way:

- Do not paste lines from a real export into a test, an issue, or a pull request — not even one line, not even "just the timestamps."
- Do not attach a real export, a real photo, or a screenshot of a real conversation.
- When you hit a parser bug in your own export, reproduce it with **invented text that has the same shape**: same date format, same invisible characters, same attachment marker, different people and different words. That is what every parser test in `src/parser/` already does.
- Phone numbers in fixtures use the reserved `+1 (212) 555-01xx` range.

If you need to show what a line looks like, describe the structure (`[dd/mm/yyyy, hh:mm:ss] <sender>: U+200E<attached: …>`) rather than quoting the real thing.

A history rewrite is the only way to remove data once it is pushed. It is much easier not to commit it.

## Getting set up

```bash
npm install
npm run dev
```

Any browser with the origin private file system will run the app: Chrome, Edge, Brave, Arc, Opera, Safari 15.2+ or Firefox 111+. Opening an unzipped folder in place additionally needs the File System Access directory picker, which is Chromium-only today, so develop that path in a Chromium browser.

You do not need a real export to develop against. Paste [`scripts/demo-seed.js`](scripts/demo-seed.js) into the DevTools console and reload: it writes an invented chat straight into OPFS and IndexedDB, in the same shape the import worker produces. Clear it again with Application → Storage → Clear site data.

## Before you open a pull request

```bash
npm test         # the full suite, should be green
npm run lint     # oxlint
npm run build    # tsc -b + vite build
```

Use `npx tsc -b` if you want a typecheck on its own. Not `tsc --noEmit`: the root `tsconfig.json` is a solution file with no `files`, so that form silently checks nothing and reports success.

## How the tests are organised

Tests sit next to what they test. The ones worth knowing about:

- `src/parser/*.test.ts` — the transcript formats. Most bugs live here, and most fixes belong here first: write the failing line, then fix the parser.
- `src/worker/*.test.ts` — zip streaming, OPFS extraction, and reconciling transcript filenames against what is actually on disk (NFC/NFD, mis-flagged UTF-8, `__MACOSX` entries). `src/worker/fixtures/macos-ditto-export.zip` is a synthetic archive built to exercise exactly those cases.
- `src/storage/*.test.ts` — IndexedDB persistence and the re-parse-on-version-bump path, against `fake-indexeddb`.
- Component tests use Testing Library and assert on roles and accessible names rather than class names.
- Capability checks are per-feature, not per-browser. `showDirectoryPicker` gates only the folder button; OPFS gates the app. Do not collapse them back into one check — that is what shut Safari and Firefox out of zip import.

## Changing the parser

Parsing happens once, at import, and the result is stored. So a parser fix does not reach a chat that is already loaded — it would keep rendering the old, wrong result forever.

If your change makes the parser produce different output for the same transcript, **bump `PARSER_VERSION` in `src/parser/version.ts`** and add a line to the changelog comment above it. Stored chats with an older version are re-parsed from their transcript on load.

## Style

- No formatter is enforced; match the file you are editing.
- Comments explain *why*, not *what*. The existing ones are a good guide: they mostly record which real-world weirdness a piece of code is defending against.
- Prefer a test that documents the weirdness over a comment describing it.

## Reporting a bug

Include your browser and version, whether the export came from iOS or Android, whether it was a zip or a folder, and — described, not pasted — the shape of the lines that go wrong. Screenshots are welcome as long as no real conversation is visible in them.
