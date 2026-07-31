# WhatsApp Media Reader — Design Spec

Date: 2026-07-31

## Purpose

A reader for an exported WhatsApp group chat, inverted: media is the primary index, the conversation is the detail view. You browse what was sent, not what was said, and use any file as an entry point back into its moment in the thread.

## Input

A WhatsApp chat export (`_chat.txt` + attachment files), supplied either as a `.zip` archive or an already-unzipped folder. Parsed locally in the browser into participants, messages, and media items linked to their originating message. Nothing is uploaded anywhere.

## Core objects

```ts
interface Message {
  id: string;            // deterministic hash — stable across re-parses
  sender: string;
  timestamp: Date;
  text: string;
  mediaId?: string;       // present if this message carries a media item
  isSystemMessage: boolean;
}

interface MediaItem {
  id: string;
  kind: 'photo' | 'video' | 'doc' | 'voice' | 'link';
  filename: string;
  size: number;           // bytes; for links, N/A
  caption: string;        // message text associated with the item
  sender: string;
  timestamp: Date;
  anchorMessageId: string;
  starred: boolean;
  durationSec?: number;   // video/voice
}
```

## Stack & architecture

- **Vite + React 18 + TypeScript.** Pure client-side SPA — no backend. `npm run dev` for local use; `vite build` produces a static bundle if ever hosted.
- **Zustand** for global UI state: active filters, selected/active media id, panel open state, starred set.
- **`idb`** (thin IndexedDB wrapper) for persistence: parsed messages, media index, participants, starred flags, "me" participant, and the chat's storage reference.
- **`fflate`** for zip decompression, run inside a Web Worker.
- **`@tanstack/react-virtual`** for virtualizing both the media grid and the conversation panel's message list.
- **Browser support:** Chromium only (Chrome/Edge/Opera/Arc) — the app depends on the File System Access API and OPFS (`navigator.storage.getDirectory()`). No fallback for Safari/Firefox; unsupported browsers see a static explanatory message at the import screen instead of the drop zone.

## Parser

A `parser/` module structured after (and directly inspired by) [rodrigogs/whats-reader](https://github.com/rodrigogs/whats-reader/blob/dev/src/lib/parser/):

- **Date formats:** regex table covering US 12h (`MM/DD/YY, H:MM AM/PM -`), EU/BR 24h (`DD/MM/YY, H:MM -`), ISO (`YYYY-MM-DD, H:MM -`), German dot format (`DD.MM.YY, H:MM -`), dash format (`DD-MM-YY, H:MM -`), Asian slash format, and iOS bracketed (`[DD/MM/YY, H:MM:SS AM/PM]`). Matched in order, most-specific first, same as the reference.
- **Media detection:** multi-language "media omitted" / "file attached" indicator list (reused from the reference's table) plus filename-in-text extraction (`<attached: name.ext>` or `name.ext (file attached)` patterns) — the filename is read directly out of the message text and matched by exact name against the catalogued media files. No timestamp-proximity guessing.
- **System messages:** multi-language indicator list (group created/added/removed/left/subject changed/encryption notice, etc.) — these are excluded from the participant list and rendered as centered system lines rather than bubbles.
- **Multiline messages:** a line that doesn't match any date pattern is appended to the previous message's text (handles line breaks within a single WhatsApp message).
- **Deterministic IDs:** djb2-style hash of `chatId|timestamp|sender|content`, with counter-suffix collision resolution — same message always gets the same id across re-parses, which is required for stored starred/anchor references and "jump to message" to survive a reload.
- Runs entirely inside a Web Worker so a multi-year `_chat.txt` never blocks the main thread.

## Import & storage flow

1. User drops or picks either a `.zip` file or a folder (`showDirectoryPicker`) containing `_chat.txt` + media.
2. All extraction/parsing happens in a **Web Worker**:
   - **Zip path:** `fflate` streams entries. `_chat.txt` (small) is parsed immediately. Every media entry is written into a fresh OPFS subfolder (`navigator.storage.getDirectory()`), named per-chat (e.g. a hash of the zip filename + size).
   - **Folder path:** the picked `FileSystemDirectoryHandle` is used directly — media is never copied.
   - Either path converges on the same interface after import: "a directory handle you can call `getFileHandle(name)` against." The rest of the app never distinguishes zip-origin from folder-origin chats again.
   - The worker posts progress events `{stage: 'reading' | 'extracting' | 'parsing', progress: 0-100}` which drive the import screen's progress UI.
3. Result written to IndexedDB: parsed messages array, media index array, participants list, and the storage reference (a serialized `FileSystemDirectoryHandle` for folder imports — these are structured-cloneable — or the OPFS subfolder name for zip imports).
4. **"Who is me?"** — WhatsApp exports don't mark which participant is the export owner. On first import, the summary screen includes a one-time picker ("Which participant are you?") defaulting to no selection; the choice is stored with the chat and drives right-alignment/bubble color for that participant's messages. If skipped, no message is right-aligned (all bubbles left-aligned, differentiated by sender name/color only).
5. **Reload behavior:** the app loads the most recent chat from IndexedDB automatically.
   - Folder-backed chats: re-request permission on the stored handle (`handle.requestPermission()`), a single user click, before the grid can read files. If the user denies or the handle is no longer valid, show the chat as "needs permission" on the import screen rather than failing silently.
   - OPFS-backed (zip-origin) chats: no permission prompt needed — reopens straight into the grid.
6. Importing a new chat replaces the previous one (single-chat app, matching "Import another" in the design).

## Media grid

- `@tanstack/react-virtual` windows the tile grid so only rows near the viewport are mounted — required for chats with thousands of media items.
- Square tiles (`aspect-ratio: 1`), newest-first by default.
- Each mounted tile lazy-loads its own thumbnail via an `IntersectionObserver`-backed hook: on becoming visible, `dirHandle.getFileHandle(name)` → `file.getFile()` → `URL.createObjectURL()` (revoked on unmount/scroll-out). Photos/videos show a placeholder pattern until the blob resolves; docs/voice/link cards render immediately from metadata alone since they need no bytes. Nothing about this blocks initial grid paint.
- Photos/videos: thumbnail + caption/sender/date overlay; video shows duration badge.
- Docs/voice/links: card layout — type badge, size, filename, sender, date; voice notes additionally show a waveform (derived from decoded audio peaks, computed lazily) and duration.
- Every tile has an inline star toggle — optimistic update to the Zustand store, persisted to IndexedDB (debounced).
- Missing-media placeholder state for exports taken "without media" (message references a file that isn't in the export).

## Filters & search

All filters live in the Zustand store and compose via predicate intersection over the in-memory media index (metadata only, not blobs — cheap to filter):

- **Type:** multi-select (photo/video/doc/voice/link); none selected = all.
- **Sender:** multi-select participant popover — search box, sorted by media volume descending, per-person counts and a relative volume bar. Scales to large groups via the search box.
- **Date:** range picker spanning the export's date range, with presets — All time, Last 7 days, Last 30 days, This month (matches the mockup's 4-item preset list) — and a per-day media-volume indicator (dot) on the calendar.
- **Search:** free text, matched against message body, caption, filename, and sender name — runs across the *entire* parsed dataset, not just what's currently rendered. Uses `useDeferredValue` around the query so typing stays smooth without an artificial debounce delay.
- **Starred-only** toggle.
- Live result count shown next to "Media" heading. "Reset filters" control appears only when at least one filter is active.

## Detail panel

- Clicking a tile sets `activeMediaId` in the store. The grid stays mounted and scrolled where it was; the selected tile shows a selected outline. A right panel (448px fixed width) opens alongside — no lightbox, no route change.
- **Header:** thumbnail/preview, filename, sender, timestamp, size; actions — star toggle, download, "jump to message" (scrolls the conversation body back to the anchor and re-triggers its highlight flash — useful after the user has scrolled elsewhere in the ±50 window).
- **Body:** the real conversation — a synchronous slice of ±50 messages around the anchor from the already-in-memory parsed messages array (no worker round-trip; this is what makes "preload ±50 on open" free). Virtualized with `react-virtual`. Day separators between date groups. Sender name + per-sender color on each bubble; the "me" participant's messages are right-aligned (see "Who is me?" above). The anchor message is visually marked with a left accent-bar highlight, and the panel auto-scrolls to it on open.
- **Prev/next:** steps `activeMediaId` through the *currently filtered* media list (respecting active type/sender/date/search/starred filters), each step re-slicing a fresh ±50 window around the new anchor. Position indicator shows "N of M" against the filtered set's size.

## Visual design

Implemented from the imported Claude Design project (`Media Reader.dc.html` / `support.js`, project `6799f3ee-27cd-4534-a360-56cb4cf15bbf`):

- **Palette:** app background `#f4f4f3`; header/toolbar `#fbfbfa`; borders `rgba(0,0,0,.08–.14)`; primary text `#17181a`; secondary text `#82858a`/`#9a9da1`; accent `oklch(0.55 0.13 250)` for active states, progress bar, and anchor highlight.
- **Type:** `system-ui` (sans) for names/labels/body copy; `ui-monospace, Menlo` for metadata (counts, sizes, timestamps, filenames) — this split is used consistently throughout, including in the implementation.
- **Import flow (full-screen overlay):** drag-drop card (with "how to export" steps + supported-format chips) → parsing-progress card (progress bar + step checklist — this is the "loader for parsing time") → summary card (parsed-in-Ns / date range, stats grid, media-type breakdown bar, participant chips with initial avatars, the "who is me?" picker, "Import another" / "Open media reader" actions).
- **Toolbar:** segmented type-filter chips; FROM people popover (search, volume bars, counts, Done/All/None); DATE popover (preset list + month calendar with per-day dots); starred toggle with count; "Reset filters" (conditional).
- **Grid tiles:** as described under Media grid, with the specific visual treatment from the mockup (diagonal-stripe placeholder, bottom gradient overlay for captions, star toggle bottom-right, video duration badge top-right, doc/voice card layout with type-badge + waveform).
- **Detail panel:** exact layout from the mockup — header with position indicator + prev/next/close, preview card with actions, message thread on `#f4f4f3` background with day pills and bubble styling matching WhatsApp conventions (own messages right-aligned, background differentiated from others').

## Error handling & edge cases

- No `_chat.txt` found in the zip/folder → inline error explaining likely export mistake (mirrors the guidance style of the reference parser's error message).
- Export taken "without media" → media-referencing messages still parse; their tiles render the missing-media placeholder instead of a thumbnail.
- Non-Chromium browser → static explanatory message at the import screen; drop zone not shown.
- Folder permission denied/revoked on reload → chat shown as "needs permission" on the import screen instead of a silent failure or crash.
- Corrupt/partial zip → surfaced as an import error with the underlying `fflate` failure reason.

## Testing

- **Unit tests (Vitest)** for the parser module against fixture `_chat.txt` samples covering each supported date format, multiline messages, system messages, and media-indicator variants — this is the highest-value, most logic-dense surface.
- **Manual browser verification** (Chrome, via the Vite dev server) for the import flow (both zip and folder paths), grid virtualization and lazy thumbnail loading, each filter individually and in combination, search, and the detail panel (open/close, prev/next across a filtered set, anchor highlight/scroll, star persistence across reload). Driven directly rather than left unverified, per standard workflow.

## Out of scope

- Multi-chat management (switching between several imported chats) — importing a new chat replaces the current one.
- Non-Chromium browser support.
- Any server-side component, sync, or sharing between devices.
- Editing/deleting messages or media (read-only reader).
- The mockup's "Export selection" header button — not part of the original functional spec; omitted to avoid building an undefined feature (YAGNI). Only "Download" (single item, from the detail panel) is implemented.
