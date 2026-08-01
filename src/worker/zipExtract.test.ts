import { describe, it, expect, afterEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractZipToOpfs } from './zipExtract'

// extractZipToOpfs needs navigator.storage.getDirectory(), which jsdom doesn't
// implement. Real OPFS read/write correctness is intentionally left untested here
// (per the project's existing "don't mock OPFS to force a test" guidance) — this
// stub exists only to exercise extractZipToOpfs's synchronous entry-routing control
// flow (which .txt entry becomes the chat text vs. which entries are written as
// media), not to verify actual file-system persistence.
function createStubOpfsRoot() {
  const written: Record<string, Uint8Array[]> = {}

  const dirHandle = {
    getFileHandle: async (name: string) => {
      const chunks: Uint8Array[] = []
      written[name] = chunks
      return {
        createWritable: async () => ({
          write: async (chunk: Uint8Array) => {
            chunks.push(chunk)
          },
          close: async () => {},
        }),
      }
    },
  }

  const root = {
    getDirectoryHandle: async () => dirHandle,
    removeEntry: async () => {},
  }

  return { root, written }
}

function concatWritten(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Clears the zip UTF-8 general-purpose flag (bit 11) on every header, reproducing
 * what macOS `zip`/`ditto` (Finder's "Compress") emit: UTF-8 filename bytes with the
 * flag unset. See unzipStreaming.test.ts for the same helper.
 */
function clearUtf8Flag(zip: Uint8Array): Uint8Array {
  const out = zip.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true)
    if (sig === 0x04034b50) out[i + 7] &= ~0x08
    else if (sig === 0x02014b50) out[i + 9] &= ~0x08
  }
  return out
}

describe('extractZipToOpfs', () => {
  afterEach(() => {
    // @ts-expect-error test-only stub, not a full FileSystemDirectoryHandle
    delete navigator.storage
  })

  it('deterministically picks the FIRST .txt entry as the chat text, not whichever one finishes async decoding last', async () => {
    // Regression test: onEntry dispatches synchronously for every zip entry as it's
    // scanned, but chatText itself is only assigned later, inside each entry's async
    // chunk-handler chain. If the "is this the chat file?" decision checked
    // `!chatText` (an async-assigned value) instead of a flag set synchronously at
    // dispatch time, two .txt entries landing in the same push slice would BOTH see
    // chatText unassigned and both race to claim it — whichever one's deferred
    // handler resolved last would silently overwrite the real chat text with no
    // error. This zip reproduces exactly that shape: two small .txt entries, both
    // well within a single 1MB push slice.
    const { root, written } = createStubOpfsRoot()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).storage = { getDirectory: async () => root }

    const zipBytes = zipSync({
      '_chat.txt': strToU8('REAL CHAT CONTENT'),
      'readme.txt': strToU8('SOME OTHER TXT'),
    })

    const result = await extractZipToOpfs(zipBytes, 'test-folder', () => {})

    expect(result.chatText).toBe('REAL CHAT CONTENT')
    expect(result.mediaFilenames).toEqual(['readme.txt'])
    expect(Object.keys(written).sort()).toEqual(['readme.txt', '_chat.txt'].sort())
    // The transcript is kept in OPFS as well as returned: the dropped archive is
    // gone after the import, and this copy is the only thing that lets a later
    // parser fix be applied to a chat already in the library.
    expect(new TextDecoder().decode(concatWritten(written['_chat.txt']))).toBe('REAL CHAT CONTENT')
  })

  it('prefers an entry named _chat.txt over an earlier, differently-named .txt', async () => {
    const { root, written } = createStubOpfsRoot()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).storage = { getDirectory: async () => root }

    // Entry order matters: the non-transcript .txt comes FIRST, so a plain
    // "first .txt wins" rule would claim it as the transcript.
    const zipBytes = zipSync({
      'notes.txt': strToU8('SOME OTHER TXT'),
      '_chat.txt': strToU8('REAL CHAT CONTENT'),
    })

    const result = await extractZipToOpfs(zipBytes, 'test-folder', () => {})

    expect(result.chatText).toBe('REAL CHAT CONTENT')
    // The demoted candidate is still a real attachment — it must reach OPFS.
    expect(result.mediaFilenames).toEqual(['notes.txt'])
    expect(Object.keys(written).sort()).toEqual(['notes.txt', '_chat.txt'].sort())
    expect(Array.from(concatWritten(written['notes.txt']))).toEqual(
      Array.from(strToU8('SOME OTHER TXT')),
    )
  })

  it('falls back to the first .txt when no entry is named _chat.txt', async () => {
    const { root, written } = createStubOpfsRoot()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).storage = { getDirectory: async () => root }

    const zipBytes = zipSync({
      'WhatsApp Chat with Ana.txt': strToU8('FALLBACK CHAT CONTENT'),
      'later.txt': strToU8('SOME OTHER TXT'),
    })

    const result = await extractZipToOpfs(zipBytes, 'test-folder', () => {})

    expect(result.chatText).toBe('FALLBACK CHAT CONTENT')
    expect(result.mediaFilenames).toEqual(['later.txt'])
    expect(Object.keys(written).sort()).toEqual(['later.txt', '_chat.txt'].sort())
  })

  it('never claims an AppleDouble sidecar as the chat transcript', async () => {
    const { root } = createStubOpfsRoot()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).storage = { getDirectory: async () => root }

    // Finder's "Compress" puts its AppleDouble sidecars in __MACOSX/ FIRST, so the
    // sidecar for _chat.txt is scanned before the real transcript.
    const zipBytes = zipSync({
      '__MACOSX/.__chat.txt': strToU8('APPLEDOUBLE JUNK'),
      '_chat.txt': strToU8('REAL CHAT CONTENT'),
    })

    const result = await extractZipToOpfs(zipBytes, 'test-folder', () => {})

    expect(result.chatText).toBe('REAL CHAT CONTENT')
  })

  it('skips macOS AppleDouble entries instead of writing them to OPFS', async () => {
    const { root, written } = createStubOpfsRoot()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).storage = { getDirectory: async () => root }

    const zipBytes = zipSync({
      '_chat.txt': strToU8('REAL CHAT CONTENT'),
      'IMG-001.jpg': new Uint8Array([1, 2, 3]),
      '__MACOSX/._IMG-001.jpg': new Uint8Array([9, 9, 9]),
      '__MACOSX/._chat.txt': new Uint8Array([9, 9]),
      '._IMG-001.jpg': new Uint8Array([9]),
      '__MACOSX/sub/._nested.png': new Uint8Array([9]),
    })

    const result = await extractZipToOpfs(zipBytes, 'test-folder', () => {})

    expect(result.chatText).toBe('REAL CHAT CONTENT')
    expect(result.mediaFilenames).toEqual(['IMG-001.jpg'])
    expect(Object.keys(written).sort()).toEqual(['IMG-001.jpg', '_chat.txt'].sort())
  })

  it('writes a non-ASCII media filename correctly when the zip UTF-8 flag is unset', async () => {
    const { root, written } = createStubOpfsRoot()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).storage = { getDirectory: async () => root }

    const zipBytes = clearUtf8Flag(
      zipSync({
        '_chat.txt': [strToU8('REAL CHAT CONTENT'), { level: 0 }],
        'שלום-תמונה.png': [new Uint8Array([1, 2, 3]), { level: 0 }],
      }),
    )

    const result = await extractZipToOpfs(zipBytes, 'test-folder', () => {})

    expect(result.mediaFilenames).toEqual(['שלום-תמונה.png'])
    expect(Object.keys(written).sort()).toEqual(['שלום-תמונה.png', '_chat.txt'].sort())
  })
})
