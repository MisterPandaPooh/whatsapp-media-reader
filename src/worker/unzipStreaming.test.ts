import { describe, it, expect } from 'vitest'
import { zipSync, strToU8, strFromU8 } from 'fflate'
import { unzipStreaming } from './unzipStreaming'

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
})
