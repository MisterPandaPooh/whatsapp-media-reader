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
    expect(Object.keys(written)).toEqual(['readme.txt'])
  })
})
