// src/worker/macosExport.test.ts
//
// End-to-end regression test over a REAL macOS export.
//
// `src/worker/fixtures/macos-ditto-export.zip` was produced by `ditto -c -k
// --sequesterRsrc --keepParent`, which is exactly what Finder's "Compress" runs.
// That matters: a synthesized zip does not reproduce what actually broke here.
// A ditto archive really does carry
//   - UTF-8 filename bytes with the zip's UTF-8 flag (bit 11) left UNSET,
//   - a parallel `__MACOSX/…/._name` sidecar for every entry,
//   - `__MACOSX/….__chat.txt`, the sidecar for the transcript itself,
//   - accented names stored decomposed (NFD) while the transcript spells them
//     composed (NFC).
//
// Three separate bugs lived in those four facts, and each one showed the user
// the same thing: a file they knew they had sent, sitting right there in the
// archive, displayed as "Missing" with Download greyed out. This test asserts on
// the count and identity of missing items because that is the symptom that
// makes a reader like this untrustworthy.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractZipToOpfs } from './zipExtract'
import { reconcileMediaWithFiles } from './mediaCatalog'
import { parseChat } from '../parser/chatParser'

const zipBytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'macos-ditto-export.zip')))

// The two attachments the transcript references that were deliberately never put
// in the archive. Everything else it references is present and must resolve.
const GENUINELY_ABSENT = ['IMG-20260727-WA0099.jpg', 'Missing Report Draft.pdf']

/** Minimal OPFS stand-in: records what was written, and under exactly what name. */
function createStubOpfsRoot() {
  const written = new Map<string, number>()
  const dirHandle = {
    getFileHandle: async (name: string) => {
      let size = 0
      return {
        createWritable: async () => ({
          write: async (chunk: Uint8Array) => {
            size += chunk.length
            written.set(name, size)
          },
          close: async () => {
            if (!written.has(name)) written.set(name, 0)
          },
        }),
      }
    },
  }
  return {
    root: { getDirectoryHandle: async () => dirHandle, removeEntry: async () => {} },
    written,
  }
}

async function importFixture() {
  const { root, written } = createStubOpfsRoot()
  // @ts-expect-error test-only stub, not a full StorageManager
  navigator.storage = { getDirectory: async () => root }

  const { chatText, mediaFilenames } = await extractZipToOpfs(zipBytes, 'chat-1', () => {})
  const parsed = parseChat(chatText, 'chat-1')
  const media = reconcileMediaWithFiles(parsed.media, written)
  return { chatText, mediaFilenames, parsed, media, written }
}

afterEach(() => {
  // @ts-expect-error test-only stub
  delete navigator.storage
})

describe('a real macOS (ditto/Finder-compressed) WhatsApp export', () => {
  it('reports as missing exactly the attachments that are genuinely absent', async () => {
    const { media } = await importFixture()
    const missing = media.filter((m) => m.missing).map((m) => m.filename)

    // The assertion that covers all three bugs at once: no file present in the
    // archive may be reported missing, whatever its name is spelled like.
    expect(missing.sort()).toEqual([...GENUINELY_ABSENT].sort())
  })

  it('resolves filenames with spaces, parentheses, accents, Hebrew and emoji', async () => {
    const { media } = await importFixture()
    const present = new Set(media.filter((m) => !m.missing).map((m) => m.filename))

    // Spaces: the Android "(file attached)" marker used to truncate at the last
    // space, yielding "Review.pdf" and a permanently-missing tile.
    expect(present).toContain('Q1 Budget Review.pdf')
    expect(present).toContain('Meeting Notes (final).docx')
    // Non-ASCII: mangled to mojibake when the UTF-8 flag was ignored.
    expect(present).toContain('שלום-תמונה.png')
    expect(present).toContain('photo 🎉 party.jpg')
    // Accented: stored NFD by macOS, written NFC in the transcript.
    expect(present).toContain('café.jpg')
    expect(present).toContain('Relatório Anual.pdf')
    // Double extension, to pin the extension-matching in the marker regex.
    expect(present).toContain('archive.tar.gz')
  })

  it('leaves no attachment-marker residue in captions', async () => {
    const { media } = await importFixture()
    for (const item of media) {
      expect(item.caption).not.toContain('(file attached)')
      expect(item.caption).not.toContain('<attached:')
      // The truncation bug also glued the dropped words onto the caption:
      // "Q1 Budget Review.pdf" → filename "Review.pdf", caption "Q1 Budget …".
      expect(item.caption).not.toContain('Q1 Budget Review')
    }
    const budget = media.find((m) => m.filename === 'Q1 Budget Review.pdf')
    expect(budget?.caption).toBe('the numbers we discussed')
  })

  it('picks the real _chat.txt, not a sidecar or an attached .txt', async () => {
    const { chatText } = await importFixture()
    // The archive contains `__MACOSX/….__chat.txt` (the transcript's own
    // AppleDouble sidecar) and `notes.txt` (a genuine .txt attachment). Claiming
    // either as the transcript yields a garbage or empty parse.
    expect(chatText).toContain('Alice Cohen')
    expect(chatText.startsWith('27/07/2026')).toBe(true)
  })

  it('writes no AppleDouble sidecars into storage', async () => {
    const { written } = await importFixture()
    const junk = [...written.keys()].filter((n) => n.startsWith('._') || n.includes('__MACOSX'))
    expect(junk).toEqual([])
  })

  it('parses the Android date format, senders and participants', async () => {
    const { parsed } = await importFixture()
    expect(parsed.messages.length).toBeGreaterThan(10)
    expect(parsed.participants).toContain('Alice Cohen')
    expect(parsed.participants).toContain('Bob Levy')
    // A non-ASCII sender name must survive as a participant.
    expect(parsed.participants).toContain('שרה לוי')
  })

  it('extracts a bare URL as a link item', async () => {
    const { media } = await importFixture()
    const link = media.find((m) => m.kind === 'link')
    expect(link?.filename).toContain('example.com/report')
    // A link is not a file in the export, so it is never "missing".
    expect(link?.missing).toBe(false)
  })
})
