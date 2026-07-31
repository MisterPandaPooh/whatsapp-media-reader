import { describe, it, expect } from 'vitest'
import { zipSync, strToU8, strFromU8 } from 'fflate'
import { unzipStreaming, decodeZipEntryName } from './unzipStreaming'

function concat(chunks: Uint8Array[]): Uint8Array {
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
 * Rewrites a zip so its filenames are still UTF-8 bytes but the general-purpose
 * "language encoding" flag (bit 11) is NOT set — exactly what macOS `zip` and
 * `ditto` (Finder's "Compress") produce. fflate's `zipSync` sets bit 11 whenever a
 * name has non-ASCII bytes, so we clear it in both the local file headers and the
 * central directory records to reproduce the macOS archive shape.
 */
function clearUtf8Flag(zip: Uint8Array): Uint8Array {
  const out = zip.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true)
    // Flags are a 16-bit LE field; bit 11 is bit 3 of its high byte.
    if (sig === 0x04034b50) out[i + 7] &= ~0x08
    else if (sig === 0x02014b50) out[i + 9] &= ~0x08
  }
  return out
}

describe('unzipStreaming', () => {
  it('decompresses multiple entries, in order, with correct content', async () => {
    const zipBytes = zipSync({
      '_chat.txt': strToU8('hello world'),
      'IMG-001.jpg': new Uint8Array([1, 2, 3, 4, 5]),
    })

    const order: string[] = []
    const collected: Record<string, Uint8Array[]> = {}

    await unzipStreaming(zipBytes, (name) => {
      order.push(name)
      collected[name] = []
      return (chunk) => {
        collected[name].push(chunk.slice())
      }
    })

    expect(order).toEqual(['_chat.txt', 'IMG-001.jpg'])
    expect(strFromU8(concat(collected['_chat.txt']))).toBe('hello world')
    expect(concat(collected['IMG-001.jpg'])).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  it('marks the final chunk of each entry with isLast', async () => {
    const zipBytes = zipSync({ 'a.txt': strToU8('abc') })

    const finalFlags: boolean[] = []
    await unzipStreaming(zipBytes, () => {
      return (_chunk, isLast) => {
        finalFlags.push(isLast)
      }
    })

    expect(finalFlags.length).toBeGreaterThan(0)
    expect(finalFlags[finalFlags.length - 1]).toBe(true)
    expect(finalFlags.slice(0, -1)).not.toContain(true)
  })

  it('streams a large entry across multiple internal push() chunks and preserves byte order', async () => {
    // Bigger than unzipStreaming's internal 1MB push slice, so this exercises a file
    // whose compressed data spans multiple Unzip.push() calls.
    const big = new Uint8Array(3 * 1024 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = i % 256

    // Store (no compression) to keep the test fast.
    const zipBytes = zipSync({ 'video.mp4': [big, { level: 0 }] })

    const chunks: Uint8Array[] = []
    let seenName = ''
    await unzipStreaming(zipBytes, (name) => {
      seenName = name
      return (chunk) => {
        chunks.push(chunk.slice())
      }
    })

    expect(seenName).toBe('video.mp4')
    expect(concat(chunks)).toEqual(big)
  })

  it('propagates an error thrown by the chunk handler', async () => {
    const zipBytes = zipSync({ 'a.txt': strToU8('x') })

    await expect(
      unzipStreaming(zipBytes, () => {
        return () => {
          throw new Error('boom')
        }
      }),
    ).rejects.toThrow('boom')
  })

  it('reports progress based on compressed bytes consumed', async () => {
    const zipBytes = zipSync({ 'a.txt': strToU8('hello') })

    const progressCalls: Array<[number, number]> = []
    await unzipStreaming(
      zipBytes,
      () => () => {},
      (consumed, total) => progressCalls.push([consumed, total]),
    )

    expect(progressCalls.length).toBeGreaterThan(0)
    const [lastConsumed, lastTotal] = progressCalls[progressCalls.length - 1]
    expect(lastConsumed).toBe(lastTotal)
    expect(lastTotal).toBe(zipBytes.length)
  })

  it('decodes a UTF-8 entry name whose zip UTF-8 flag is set (fflate already handles this)', async () => {
    const name = 'שלום-תמונה.png'
    const zipBytes = zipSync({ [name]: new Uint8Array([1, 2, 3]) })

    const names: string[] = []
    await unzipStreaming(zipBytes, (entryName) => {
      names.push(entryName)
      return () => {}
    })

    expect(names).toEqual([name])
  })

  it('decodes a UTF-8 entry name even when the zip UTF-8 flag is NOT set (macOS zip/ditto)', async () => {
    // macOS `zip`/`ditto` write UTF-8 filename bytes without setting bit 11, so
    // fflate falls back to CP437/Latin-1 and produces mojibake ("×©×××-...").
    const name = 'שלום-תמונה.png'
    const zipBytes = clearUtf8Flag(zipSync({ [name]: [new Uint8Array([1, 2, 3]), { level: 0 }] }))

    const names: string[] = []
    const collected: Uint8Array[] = []
    await unzipStreaming(zipBytes, (entryName) => {
      names.push(entryName)
      return (chunk) => {
        collected.push(chunk.slice())
      }
    })

    expect(names).toEqual([name])
    expect(concat(collected)).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('decodeZipEntryName', () => {
  it('leaves a pure-ASCII name untouched', () => {
    expect(decodeZipEntryName('IMG-20240101-WA0001.jpg')).toBe('IMG-20240101-WA0001.jpg')
  })

  it('re-decodes a Latin-1-mangled UTF-8 name', () => {
    const utf8 = strToU8('שלום-תמונה.png')
    let latin1 = ''
    for (const byte of utf8) latin1 += String.fromCharCode(byte)
    expect(decodeZipEntryName(latin1)).toBe('שלום-תמונה.png')
  })

  it('re-decodes a Latin-1-mangled UTF-8 name inside a directory path', () => {
    const utf8 = strToU8('תיקייה/קובץ.jpg')
    let latin1 = ''
    for (const byte of utf8) latin1 += String.fromCharCode(byte)
    expect(decodeZipEntryName(latin1)).toBe('תיקייה/קובץ.jpg')
  })

  it('leaves an already-correctly-decoded non-ASCII name untouched', () => {
    // The UTF-8 flag was set, so fflate decoded properly — this string is NOT a
    // Latin-1 byte-per-code-unit reading and must not be round-tripped.
    expect(decodeZipEntryName('שלום.png')).toBe('שלום.png')
  })

  it('keeps a genuinely Latin-1 name that is not valid UTF-8', () => {
    // "café.jpg" in Latin-1: 0xE9 is a lead byte with no continuation byte, so
    // strict UTF-8 decoding fails and we keep the Latin-1 reading.
    expect(decodeZipEntryName('café.jpg')).toBe('café.jpg')
  })
})
