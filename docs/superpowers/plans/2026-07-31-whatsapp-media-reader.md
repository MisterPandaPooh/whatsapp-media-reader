# WhatsApp Media Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-only React app that imports a WhatsApp chat export (zip or unzipped folder), parses it locally, and presents a media-first grid with filters, search, and a conversation detail panel.

**Architecture:** Vite + React + TypeScript SPA, no backend. A Web Worker parses `_chat.txt` and (for zips) extracts media into OPFS via `fflate`, so both import paths converge on one `FileSystemDirectoryHandle`-like read interface. Zustand holds UI/filter state; IndexedDB (`idb`) persists the parsed chat, media index, and starred flags across reloads. `@tanstack/react-virtual` windows both the media grid and the detail panel's message thread; thumbnails lazy-load per-tile via `IntersectionObserver`.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, idb, fflate, @tanstack/react-virtual, Vitest + fake-indexeddb for tests.

Spec: `docs/superpowers/specs/2026-07-31-whatsapp-media-reader-design.md`

---

## File structure (final state)

```
package.json, vite.config.ts, tsconfig.json, index.html
src/
  main.tsx, App.tsx
  types.ts
  styles/tokens.css
  parser/
    dateFormats.ts, mediaIndicators.ts, chatParser.ts, id.ts
    chatParser.test.ts
    fixtures/*.txt
  worker/
    importWorker.ts, zipExtract.ts, mediaCatalog.ts
    mediaCatalog.test.ts
  storage/
    db.ts, chatRepository.ts, fileAccess.ts
    chatRepository.test.ts
  store/
    useChatStore.ts, selectors.ts
    selectors.test.ts
  components/
    ImportScreen/{ImportScreen,DropZone,ParsingProgress,ImportSummary}.tsx(+.css)
    Toolbar/{Toolbar,TypeChips,SenderPopover,DatePopover}.tsx(+.css)
    Grid/{MediaGrid,MediaTile,useLazyThumbnail}.ts(x)(+.css)
    Panel/{DetailPanel,MessageThread,MessageBubble}.tsx(+.css)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `.gitignore`

- [ ] **Step 1: Scaffold with Vite**

```bash
cd whatsapp-revert-image
npm create vite@latest . -- --template react-ts
```

When prompted about the non-empty directory (it now has `docs/`), choose to continue/ignore existing files.

- [ ] **Step 2: Install dependencies**

```bash
npm install zustand idb fflate @tanstack/react-virtual
npm install -D vitest fake-indexeddb @vitest/ui jsdom @testing-library/react
```

- [ ] **Step 3: Add Vitest config to `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 4: Create `src/test-setup.ts`**

```ts
import 'fake-indexeddb/auto'
```

- [ ] **Step 5: Add test script to `package.json`**

Add under `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 6: Verify dev server boots**

```bash
npm run dev -- --port 5173 &
sleep 2
curl -sf http://localhost:5173 > /dev/null && echo "OK"
kill %1
```

Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS project with Vitest"
```

---

### Task 2: Core types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write the shared type definitions**

```ts
// src/types.ts
export type MediaKind = 'photo' | 'video' | 'doc' | 'voice' | 'link'

export interface Message {
  id: string
  sender: string
  timestampMs: number
  text: string
  mediaId?: string
  isSystemMessage: boolean
}

export interface MediaItem {
  id: string
  kind: MediaKind
  filename: string
  size: number
  caption: string
  sender: string
  timestampMs: number
  anchorMessageId: string
  starred: boolean
  durationSec?: number
  missing: boolean
}

export interface ParsedChat {
  messages: Message[]
  media: MediaItem[]
  participants: string[]
}

export type StorageRef =
  | { kind: 'opfs'; folder: string }
  | { kind: 'directory-handle'; handle: FileSystemDirectoryHandle }

export interface StoredChat {
  chatId: string
  title: string
  importedAtMs: number
  storageRef: StorageRef
  meParticipant: string | null
  parsed: ParsedChat
  starred: Record<string, boolean>
}

export type ImportProgress = {
  stage: 'reading' | 'extracting' | 'parsing'
  progress: number
}
```

Timestamps are stored as `number` (epoch ms) rather than `Date` so they survive `structuredClone` into/out of the Web Worker and IndexedDB without reviver logic.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (file has no consumers yet, so this just confirms syntax).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add core Message/MediaItem/ParsedChat types"
```

---

### Task 3: Parser — date format table

**Files:**
- Create: `src/parser/dateFormats.ts`
- Test: `src/parser/dateFormats.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/parser/dateFormats.test.ts
import { describe, it, expect } from 'vitest'
import { matchDatePrefix } from './dateFormats'

describe('matchDatePrefix', () => {
  it('parses US 12h format', () => {
    const r = matchDatePrefix('3/9/25, 8:14 AM - Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getFullYear()).toBe(2025)
    expect(new Date(r!.timestampMs).getHours()).toBe(8)
    expect(r!.rest).toBe('Ana: hi')
  })

  it('parses EU 24h format', () => {
    const r = matchDatePrefix('09/03/2025, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getMonth()).toBe(2) // March = index 2
    expect(new Date(r!.timestampMs).getHours()).toBe(20)
  })

  it('parses ISO format', () => {
    const r = matchDatePrefix('2025-09-03, 20:14 - Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getFullYear()).toBe(2025)
  })

  it('parses iOS bracketed 12h format with seconds', () => {
    const r = matchDatePrefix('[3/9/25, 8:14:07 AM] Ana: hi')
    expect(r).not.toBeNull()
    expect(new Date(r!.timestampMs).getSeconds()).toBe(7)
    expect(r!.rest).toBe('Ana: hi')
  })

  it('returns null for a non-matching line', () => {
    expect(matchDatePrefix('just a continuation line')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/parser/dateFormats.test.ts
```

Expected: FAIL — `Cannot find module './dateFormats'`.

- [ ] **Step 3: Implement**

```ts
// src/parser/dateFormats.ts
export interface DateMatch {
  timestampMs: number
  rest: string
}

function normalizeYear(y: number): number {
  return y < 100 ? y + (y > 50 ? 1900 : 2000) : y
}

function buildDate(
  day: number, month: number, year: number,
  hours: number, minutes: number, seconds: number, ampm?: string,
): number {
  let h = hours
  if (ampm) {
    const isPM = ampm.toUpperCase() === 'PM'
    if (isPM && hours !== 12) h = hours + 12
    else if (!isPM && hours === 12) h = 0
  }
  return new Date(year, month - 1, day, h, minutes, seconds).getTime()
}

interface Pattern {
  regex: RegExp
  parse: (m: RegExpMatchArray) => number
}

const PATTERNS: Pattern[] = [
  // MM/DD/YY, H:MM(:SS)? AM/PM - US
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*-\s*/i,
    parse: (m) => buildDate(+m[2], +m[1], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0, m[7]),
  },
  // DD/MM/YY, H:MM(:SS)? - EU/BR 24h (no AM/PM)
  {
    regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // YYYY-MM-DD, H:MM(:SS)? - ISO
  {
    regex: /^(\d{4})-(\d{1,2})-(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // DD.MM.YY, H:MM(:SS)? - German dot format
  {
    regex: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // DD-MM-YY, H:MM(:SS)? - dash format
  {
    regex: /^(\d{1,2})-(\d{1,2})-(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // YYYY/MM/DD, H:MM(:SS)? AM/PM - Asian 12h
  {
    regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*-\s*/i,
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0, m[7]),
  },
  // YYYY/MM/DD, H:MM(:SS)? - Asian 24h
  {
    regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*/,
    parse: (m) => buildDate(+m[3], +m[2], +m[1], +m[4], +m[5], m[6] ? +m[6] : 0),
  },
  // [DD/MM/YY, H:MM:SS AM/PM] - iOS bracketed 12h
  {
    regex: /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2}):(\d{2})[\s  ]*([AP]M)\]\s*/i,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], +m[6], m[7]),
  },
  // [DD/MM/YY, H:MM:SS] - iOS bracketed 24h
  {
    regex: /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\]\s*/,
    parse: (m) => buildDate(+m[1], +m[2], normalizeYear(+m[3]), +m[4], +m[5], +m[6]),
  },
]

export function matchDatePrefix(line: string): DateMatch | null {
  for (const { regex, parse } of PATTERNS) {
    const m = line.match(regex)
    if (m) {
      return { timestampMs: parse(m), rest: line.slice(m[0].length) }
    }
  }
  return null
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/parser/dateFormats.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parser/dateFormats.ts src/parser/dateFormats.test.ts
git commit -m "feat: add WhatsApp date-format parser"
```

---

### Task 4: Parser — media/system indicators + filename extraction

**Files:**
- Create: `src/parser/mediaIndicators.ts`
- Test: `src/parser/mediaIndicators.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/parser/mediaIndicators.test.ts
import { describe, it, expect } from 'vitest'
import { extractMediaFilename, isSystemMessage, detectKind } from './mediaIndicators'

describe('extractMediaFilename', () => {
  it('extracts from iOS <attached: ...> marker', () => {
    expect(extractMediaFilename('<attached: 00001-PHOTO.jpg>')).toBe('00001-PHOTO.jpg')
  })
  it('extracts from Android "(file attached)" marker', () => {
    expect(extractMediaFilename('IMG-20250903-WA0012.jpg (file attached)')).toBe('IMG-20250903-WA0012.jpg')
  })
  it('returns null for plain text', () => {
    expect(extractMediaFilename('just chatting')).toBeNull()
  })
})

describe('detectKind', () => {
  it('detects photo from extension', () => { expect(detectKind('a.jpg')).toBe('photo') })
  it('detects video from extension', () => { expect(detectKind('a.mp4')).toBe('video') })
  it('detects voice from extension', () => { expect(detectKind('a.opus')).toBe('voice') })
  it('detects doc from extension', () => { expect(detectKind('a.pdf')).toBe('doc') })
  it('defaults unknown extensions to doc', () => { expect(detectKind('a.xyz')).toBe('doc') })
})

describe('isSystemMessage', () => {
  it('flags group-created lines', () => {
    expect(isSystemMessage('Ana created group "Lisbon Trip"')).toBe(true)
  })
  it('does not flag a normal message', () => {
    expect(isSystemMessage('Landing at 14:20, anyone on the same flight?')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/parser/mediaIndicators.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/parser/mediaIndicators.ts
import type { MediaKind } from '../types'

const ATTACHED_RE = /<attached:\s*([^>]+)>/i
const FILE_ATTACHED_RE = /([^\s/\\]+\.[A-Za-z0-9]{2,5})\s*\((?:file attached|arquivo anexado|fichier joint|archivo adjunto)\)/i

export function extractMediaFilename(text: string): string | null {
  const m1 = text.match(ATTACHED_RE)
  if (m1) return m1[1].trim()
  const m2 = text.match(FILE_ATTACHED_RE)
  if (m2) return m2[1].trim()
  return null
}

const EXT_KIND: Record<string, MediaKind> = {
  jpg: 'photo', jpeg: 'photo', png: 'photo', gif: 'photo', webp: 'photo', heic: 'photo',
  mp4: 'video', mov: 'video', avi: 'video', '3gp': 'video', webm: 'video',
  opus: 'voice', m4a: 'voice', ogg: 'voice',
}

export function detectKind(filename: string): MediaKind {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return EXT_KIND[ext] ?? 'doc'
}

const SYSTEM_INDICATORS = [
  "joined using this group's invite link", 'created group', 'created this group',
  'changed the subject', "changed this group's icon", 'changed the group description',
  'Messages and calls are end-to-end encrypted', 'security code changed',
  'turned on disappearing messages', 'turned off disappearing messages',
  'added', 'removed', 'left',
]

export function isSystemMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return SYSTEM_INDICATORS.some((s) => lower.includes(s.toLowerCase()))
}
```

`detectKind` never returns `'link'` — link items come from the chat text (a bare URL with no attachment marker), handled separately in `chatParser.ts` (Task 5), not from a filename.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/parser/mediaIndicators.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parser/mediaIndicators.ts src/parser/mediaIndicators.test.ts
git commit -m "feat: add media-filename extraction and system-message detection"
```

---

### Task 5: Parser — deterministic IDs + chatParser

**Files:**
- Create: `src/parser/id.ts`, `src/parser/chatParser.ts`
- Create fixtures: `src/parser/fixtures/basic.txt`, `src/parser/fixtures/multiline-and-system.txt`
- Test: `src/parser/chatParser.test.ts`

- [ ] **Step 1: Write `id.ts`**

```ts
// src/parser/id.ts
export function makeIdGenerator(chatId: string) {
  const used = new Set<string>()
  return function generateId(timestampMs: number, sender: string, content: string): string {
    const base = `${chatId}|${timestampMs}|${sender}|${content}`
    let hash = 5381
    for (let i = 0; i < base.length; i++) {
      hash = ((hash << 5) + hash) ^ base.charCodeAt(i)
    }
    const id = Math.abs(hash).toString(36)
    let unique = id
    let counter = 0
    while (used.has(unique)) {
      counter++
      unique = `${id}_${counter}`
    }
    used.add(unique)
    return unique
  }
}
```

- [ ] **Step 2: Write fixtures**

```
// src/parser/fixtures/basic.txt
3/9/25, 8:14 AM - Ana Ferreira: Landing 14:20 on TP1234, anyone on the same flight?
3/9/25, 8:15 AM - Tomás Silva: <attached: IMG-20250903-WA0001.jpg>
3/9/25, 8:16 AM - You: Sending the boarding pass now
```

```
// src/parser/fixtures/multiline-and-system.txt
3/9/25, 8:14 AM - Ana Ferreira: First line
second line of the same message
3/9/25, 8:20 AM - Ana Ferreira created group "Lisbon Trip"
3/9/25, 8:21 AM - Tomás Silva: normal message after system line
```

- [ ] **Step 3: Write failing tests**

```ts
// src/parser/chatParser.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChat } from './chatParser'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8')
}

describe('parseChat', () => {
  it('parses messages, sender, and participants from a basic export', () => {
    const { messages, participants } = parseChat(fixture('basic.txt'), 'chat-1')
    expect(messages).toHaveLength(3)
    expect(messages[0].sender).toBe('Ana Ferreira')
    expect(messages[0].text).toContain('Landing 14:20')
    expect(participants.sort()).toEqual(['Ana Ferreira', 'Tomás Silva', 'You'].sort())
  })

  it('links a media message to a MediaItem with the extracted filename', () => {
    const { messages, media } = parseChat(fixture('basic.txt'), 'chat-1')
    const mediaMsg = messages[1]
    expect(mediaMsg.mediaId).toBeDefined()
    const item = media.find((m) => m.id === mediaMsg.mediaId)
    expect(item).toBeDefined()
    expect(item!.filename).toBe('IMG-20250903-WA0001.jpg')
    expect(item!.kind).toBe('photo')
    expect(item!.anchorMessageId).toBe(mediaMsg.id)
  })

  it('joins multiline messages into the previous message', () => {
    const { messages } = parseChat(fixture('multiline-and-system.txt'), 'chat-2')
    const first = messages.find((m) => m.text.startsWith('First line'))
    expect(first!.text).toBe('First line\nsecond line of the same message')
  })

  it('flags system messages and excludes their sender-less line from participants oddly attributed', () => {
    const { messages } = parseChat(fixture('multiline-and-system.txt'), 'chat-2')
    const systemMsg = messages.find((m) => m.text.includes('created group'))
    expect(systemMsg!.isSystemMessage).toBe(true)
  })

  it('produces stable ids across repeated parses of the same content', () => {
    const a = parseChat(fixture('basic.txt'), 'chat-1')
    const b = parseChat(fixture('basic.txt'), 'chat-1')
    expect(a.messages.map((m) => m.id)).toEqual(b.messages.map((m) => m.id))
  })
})
```

- [ ] **Step 4: Run to verify failure**

```bash
npx vitest run src/parser/chatParser.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement**

```ts
// src/parser/chatParser.ts
import type { Message, MediaItem, ParsedChat } from '../types'
import { matchDatePrefix } from './dateFormats'
import { extractMediaFilename, detectKind, isSystemMessage } from './mediaIndicators'
import { makeIdGenerator } from './id'

const URL_RE = /https?:\/\/\S+/i

function splitSenderContent(rest: string): { sender: string; content: string } {
  const colonIndex = rest.indexOf(':')
  if (colonIndex > 0 && colonIndex < 50) {
    return { sender: rest.slice(0, colonIndex).trim(), content: rest.slice(colonIndex + 1).trim() }
  }
  return { sender: '', content: rest.trim() }
}

export function parseChat(content: string, chatId: string): ParsedChat {
  const lines = content.split(/\r?\n/)
  const generateId = makeIdGenerator(chatId)
  const participants = new Set<string>()
  const messages: Message[] = []
  const media: MediaItem[] = []

  let pending: { timestampMs: number; sender: string; text: string; system: boolean } | null = null

  const flush = () => {
    if (!pending) return
    const id = generateId(pending.timestampMs, pending.sender, pending.text)
    const msg: Message = {
      id,
      sender: pending.sender,
      timestampMs: pending.timestampMs,
      text: pending.text,
      isSystemMessage: pending.system,
    }

    const filename = extractMediaFilename(pending.text)
    const url = pending.text.match(URL_RE)?.[0]
    if (filename) {
      const item: MediaItem = {
        id: `${id}-media`,
        kind: detectKind(filename),
        filename,
        size: 0,
        caption: pending.text.replace(filename, '').trim(),
        sender: pending.sender,
        timestampMs: pending.timestampMs,
        anchorMessageId: id,
        starred: false,
        missing: false,
      }
      media.push(item)
      msg.mediaId = item.id
    } else if (url && !pending.system) {
      const item: MediaItem = {
        id: `${id}-media`,
        kind: 'link',
        filename: url,
        size: 0,
        caption: pending.text,
        sender: pending.sender,
        timestampMs: pending.timestampMs,
        anchorMessageId: id,
        starred: false,
        missing: false,
      }
      media.push(item)
      msg.mediaId = item.id
    }

    messages.push(msg)
    pending = null
  }

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    const dateMatch = matchDatePrefix(rawLine)
    if (dateMatch) {
      flush()
      const { sender, content } = splitSenderContent(dateMatch.rest)
      const system = !sender || isSystemMessage(content)
      pending = { timestampMs: dateMatch.timestampMs, sender, text: content, system }
      if (sender && !system) participants.add(sender)
    } else if (pending) {
      pending.text += `\n${rawLine}`
    }
  }
  flush()

  return { messages, media, participants: Array.from(participants).sort() }
}
```

- [ ] **Step 6: Run to verify pass**

```bash
npx vitest run src/parser/chatParser.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/parser/id.ts src/parser/chatParser.ts src/parser/fixtures src/parser/chatParser.test.ts
git commit -m "feat: add chatParser with deterministic ids and media linking"
```

---

### Task 6: IndexedDB schema and chat repository

**Files:**
- Create: `src/storage/db.ts`, `src/storage/chatRepository.ts`
- Test: `src/storage/chatRepository.test.ts`

- [ ] **Step 1: Write `db.ts`**

```ts
// src/storage/db.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StoredChat } from '../types'

interface ReaderDB extends DBSchema {
  chats: {
    key: string
    value: StoredChat
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null

export function getDb(): Promise<IDBPDatabase<ReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>('whatsapp-media-reader', 1, {
      upgrade(db) {
        db.createObjectStore('chats', { keyPath: 'chatId' })
        db.createObjectStore('meta', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}
```

- [ ] **Step 2: Write failing tests for `chatRepository.ts`**

```ts
// src/storage/chatRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { saveChat, loadLastChat, setStarred } from './chatRepository'
import type { StoredChat } from '../types'

function makeChat(chatId: string): StoredChat {
  return {
    chatId,
    title: 'Lisbon Trip',
    importedAtMs: Date.now(),
    storageRef: { kind: 'opfs', folder: chatId },
    meParticipant: 'You',
    parsed: { messages: [], media: [], participants: ['You', 'Ana'] },
    starred: {},
  }
}

describe('chatRepository', () => {
  beforeEach(async () => {
    // fake-indexeddb persists per-test-run; each test uses a unique chatId instead of resetting.
  })

  it('saves and reloads the last-imported chat', async () => {
    const chat = makeChat('chat-a')
    await saveChat(chat)
    const loaded = await loadLastChat()
    expect(loaded?.chatId).toBe('chat-a')
    expect(loaded?.title).toBe('Lisbon Trip')
  })

  it('setStarred toggles and persists a media item star flag', async () => {
    const chat = makeChat('chat-b')
    await saveChat(chat)
    await setStarred('chat-b', 'media-1', true)
    const loaded = await loadLastChat()
    expect(loaded?.starred['media-1']).toBe(true)
    await setStarred('chat-b', 'media-1', false)
    const reloaded = await loadLastChat()
    expect(reloaded?.starred['media-1']).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/storage/chatRepository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/storage/chatRepository.ts
import { getDb } from './db'
import type { StoredChat } from '../types'

export async function saveChat(chat: StoredChat): Promise<void> {
  const db = await getDb()
  await db.put('chats', chat)
  await db.put('meta', { key: 'lastChatId', value: chat.chatId })
}

export async function loadLastChat(): Promise<StoredChat | null> {
  const db = await getDb()
  const last = await db.get('meta', 'lastChatId')
  if (!last) return null
  const chat = await db.get('chats', last.value)
  return chat ?? null
}

export async function setStarred(chatId: string, mediaId: string, starred: boolean): Promise<void> {
  const db = await getDb()
  const chat = await db.get('chats', chatId)
  if (!chat) return
  chat.starred = { ...chat.starred, [mediaId]: starred }
  await db.put('chats', chat)
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npx vitest run src/storage/chatRepository.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/storage/db.ts src/storage/chatRepository.ts src/storage/chatRepository.test.ts
git commit -m "feat: add IndexedDB chat persistence and starred-flag repository"
```

---

### Task 7: Unified file access (OPFS vs directory handle)

**Files:**
- Create: `src/storage/fileAccess.ts`

- [ ] **Step 1: Implement (no unit test — depends on browser-only OPFS/File System Access API not available under jsdom; covered by manual verification in Task 20)**

```ts
// src/storage/fileAccess.ts
import type { StorageRef } from '../types'

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

export async function getChatDirectory(ref: StorageRef): Promise<FileSystemDirectoryHandle> {
  if (ref.kind === 'directory-handle') return ref.handle
  const root = await getOpfsRoot()
  return root.getDirectoryHandle(ref.folder, { create: false })
}

export async function readMediaFile(ref: StorageRef, filename: string): Promise<File | null> {
  try {
    const dir = await getChatDirectory(ref)
    const fileHandle = await dir.getFileHandle(filename)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

export async function ensurePermission(ref: StorageRef): Promise<boolean> {
  if (ref.kind === 'opfs') return true
  const handle = ref.handle
  const opts = { mode: 'read' as const }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}
```

`readMediaFile` returning `null` is how `MediaTile` (Task 15) knows to render the missing-media placeholder from the spec's error-handling section, instead of throwing.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. (Add `"lib": ["ES2020", "DOM"]` and `"types": ["vite/client"]` to `tsconfig.json` if `FileSystemDirectoryHandle`/`navigator.storage` are reported as unknown — these come from `@types/wicg-file-system-access`, install it if needed: `npm install -D @types/wicg-file-system-access`.)

- [ ] **Step 3: Commit**

```bash
git add src/storage/fileAccess.ts
git commit -m "feat: add unified OPFS/directory-handle file access layer"
```

---

### Task 8: Web Worker — zip extraction into OPFS

**Files:**
- Create: `src/worker/zipExtract.ts`

- [ ] **Step 1: Implement**

```ts
// src/worker/zipExtract.ts
import { unzip, type Unzipped } from 'fflate'
import type { ImportProgress } from '../types'

export async function extractZipToOpfs(
  zipBytes: Uint8Array,
  folderName: string,
  onProgress: (p: ImportProgress) => void,
): Promise<{ chatText: string; mediaFilenames: string[] }> {
  onProgress({ stage: 'reading', progress: 0 })

  const entries: Unzipped = await new Promise((resolve, reject) => {
    unzip(zipBytes, (err, data) => (err ? reject(err) : resolve(data)))
  })

  onProgress({ stage: 'extracting', progress: 10 })

  const root = await navigator.storage.getDirectory()
  const chatDir = await root.getDirectoryHandle(folderName, { create: true })

  const names = Object.keys(entries).filter((n) => !n.endsWith('/'))
  let chatText = ''
  const mediaFilenames: string[] = []

  for (let i = 0; i < names.length; i++) {
    const path = names[i]
    const bytes = entries[path]
    const filename = path.split('/').pop() ?? path
    const cleanName = filename.replace(/^﻿/, '')

    if (cleanName.toLowerCase().endsWith('.txt') && !chatText) {
      chatText = new TextDecoder().decode(bytes)
    } else {
      const fileHandle = await chatDir.getFileHandle(cleanName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(bytes)
      await writable.close()
      mediaFilenames.push(cleanName)
    }

    onProgress({ stage: 'extracting', progress: 10 + Math.round(((i + 1) / names.length) * 80) })
  }

  if (!chatText) {
    throw new Error('No _chat.txt file found in the zip archive.')
  }

  onProgress({ stage: 'extracting', progress: 100 })
  return { chatText, mediaFilenames }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/worker/zipExtract.ts
git commit -m "feat: add zip-to-OPFS streaming extraction"
```

---

### Task 9: Media cataloging (match parsed media to files, mark missing)

**Files:**
- Create: `src/worker/mediaCatalog.ts`
- Test: `src/worker/mediaCatalog.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/worker/mediaCatalog.test.ts
import { describe, it, expect } from 'vitest'
import { reconcileMediaWithFiles } from './mediaCatalog'
import type { MediaItem } from '../types'

function item(filename: string): MediaItem {
  return {
    id: `${filename}-media`, kind: 'photo', filename, size: 0, caption: '',
    sender: 'Ana', timestampMs: 0, anchorMessageId: 'm1', starred: false, missing: false,
  }
}

describe('reconcileMediaWithFiles', () => {
  it('marks items present in the file list as not missing, with real size', () => {
    const [result] = reconcileMediaWithFiles([item('a.jpg')], new Map([['a.jpg', 1234]]))
    expect(result.missing).toBe(false)
    expect(result.size).toBe(1234)
  })

  it('marks items absent from the file list as missing', () => {
    const [result] = reconcileMediaWithFiles([item('gone.jpg')], new Map())
    expect(result.missing).toBe(true)
  })

  it('link items are never marked missing regardless of file list', () => {
    const link: MediaItem = { ...item('https://example.com'), kind: 'link' }
    const [result] = reconcileMediaWithFiles([link], new Map())
    expect(result.missing).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/worker/mediaCatalog.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/worker/mediaCatalog.ts
import type { MediaItem } from '../types'

export function reconcileMediaWithFiles(
  items: MediaItem[],
  fileSizesByName: Map<string, number>,
): MediaItem[] {
  return items.map((item) => {
    if (item.kind === 'link') return item
    const size = fileSizesByName.get(item.filename)
    return { ...item, missing: size === undefined, size: size ?? item.size }
  })
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/worker/mediaCatalog.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/mediaCatalog.ts src/worker/mediaCatalog.test.ts
git commit -m "feat: reconcile parsed media items against actual export files"
```

---

### Task 10: Import worker entry point

**Files:**
- Create: `src/worker/importWorker.ts`

- [ ] **Step 1: Implement**

```ts
// src/worker/importWorker.ts
import { parseChat } from '../parser/chatParser'
import { extractZipToOpfs } from './zipExtract'
import { reconcileMediaWithFiles } from './mediaCatalog'
import type { ImportProgress, ParsedChat, StorageRef } from '../types'

export type ImportRequest =
  | { kind: 'zip'; chatId: string; zipBytes: Uint8Array }
  | { kind: 'directory'; chatId: string; handle: FileSystemDirectoryHandle }

export type ImportResponse =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; parsed: ParsedChat; storageRef: StorageRef }
  | { type: 'error'; message: string }

async function listDirectoryFiles(handle: FileSystemDirectoryHandle): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  // @ts-expect-error -- values() is part of the async-iterable FileSystemDirectoryHandle spec
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      sizes.set(name, file.size)
    }
  }
  return sizes
}

async function findChatText(handle: FileSystemDirectoryHandle): Promise<string> {
  // @ts-expect-error -- entries() per async-iterable FileSystemDirectoryHandle spec
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file' && name.toLowerCase().endsWith('.txt')) {
      const file = await entry.getFile()
      return file.text()
    }
  }
  throw new Error('No _chat.txt file found in the selected folder.')
}

self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const req = e.data
  const post = (msg: ImportResponse) => (self as unknown as Worker).postMessage(msg)

  try {
    let chatText: string
    let fileSizes: Map<string, number>
    let storageRef: StorageRef

    if (req.kind === 'zip') {
      post({ type: 'progress', progress: { stage: 'reading', progress: 0 } })
      const extracted = await extractZipToOpfs(req.zipBytes, req.chatId, (p) => post({ type: 'progress', progress: p }))
      chatText = extracted.chatText
      storageRef = { kind: 'opfs', folder: req.chatId }
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(req.chatId)
      fileSizes = await listDirectoryFiles(dir)
    } else {
      post({ type: 'progress', progress: { stage: 'reading', progress: 20 } })
      chatText = await findChatText(req.handle)
      storageRef = { kind: 'directory-handle', handle: req.handle }
      post({ type: 'progress', progress: { stage: 'reading', progress: 60 } })
      fileSizes = await listDirectoryFiles(req.handle)
    }

    post({ type: 'progress', progress: { stage: 'parsing', progress: 0 } })
    const parsed = parseChat(chatText, req.chatId)
    parsed.media = reconcileMediaWithFiles(parsed.media, fileSizes)
    post({ type: 'progress', progress: { stage: 'parsing', progress: 100 } })

    post({ type: 'done', parsed, storageRef })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/worker/importWorker.ts
git commit -m "feat: add import worker orchestrating zip/folder parsing"
```

---

### Task 11: Zustand store — filters, selection, and thread windowing

**Files:**
- Create: `src/store/useChatStore.ts`, `src/store/selectors.ts`
- Test: `src/store/selectors.test.ts`

- [ ] **Step 1: Write `useChatStore.ts`**

```ts
// src/store/useChatStore.ts
import { create } from 'zustand'
import type { MediaKind, StoredChat } from '../types'

export interface Filters {
  types: MediaKind[]
  senders: string[]
  dateFrom: number | null
  dateTo: number | null
  query: string
  starredOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
  types: [], senders: [], dateFrom: null, dateTo: null, query: '', starredOnly: false,
}

interface ChatState {
  chat: StoredChat | null
  filters: Filters
  activeMediaId: string | null
  setChat: (chat: StoredChat | null) => void
  setFilters: (patch: Partial<Filters>) => void
  resetFilters: () => void
  openMedia: (id: string) => void
  closePanel: () => void
  toggleStarred: (mediaId: string) => void
}

export const useChatStore = create<ChatState>((set) => ({
  chat: null,
  filters: EMPTY_FILTERS,
  activeMediaId: null,
  setChat: (chat) => set({ chat }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  openMedia: (id) => set({ activeMediaId: id }),
  closePanel: () => set({ activeMediaId: null }),
  toggleStarred: (mediaId) =>
    set((s) => {
      if (!s.chat) return s
      const next = !s.chat.starred[mediaId]
      return { chat: { ...s.chat, starred: { ...s.chat.starred, [mediaId]: next } } }
    }),
}))
```

- [ ] **Step 2: Write failing tests for `selectors.ts`**

```ts
// src/store/selectors.test.ts
import { describe, it, expect } from 'vitest'
import { filteredMedia, threadWindow } from './selectors'
import { EMPTY_FILTERS, type Filters } from './useChatStore'
import type { MediaItem, Message } from '../types'

const media: MediaItem[] = [
  { id: 'm1', kind: 'photo', filename: 'a.jpg', size: 1, caption: 'sunset', sender: 'Ana', timestampMs: 100, anchorMessageId: 'msg1', starred: true, missing: false },
  { id: 'm2', kind: 'video', filename: 'b.mp4', size: 1, caption: 'clip', sender: 'Tomás', timestampMs: 200, anchorMessageId: 'msg2', starred: false, missing: false },
  { id: 'm3', kind: 'photo', filename: 'c.jpg', size: 1, caption: 'beach', sender: 'Ana', timestampMs: 300, anchorMessageId: 'msg3', starred: false, missing: false },
]

describe('filteredMedia', () => {
  it('returns all items when no filters are active', () => {
    expect(filteredMedia(media, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by type', () => {
    const f: Filters = { ...EMPTY_FILTERS, types: ['video'] }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m2'])
  })

  it('filters by sender', () => {
    const f: Filters = { ...EMPTY_FILTERS, senders: ['Ana'] }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('filters by starred-only', () => {
    const f: Filters = { ...EMPTY_FILTERS, starredOnly: true }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m1'])
  })

  it('filters by free-text query against caption', () => {
    const f: Filters = { ...EMPTY_FILTERS, query: 'beach' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3'])
  })

  it('filters by date range', () => {
    const f: Filters = { ...EMPTY_FILTERS, dateFrom: 150, dateTo: 250 }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m2'])
  })

  it('composes multiple filters with AND semantics', () => {
    const f: Filters = { ...EMPTY_FILTERS, types: ['photo'], senders: ['Ana'], query: 'beach' }
    expect(filteredMedia(media, f).map((m) => m.id)).toEqual(['m3'])
  })
})

describe('threadWindow', () => {
  const messages: Message[] = Array.from({ length: 120 }, (_, i) => ({
    id: `msg${i}`, sender: 'Ana', timestampMs: i, text: `line ${i}`, isSystemMessage: false,
  }))

  it('returns up to 50 messages before and after the anchor', () => {
    const w = threadWindow(messages, 'msg60')
    expect(w[0].id).toBe('msg10')
    expect(w[w.length - 1].id).toBe('msg110')
    expect(w).toHaveLength(101)
  })

  it('clamps at the start of the message list', () => {
    const w = threadWindow(messages, 'msg5')
    expect(w[0].id).toBe('msg0')
  })

  it('clamps at the end of the message list', () => {
    const w = threadWindow(messages, 'msg115')
    expect(w[w.length - 1].id).toBe('msg119')
  })

  it('returns an empty array for an unknown anchor id', () => {
    expect(threadWindow(messages, 'nope')).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/store/selectors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `selectors.ts`**

```ts
// src/store/selectors.ts
import type { MediaItem, Message } from '../types'
import type { Filters } from './useChatStore'

export function filteredMedia(media: MediaItem[], filters: Filters): MediaItem[] {
  const q = filters.query.trim().toLowerCase()
  return media.filter((item) => {
    if (filters.types.length && !filters.types.includes(item.kind)) return false
    if (filters.senders.length && !filters.senders.includes(item.sender)) return false
    if (filters.starredOnly && !item.starred) return false
    if (filters.dateFrom !== null && item.timestampMs < filters.dateFrom) return false
    if (filters.dateTo !== null && item.timestampMs > filters.dateTo) return false
    if (q) {
      const haystack = `${item.caption} ${item.filename} ${item.sender}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function threadWindow(messages: Message[], anchorId: string, radius = 50): Message[] {
  const index = messages.findIndex((m) => m.id === anchorId)
  if (index === -1) return []
  const start = Math.max(0, index - radius)
  const end = Math.min(messages.length, index + radius + 1)
  return messages.slice(start, end)
}
```

`filteredMedia`'s `starred` check reads `item.starred`, a denormalized flag — Task 12 keeps it in sync with `chat.starred` whenever the store's `toggleStarred` runs (see Task 12, Step 3) so this selector never needs the two lookup paths.

- [ ] **Step 5: Run to verify pass**

```bash
npx vitest run src/store/selectors.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/store/useChatStore.ts src/store/selectors.ts src/store/selectors.test.ts
git commit -m "feat: add Zustand store with filter and thread-window selectors"
```

---

### Task 12: Wire starred toggle to denormalized `MediaItem.starred` + persistence

**Files:**
- Modify: `src/store/useChatStore.ts`

- [ ] **Step 1: Update `toggleStarred` to also flip the item inside `chat.parsed.media` and persist**

```ts
// src/store/useChatStore.ts  (replace the toggleStarred implementation)
import { setStarred } from '../storage/chatRepository'

// ...inside create<ChatState>((set, get) => ({ ... })) — change create's callback to receive get:
  toggleStarred: (mediaId) => {
    set((s) => {
      if (!s.chat) return s
      const next = !s.chat.starred[mediaId]
      const media = s.chat.parsed.media.map((m) => (m.id === mediaId ? { ...m, starred: next } : m))
      return { chat: { ...s.chat, starred: { ...s.chat.starred, [mediaId]: next }, parsed: { ...s.chat.parsed, media } } }
    })
    const chatId = useChatStore.getState().chat?.chatId
    const nowStarred = useChatStore.getState().chat?.starred[mediaId]
    if (chatId && nowStarred !== undefined) void setStarred(chatId, mediaId, nowStarred)
  },
```

Apply this by editing the existing `toggleStarred` field in the `create<ChatState>((set) => ({ ... }))` object from Task 11 and adding the `import { setStarred } ...` line at the top of the file.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/useChatStore.ts
git commit -m "feat: persist starred toggles and keep MediaItem.starred in sync"
```

---

### Task 13: Design tokens stylesheet

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/main.tsx` (import it)

- [ ] **Step 1: Write tokens from the design spec**

```css
/* src/styles/tokens.css */
:root {
  --bg: #f4f4f3;
  --bg-header: #fbfbfa;
  --text-primary: #17181a;
  --text-secondary: #82858a;
  --text-tertiary: #9a9da1;
  --border: rgba(0, 0, 0, 0.1);
  --border-strong: rgba(0, 0, 0, 0.14);
  --accent: oklch(0.55 0.13 250);
  --chip-bg: #eeece8;
  --font-sans: system-ui, -apple-system, "Helvetica Neue", Helvetica, sans-serif;
  --font-mono: ui-monospace, Menlo, monospace;
  --radius-sm: 5px;
  --radius-md: 7px;
  --radius-lg: 11px;
}

html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
```

- [ ] **Step 2: Import in `main.tsx`**

```ts
// src/main.tsx (add near the top, alongside the existing index.css import)
import './styles/tokens.css'
```

- [ ] **Step 3: Verify visually**

```bash
npm run dev
```

Open `http://localhost:5173` — background should be `#f4f4f3`.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css src/main.tsx
git commit -m "feat: add design-token stylesheet"
```

---

### Task 14: Import screen — drop zone, folder/zip pickers, progress, summary

**Files:**
- Create: `src/components/ImportScreen/ImportScreen.tsx`, `src/components/ImportScreen/ImportScreen.css`

- [ ] **Step 1: Implement the full import flow as one component (drop → progress → summary → "who is me")**

```tsx
// src/components/ImportScreen/ImportScreen.tsx
import { useRef, useState } from 'react'
import type { ImportProgress, ParsedChat, StorageRef, StoredChat } from '../../types'
import { saveChat } from '../../storage/chatRepository'
import './ImportScreen.css'

type Screen = 'drop' | 'parsing' | 'summary'

interface Props {
  onOpen: (chat: StoredChat) => void
}

export function ImportScreen({ onOpen }: Props) {
  const [screen, setScreen] = useState<Screen>('drop')
  const [progress, setProgress] = useState<ImportProgress>({ stage: 'reading', progress: 0 })
  const [result, setResult] = useState<{ parsed: ParsedChat; storageRef: StorageRef; title: string } | null>(null)
  const [mePick, setMePick] = useState<string>('')
  const workerRef = useRef<Worker | null>(null)

  function runImport(req: { kind: 'zip'; zipBytes: Uint8Array; title: string } | { kind: 'directory'; handle: FileSystemDirectoryHandle; title: string }) {
    setScreen('parsing')
    const worker = new Worker(new URL('../../worker/importWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const chatId = `${req.title}-${Date.now()}`
    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'progress') setProgress(msg.progress)
      else if (msg.type === 'done') {
        setResult({ parsed: msg.parsed, storageRef: msg.storageRef, title: req.title })
        setScreen('summary')
        worker.terminate()
      } else if (msg.type === 'error') {
        alert(`Import failed: ${msg.message}`)
        setScreen('drop')
        worker.terminate()
      }
    }
    if (req.kind === 'zip') {
      worker.postMessage({ kind: 'zip', chatId, zipBytes: req.zipBytes })
    } else {
      worker.postMessage({ kind: 'directory', chatId, handle: req.handle })
    }
  }

  async function pickZipOrFolder() {
    // @ts-expect-error -- showOpenFilePicker is part of the File System Access API
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'WhatsApp export', accept: { 'application/zip': ['.zip'] } }],
    }).catch(() => [null])
    if (fileHandle) {
      const file = await fileHandle.getFile()
      const bytes = new Uint8Array(await file.arrayBuffer())
      runImport({ kind: 'zip', zipBytes: bytes, title: file.name.replace(/\.zip$/i, '') })
      return
    }
    // @ts-expect-error -- showDirectoryPicker is part of the File System Access API
    const dirHandle: FileSystemDirectoryHandle | undefined = await window.showDirectoryPicker().catch(() => undefined)
    if (dirHandle) {
      runImport({ kind: 'directory', handle: dirHandle, title: dirHandle.name })
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.name.toLowerCase().endsWith('.zip')) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      runImport({ kind: 'zip', zipBytes: bytes, title: file.name.replace(/\.zip$/i, '') })
    } else {
      alert('Drop a .zip export, or use "Choose file…" to pick an unzipped folder.')
    }
  }

  async function confirmOpen() {
    if (!result) return
    const chatId = `${result.title}-${Date.now()}`
    const stored: StoredChat = {
      chatId,
      title: result.title,
      importedAtMs: Date.now(),
      storageRef: result.storageRef,
      meParticipant: mePick || null,
      parsed: result.parsed,
      starred: {},
    }
    await saveChat(stored)
    onOpen(stored)
  }

  if (screen === 'drop') {
    return (
      <div className="import-overlay">
        <div className="import-card" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={pickZipOrFolder}>
          <div className="import-title">Drop your chat export here</div>
          <div className="import-sub">.zip archive, or a _chat.txt with its media folder. Everything is parsed locally — nothing is uploaded.</div>
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); pickZipOrFolder() }}>Choose file…</button>
        </div>
      </div>
    )
  }

  if (screen === 'parsing') {
    return (
      <div className="import-overlay">
        <div className="import-card">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress.progress}%` }} /></div>
          <div className="progress-label">{progress.stage} — {progress.progress}%</div>
        </div>
      </div>
    )
  }

  // summary
  return (
    <div className="import-overlay">
      <div className="import-card summary-card">
        <div className="import-title">{result!.title}</div>
        <div className="import-sub">{result!.parsed.messages.length} messages · {result!.parsed.media.length} media items</div>
        <label className="me-picker">
          Which participant are you?
          <select value={mePick} onChange={(e) => setMePick(e.target.value)}>
            <option value="">— none —</option>
            {result!.parsed.participants.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div className="summary-actions">
          <button className="btn-secondary" onClick={() => setScreen('drop')}>Import another</button>
          <button className="btn-primary" onClick={confirmOpen}>Open media reader</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write matching CSS**

```css
/* src/components/ImportScreen/ImportScreen.css */
.import-overlay {
  position: fixed; inset: 0; z-index: 60; background: var(--bg);
  display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px;
}
.import-card {
  width: 560px; max-width: 100%; background: #fff; border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg); box-shadow: 0 1px 3px rgba(0,0,0,.06); padding: 24px; cursor: pointer;
}
.summary-card { cursor: default; }
.import-title { font: 600 13px/1.3 var(--font-sans); margin-bottom: 6px; }
.import-sub { font: 400 11px/1.5 var(--font-mono); color: var(--text-secondary); max-width: 400px; margin-bottom: 12px; }
.btn-primary, .btn-secondary {
  height: 28px; padding: 0 12px; border-radius: 6px; font: 500 11.5px/1 var(--font-sans); cursor: pointer;
}
.btn-primary { background: #1d1e20; border: 1px solid #1d1e20; color: #fff; }
.btn-secondary { background: #fff; border: 1px solid var(--border-strong); color: #3d3f43; }
.progress-track { height: 4px; border-radius: 2px; background: #eceae6; overflow: hidden; margin-bottom: 12px; }
.progress-fill { height: 100%; background: var(--accent); transition: width .35s ease; }
.progress-label { font: 400 11px/1.4 var(--font-mono); color: var(--text-secondary); }
.me-picker { display: block; font: 400 11.5px/1.6 var(--font-sans); margin: 12px 0; }
.summary-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
```

- [ ] **Step 3: Verify manually**

```bash
npm run dev
```

Temporarily render `<ImportScreen onOpen={console.log} />` from `App.tsx`, confirm the drop card renders and the click-to-pick button opens a native file picker without throwing.

- [ ] **Step 4: Commit**

```bash
git add src/components/ImportScreen
git commit -m "feat: add import screen with drop/pick, progress, and summary"
```

---

### Task 15: Media grid with virtualization and lazy thumbnails

**Files:**
- Create: `src/components/Grid/MediaGrid.tsx`, `src/components/Grid/MediaTile.tsx`, `src/components/Grid/useLazyThumbnail.ts`, `src/components/Grid/Grid.css`

- [ ] **Step 1: Write `useLazyThumbnail.ts`**

```ts
// src/components/Grid/useLazyThumbnail.ts
import { useEffect, useRef, useState } from 'react'
import { readMediaFile } from '../../storage/fileAccess'
import type { StorageRef } from '../../types'

export function useLazyThumbnail(storageRef: StorageRef, filename: string, kind: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (kind !== 'photo' && kind !== 'video') return
    const el = ref.current
    if (!el) return
    let objectUrl: string | null = null
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting || objectUrl) return
        const file = await readMediaFile(storageRef, filename)
        if (file) {
          objectUrl = URL.createObjectURL(file)
          setUrl(objectUrl)
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [storageRef, filename, kind])

  return { ref, url }
}
```

- [ ] **Step 2: Write `MediaTile.tsx`**

```tsx
// src/components/Grid/MediaTile.tsx
import type { MediaItem, StorageRef } from '../../types'
import { useLazyThumbnail } from './useLazyThumbnail'
import { useChatStore } from '../../store/useChatStore'

interface Props {
  item: MediaItem
  storageRef: StorageRef
  selected: boolean
  onOpen: (id: string) => void
}

export function MediaTile({ item, storageRef, selected, onOpen }: Props) {
  const { ref, url } = useLazyThumbnail(storageRef, item.filename, item.kind)
  const toggleStarred = useChatStore((s) => s.toggleStarred)

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      className={`media-tile ${selected ? 'media-tile--selected' : ''}`}
      onClick={() => onOpen(item.id)}
    >
      {item.missing ? (
        <div className="tile-missing">Missing</div>
      ) : item.kind === 'photo' || item.kind === 'video' ? (
        url ? <img src={url} alt={item.caption} /> : <div className="tile-placeholder" />
      ) : (
        <div className="tile-file">
          <span className="tile-ext">{item.filename.split('.').pop()?.toUpperCase()}</span>
          <span className="tile-caption">{item.caption || item.filename}</span>
        </div>
      )}
      <div className="tile-overlay">
        <span className="tile-caption-text">{item.caption}</span>
      </div>
      <div
        className={`tile-star ${item.starred ? 'tile-star--on' : ''}`}
        onClick={(e) => { e.stopPropagation(); toggleStarred(item.id) }}
      >★</div>
    </button>
  )
}
```

- [ ] **Step 3: Write `MediaGrid.tsx`**

```tsx
// src/components/Grid/MediaGrid.tsx
import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MediaItem, StorageRef } from '../../types'
import { MediaTile } from './MediaTile'
import './Grid.css'

interface Props {
  items: MediaItem[]
  storageRef: StorageRef
  activeMediaId: string | null
  onOpen: (id: string) => void
}

const TILE_SIZE = 152
const GAP = 10

export function MediaGrid({ items, storageRef, activeMediaId, onOpen }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const columns = Math.max(1, Math.floor(((parentRef.current?.clientWidth ?? 1200) + GAP) / (TILE_SIZE + GAP)))
  const rowCount = Math.ceil(items.length / columns)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_SIZE + GAP,
    overscan: 4,
  })

  const rows = useMemo(() => {
    const out: MediaItem[][] = []
    for (let i = 0; i < items.length; i += columns) out.push(items.slice(i, i + columns))
    return out
  }, [items, columns])

  if (items.length === 0) {
    return <div className="grid-empty">No media matches these filters</div>
  }

  return (
    <div ref={parentRef} className="grid-scroll">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="grid-row"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)`, gap: GAP }}
          >
            {rows[virtualRow.index].map((item) => (
              <MediaTile key={item.id} item={item} storageRef={storageRef} selected={item.id === activeMediaId} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write `Grid.css`**

```css
/* src/components/Grid/Grid.css */
.grid-scroll { flex: 1; overflow-y: auto; padding: 0 16px 28px; }
.grid-row { display: flex; padding: 5px 0; }
.media-tile {
  position: relative; width: 152px; height: 152px; padding: 0; border: 1px solid var(--border);
  border-radius: var(--radius-md); overflow: hidden; cursor: pointer; background: #e4e2dd;
  text-align: left; outline: none; margin-right: 10px;
}
.media-tile--selected { outline: 2px solid var(--accent); outline-offset: -2px; }
.media-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile-placeholder { position: absolute; inset: 0; background: repeating-linear-gradient(135deg, #e4e2dd 0 7px, #d6d3cd 7px 14px); }
.tile-missing { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11px var(--font-mono); color: var(--text-tertiary); background: #eceae6; }
.tile-overlay { position: absolute; inset: auto 0 0 0; padding: 16px 8px 7px; background: linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0)); }
.tile-caption-text { font: 500 10.5px/1.25 var(--font-sans); color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.tile-file { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 10px; background: #fff; }
.tile-ext { font: 600 9.5px var(--font-mono); padding: 4px 6px; border-radius: 4px; background: var(--chip-bg); align-self: flex-start; }
.tile-caption { font: 500 11px/1.35 var(--font-sans); }
.tile-star { position: absolute; right: 6px; bottom: 6px; width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.85); color: #c8c6c0; }
.tile-star--on { color: #e8b93f; }
.grid-empty { display: flex; align-items: center; justify-content: center; padding: 90px 0; font: 500 12.5px var(--font-sans); color: var(--text-secondary); }
```

- [ ] **Step 5: Verify manually**

Render `<MediaGrid>` in `App.tsx` with a stored chat's `parsed.media` and confirm: tiles render, scrolling stays smooth with a large synthetic list (e.g. duplicate a fixture chat's media array to 2000 items in a scratch test), and thumbnails only start loading once scrolled into view (check the Network/Elements panel — no `<img src>` set for off-screen tiles).

- [ ] **Step 6: Commit**

```bash
git add src/components/Grid
git commit -m "feat: add virtualized media grid with lazy thumbnail loading"
```

---

### Task 16: Toolbar — type filter, sender popover, date popover, search, starred toggle

**Files:**
- Create: `src/components/Toolbar/Toolbar.tsx`, `src/components/Toolbar/Toolbar.css`

- [ ] **Step 1: Implement**

```tsx
// src/components/Toolbar/Toolbar.tsx
import { useMemo, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import type { MediaItem, MediaKind } from '../../types'
import './Toolbar.css'

const TYPES: { kind: MediaKind; label: string }[] = [
  { kind: 'photo', label: 'Photos' }, { kind: 'video', label: 'Videos' },
  { kind: 'doc', label: 'Docs' }, { kind: 'voice', label: 'Voice' }, { kind: 'link', label: 'Links' },
]

const PRESETS = ['All time', 'Last 7 days', 'Last 30 days', 'This month'] as const

interface Props {
  media: MediaItem[]
  resultCount: number
}

export function Toolbar({ media, resultCount }: Props) {
  const filters = useChatStore((s) => s.filters)
  const setFilters = useChatStore((s) => s.setFilters)
  const resetFilters = useChatStore((s) => s.resetFilters)
  const [senderOpen, setSenderOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of media) counts[m.kind] = (counts[m.kind] ?? 0) + 1
    return counts
  }, [media])

  const senderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of media) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [media])

  function toggleType(kind: MediaKind) {
    const next = filters.types.includes(kind) ? filters.types.filter((t) => t !== kind) : [...filters.types, kind]
    setFilters({ types: next })
  }

  function toggleSender(name: string) {
    const next = filters.senders.includes(name) ? filters.senders.filter((s) => s !== name) : [...filters.senders, name]
    setFilters({ senders: next })
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    if (preset === 'All time') setFilters({ dateFrom: null, dateTo: null })
    else if (preset === 'Last 7 days') setFilters({ dateFrom: now - 7 * day, dateTo: now })
    else if (preset === 'Last 30 days') setFilters({ dateFrom: now - 30 * day, dateTo: now })
    else {
      const d = new Date()
      setFilters({ dateFrom: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), dateTo: now })
    }
    setDateOpen(false)
  }

  const anyFilter = filters.types.length > 0 || filters.senders.length > 0 || filters.dateFrom !== null || filters.starredOnly || filters.query !== ''

  return (
    <div className="toolbar">
      <div className="type-chips">
        {TYPES.map(({ kind, label }) => (
          <button key={kind} className={`chip ${filters.types.includes(kind) ? 'chip--active' : ''}`} onClick={() => toggleType(kind)}>
            {label} <span className="chip-count">{typeCounts[kind] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="divider" />

      <div className="popover-anchor">
        <button className="chip" onClick={() => setSenderOpen((v) => !v)}>
          FROM {filters.senders.length > 0 ? `(${filters.senders.length})` : 'Anyone'}
        </button>
        {senderOpen && (
          <div className="popover">
            {senderCounts.map(([name, count]) => (
              <button key={name} className="popover-row" onClick={() => toggleSender(name)}>
                <span className={`checkbox ${filters.senders.includes(name) ? 'checkbox--on' : ''}`} />
                <span className="popover-name">{name}</span>
                <span className="popover-count">{count}</span>
              </button>
            ))}
            <div className="popover-footer">
              <button onClick={() => setFilters({ senders: senderCounts.map(([n]) => n) })}>All</button>
              <button onClick={() => setFilters({ senders: [] })}>None</button>
              <button onClick={() => setSenderOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="popover-anchor">
        <button className="chip" onClick={() => setDateOpen((v) => !v)}>DATE</button>
        {dateOpen && (
          <div className="popover">
            {PRESETS.map((p) => <button key={p} className="popover-row" onClick={() => applyPreset(p)}>{p}</button>)}
          </div>
        )}
      </div>

      <div className="divider" />

      <button className={`chip ${filters.starredOnly ? 'chip--active' : ''}`} onClick={() => setFilters({ starredOnly: !filters.starredOnly })}>
        ★ Starred
      </button>

      <input
        className="search-box"
        placeholder="Search messages, captions, filenames"
        value={filters.query}
        onChange={(e) => setFilters({ query: e.target.value })}
      />

      <div className="result-count">{resultCount} results</div>

      {anyFilter && <button className="reset-btn" onClick={resetFilters}>Reset filters</button>}
    </div>
  )
}
```

- [ ] **Step 2: Write `Toolbar.css`**

```css
/* src/components/Toolbar/Toolbar.css */
.toolbar { display: flex; align-items: center; gap: 8px; height: 41px; padding: 0 14px; background: var(--bg-header); border-bottom: 1px solid var(--border); overflow-x: auto; }
.type-chips { display: flex; gap: 3px; padding: 2px; background: var(--chip-bg); border-radius: 7px; }
.chip { display: flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; cursor: pointer; font: 500 11.5px var(--font-sans); }
.chip--active { background: #fff; border-color: var(--border-strong); }
.chip-count { font: 400 10px var(--font-mono); color: var(--text-tertiary); }
.divider { width: 1px; height: 20px; background: var(--border); }
.popover-anchor { position: relative; }
.popover { position: absolute; z-index: 40; top: 30px; left: 0; width: 260px; background: #fff; border: 1px solid var(--border-strong); border-radius: 9px; box-shadow: 0 10px 28px rgba(0,0,0,.16); padding: 6px; max-height: 300px; overflow-y: auto; }
.popover-row { width: 100%; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px; border: 0; background: transparent; cursor: pointer; text-align: left; font: 500 11.5px var(--font-sans); }
.checkbox { width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--border-strong); }
.checkbox--on { background: var(--accent); border-color: var(--accent); }
.popover-name { flex: 1; }
.popover-count { font: 400 10px var(--font-mono); color: var(--text-tertiary); }
.popover-footer { display: flex; gap: 5px; justify-content: flex-end; padding-top: 6px; border-top: 1px solid var(--border); }
.search-box { flex: 1; max-width: 280px; height: 28px; padding: 0 9px; background: #fff; border: 1px solid var(--border-strong); border-radius: 6px; font: 400 12px var(--font-sans); }
.result-count { font: 400 11px var(--font-mono); color: var(--text-secondary); }
.reset-btn { height: 26px; padding: 0 9px; border: 1px solid var(--border-strong); background: #fff; border-radius: 6px; cursor: pointer; font: 500 11.5px var(--font-sans); color: #6b6d72; }
```

- [ ] **Step 3: Verify manually**

Render `<Toolbar>` wired to a real store instance with sample media; confirm each control mutates the store (inspect via React DevTools or a temporary `console.log` of `useChatStore.getState().filters`), and that the sender/date popovers open/close correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/Toolbar
git commit -m "feat: add filter toolbar with type/sender/date/search/starred controls"
```

---

### Task 17: Detail panel — header, actions, virtualized message thread, anchor highlight

**Files:**
- Create: `src/components/Panel/DetailPanel.tsx`, `src/components/Panel/MessageThread.tsx`, `src/components/Panel/Panel.css`

- [ ] **Step 1: Write `MessageThread.tsx`**

```tsx
// src/components/Panel/MessageThread.tsx
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Message } from '../../types'

function dateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

interface Props {
  messages: Message[]
  anchorId: string
  meParticipant: string | null
}

export interface MessageThreadHandle {
  flashAnchor: () => void
}

export const MessageThread = forwardRef<MessageThreadHandle, Props>(function MessageThread(
  { messages, anchorId, meParticipant },
  ref,
) {
  const parentRef = useRef<HTMLDivElement>(null)
  const anchorIndex = messages.findIndex((m) => m.id === anchorId)
  const [flash, setFlash] = useState(false)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  useEffect(() => {
    if (anchorIndex >= 0) virtualizer.scrollToIndex(anchorIndex, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorId])

  useImperativeHandle(ref, () => ({
    flashAnchor: () => {
      if (anchorIndex >= 0) virtualizer.scrollToIndex(anchorIndex, { align: 'center' })
      setFlash(true)
      setTimeout(() => setFlash(false), 700)
    },
  }), [anchorIndex, virtualizer])

  return (
    <div ref={parentRef} className="thread-scroll">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const m = messages[row.index]
          const prev = messages[row.index - 1]
          const dayBreak = !prev || dateKey(prev.timestampMs) !== dateKey(m.timestampMs)
          const mine = meParticipant !== null && m.sender === meParticipant
          const isAnchor = m.id === anchorId
          return (
            <div key={row.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
              {dayBreak && <div className="day-sep"><span>{new Date(m.timestampMs).toDateString()}</span></div>}
              <div className={`bubble-row ${mine ? 'bubble-row--mine' : ''}`}>
                <div className={`bubble ${isAnchor ? 'bubble--anchor' : ''} ${isAnchor && flash ? 'bubble--flash' : ''}`}>
                  {!mine && <div className="bubble-sender">{m.sender}</div>}
                  <div className="bubble-text">{m.text}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Write `DetailPanel.tsx`**

```tsx
// src/components/Panel/DetailPanel.tsx
import { useRef, useState } from 'react'
import { useChatStore } from '../../store/useChatStore'
import { threadWindow } from '../../store/selectors'
import { readMediaFile } from '../../storage/fileAccess'
import { MessageThread, type MessageThreadHandle } from './MessageThread'
import type { MediaItem, Message, StorageRef } from '../../types'
import './Panel.css'

interface Props {
  activeItem: MediaItem
  messages: Message[]
  filteredIds: string[]
  meParticipant: string | null
  storageRef: StorageRef
}

export function DetailPanel({ activeItem, messages, filteredIds, meParticipant, storageRef }: Props) {
  const openMedia = useChatStore((s) => s.openMedia)
  const closePanel = useChatStore((s) => s.closePanel)
  const toggleStarred = useChatStore((s) => s.toggleStarred)
  const threadRef = useRef<MessageThreadHandle>(null)
  const [downloading, setDownloading] = useState(false)

  const position = filteredIds.indexOf(activeItem.id)
  const messageWindow = threadWindow(messages, activeItem.anchorMessageId)

  function step(delta: number) {
    const next = filteredIds[position + delta]
    if (next) openMedia(next)
  }

  async function handleDownload() {
    if (activeItem.kind === 'link') return
    setDownloading(true)
    const file = await readMediaFile(storageRef, activeItem.filename)
    setDownloading(false)
    if (!file) {
      alert('This file is missing from the export and cannot be downloaded.')
      return
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = activeItem.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="detail-panel">
      <div className="panel-header">
        <div className="panel-title">In conversation</div>
        <div className="panel-position">{position + 1} of {filteredIds.length}</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => step(-1)} disabled={position <= 0}>↑</button>
        <button onClick={() => step(1)} disabled={position >= filteredIds.length - 1}>↓</button>
        <button onClick={closePanel}>✕</button>
      </div>

      <div className="panel-preview">
        <div className="preview-thumb" />
        <div className="preview-info">
          <div className="preview-caption">{activeItem.caption || activeItem.filename}</div>
          <div className="preview-meta">{activeItem.filename}</div>
          <div className="preview-meta">{activeItem.sender} · {new Date(activeItem.timestampMs).toLocaleString()}</div>
          <div className="preview-actions">
            <button onClick={() => toggleStarred(activeItem.id)}>★ {activeItem.starred ? 'Starred' : 'Star'}</button>
            <button onClick={handleDownload} disabled={downloading || activeItem.kind === 'link'}>
              {downloading ? 'Downloading…' : 'Download'}
            </button>
            <button onClick={() => threadRef.current?.flashAnchor()}>Jump to message</button>
          </div>
        </div>
      </div>

      <MessageThread ref={threadRef} messages={messageWindow} anchorId={activeItem.anchorMessageId} meParticipant={meParticipant} />
    </aside>
  )
}
```

- [ ] **Step 3: Write `Panel.css`**

```css
/* src/components/Panel/Panel.css */
.detail-panel { flex: none; width: 448px; display: flex; flex-direction: column; background: var(--bg-header); border-left: 1px solid var(--border); min-height: 0; }
.panel-header { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border); }
.panel-title { font: 600 11.5px var(--font-sans); }
.panel-position { font: 400 10.5px var(--font-mono); color: var(--text-tertiary); }
.panel-preview { display: flex; gap: 11px; padding: 12px; border-bottom: 1px solid var(--border); background: #fff; }
.preview-thumb { flex: none; width: 74px; height: 74px; border-radius: 6px; border: 1px solid var(--border); background: #e4e2dd; }
.preview-caption { font: 500 12.5px var(--font-sans); }
.preview-meta { font: 400 10.5px/1.6 var(--font-mono); color: var(--text-secondary); }
.preview-actions { display: flex; gap: 6px; margin-top: 8px; }
.thread-scroll { flex: 1; overflow-y: auto; position: relative; padding: 0 12px 24px; background: var(--bg); min-height: 0; }
.day-sep { display: flex; justify-content: center; padding: 12px 0 9px; }
.day-sep span { font: 400 9.5px var(--font-mono); color: var(--text-secondary); background: #e9e7e3; padding: 4px 8px; border-radius: 4px; }
.bubble-row { display: flex; justify-content: flex-start; padding: 1.5px 0; }
.bubble-row--mine { justify-content: flex-end; }
.bubble { max-width: 82%; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px 5px; position: relative; }
.bubble-row--mine .bubble { background: #e7f0ff; }
.bubble--anchor { box-shadow: inset 3px 0 0 var(--accent); }
.bubble--flash { background: #dbe9ff; transition: background 0.15s ease; }
.bubble-sender { font: 600 10.5px var(--font-sans); margin-bottom: 2px; }
.bubble-text { font: 400 12px/1.45 var(--font-sans); white-space: pre-wrap; }
```

- [ ] **Step 4: Verify manually**

Open a media tile in the running app, confirm the panel opens with the ±50 window, auto-scrolls to a visibly highlighted anchor bubble, and prev/next move through the filtered set with a correct position indicator. Scroll away from the anchor within the panel, click "Jump to message," and confirm it scrolls back and flashes. Click "Download" on a photo/video item and confirm a real file downloads with the correct filename.

- [ ] **Step 5: Commit**

```bash
git add src/components/Panel
git commit -m "feat: add detail panel with virtualized conversation thread"
```

---

### Task 18: App shell — wire import, grid, toolbar, panel, and reload flow

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/App.css` (replaced by component-local CSS files), default Vite boilerplate content

- [ ] **Step 1: Implement**

```tsx
// src/App.tsx
import { useEffect, useState } from 'react'
import { ImportScreen } from './components/ImportScreen/ImportScreen'
import { Toolbar } from './components/Toolbar/Toolbar'
import { MediaGrid } from './components/Grid/MediaGrid'
import { DetailPanel } from './components/Panel/DetailPanel'
import { useChatStore } from './store/useChatStore'
import { filteredMedia } from './store/selectors'
import { loadLastChat } from './storage/chatRepository'
import { ensurePermission } from './storage/fileAccess'
import type { StoredChat } from './types'

const SUPPORTED = typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'storage' in navigator

export default function App() {
  const chat = useChatStore((s) => s.chat)
  const setChat = useChatStore((s) => s.setChat)
  const filters = useChatStore((s) => s.filters)
  const activeMediaId = useChatStore((s) => s.activeMediaId)
  const openMedia = useChatStore((s) => s.openMedia)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [checkedStorage, setCheckedStorage] = useState(false)

  useEffect(() => {
    loadLastChat().then(async (stored) => {
      if (stored) {
        const ok = await ensurePermission(stored.storageRef)
        if (ok) setChat(stored)
        else setNeedsPermission(true)
      }
      setCheckedStorage(true)
    })
  }, [setChat])

  if (!SUPPORTED) {
    return <div className="unsupported">This app requires Chrome, Edge, or another Chromium-based browser.</div>
  }

  if (!checkedStorage) return null

  if (!chat || needsPermission) {
    return <ImportScreen onOpen={(c: StoredChat) => { setChat(c); setNeedsPermission(false) }} />
  }

  const media = filteredMedia(chat.parsed.media, filters)
  // Deliberately looked up only within the *filtered* set: if the active item drops out of the
  // filtered results (user changed a filter while the panel was open), the panel closes itself
  // instead of showing a stale item with a broken "N of M" position indicator.
  const activeItem = activeMediaId ? media.find((m) => m.id === activeMediaId) : undefined

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Toolbar media={chat.parsed.media} resultCount={media.length} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <MediaGrid items={media} storageRef={chat.storageRef} activeMediaId={activeMediaId} onOpen={openMedia} />
        </main>
        {activeItem && (
          <DetailPanel
            activeItem={activeItem}
            messages={chat.parsed.messages}
            filteredIds={media.map((m) => m.id)}
            meParticipant={chat.meParticipant}
            storageRef={chat.storageRef}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove Vite boilerplate**

```bash
rm -f src/App.css
```

Remove the `import './App.css'` line from `src/App.tsx` if the scaffold left one (the version above doesn't import it).

- [ ] **Step 3: Verify the full golden path manually**

```bash
npm run dev
```

In Chrome: drop a real (or test-fixture-built) WhatsApp export zip, confirm progress UI advances, summary shows correct counts, "Open media reader" lands on the grid, filters/search narrow results live, clicking a tile opens the panel scrolled to the anchor, prev/next move through the filtered set, starring persists after a manual page reload (with the one-click permission re-grant for folder imports).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire app shell — import, grid, toolbar, and detail panel"
```

---

### Task 19: Edge cases — unsupported browser message, missing-media placeholder, permission-denied state

**Files:**
- Modify: `src/App.tsx` (styling for `.unsupported` and permission-needed states)
- Create: `src/App.css` (new, minimal — just these two states)

- [ ] **Step 1: Add `src/App.css`**

```css
/* src/App.css */
.unsupported {
  height: 100vh; display: flex; align-items: center; justify-content: center;
  font: 500 13px var(--font-sans); color: var(--text-secondary); text-align: center; padding: 32px;
}
```

- [ ] **Step 2: Import it in `App.tsx`**

```ts
// src/App.tsx (add near the top)
import './App.css'
```

- [ ] **Step 3: Verify each edge case manually**

- Non-Chromium: temporarily stub `SUPPORTED = false` in `App.tsx`, confirm the message renders, then revert.
- Missing media: import a "without media" style export (fixture zip missing a referenced file), confirm the tile shows the "Missing" placeholder from `MediaTile.tsx` instead of erroring.
- Permission denied: import a folder-backed chat, revoke the site's file permission via `chrome://settings` or by using a different browser profile, reload, confirm it lands back on `ImportScreen` rather than crashing.

- [ ] **Step 4: Commit**

```bash
git add src/App.css src/App.tsx
git commit -m "feat: handle unsupported-browser and permission-denied states"
```

---

### Task 20: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all parser, storage, and selector tests pass (Tasks 3–6, 9, 11).

- [ ] **Step 2: Typecheck the whole project**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual golden-path + edge-case walkthrough in Chrome**

Repeat Task 18 Step 3's golden path plus Task 19 Step 3's edge cases in one sitting against a real multi-day, multi-media-type export, confirming: grid stays smooth scrolled through hundreds of tiles, thumbnails only load near-viewport (check DevTools Network panel shows no burst of file reads on initial paint), search/filters compose correctly, and a full reload restores the same chat with starred flags intact.

- [ ] **Step 4: Fix any issues found, committing each fix separately**

No placeholder here — if Step 3 surfaces a bug, treat it as a new bite-sized task: write/adjust a test if the bug is in parser/storage/selector logic, fix, verify, commit with a `fix:` message.
