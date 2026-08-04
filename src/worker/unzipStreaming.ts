import { Unzip, UnzipInflate } from 'fflate'

/**
 * Called one or more times per zip entry, in order, with each chunk of that entry's
 * decompressed bytes. `isLast` is true on the final call for the entry (which may
 * also be the only call, e.g. for a zero-byte or single-chunk file).
 *
 * May return a Promise. `unzipStreaming` awaits it before feeding the decompressor
 * more compressed input, which bounds how much decompressed data can be in flight at
 * once — this backpressure is what makes extraction actually stream instead of
 * buffering the whole archive's decompressed contents in memory simultaneously.
 *
 * `chunk` is typed `Uint8Array<ArrayBuffer>` (not the wider `Uint8Array` /
 * `Uint8Array<ArrayBufferLike>`) to match fflate's own `AsyncFlateStreamHandler`
 * signature, which is what actually produces these chunks — every chunk fflate hands
 * back is backed by a fresh `ArrayBuffer`, never a `SharedArrayBuffer`. Keeping that
 * precision here (instead of widening to plain `Uint8Array`) lets callers pass chunks
 * into DOM APIs whose `FileSystemWriteChunkType` requires an `ArrayBuffer`-backed
 * view, without needing an unsafe cast at the call site.
 *
 * A chunk is a *view*, not a whole buffer — usually a subarray of the slice being
 * pushed through the decompressor. Anything handing one to a browser API that takes
 * a BufferSource must make sure the view covers its buffer first: WebKit's
 * `FileSystemWritableFileStream.write()` ignores `byteOffset`/`byteLength` and writes
 * the entire backing `ArrayBuffer`. See `exactly()` in zipExtract.ts.
 */
export type UnzipChunkHandler = (chunk: Uint8Array<ArrayBuffer>, isLast: boolean) => void | Promise<void>

/**
 * Called synchronously once per entry, in the order entries appear in the archive.
 * Must synchronously return the handler that will receive that entry's decompressed
 * chunks.
 */
export type UnzipEntryHandler = (name: string) => UnzipChunkHandler

// Size of the slices we feed into fflate's streaming `Unzip.push()`. Pushing the raw
// zip bytes in bounded slices (rather than the whole archive in one call) lets us
// await pending chunk-handler work between pushes, which is what keeps memory bounded
// to roughly one slice's worth of in-flight decompressed data rather than the whole
// archive's worth.
const PUSH_CHUNK_SIZE = 1024 * 1024 // 1MB

// Strict decoder: throws on any byte sequence that isn't well-formed UTF-8, which is
// exactly the validity test the sniff below needs.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Repairs zip entry names that are UTF-8 bytes stored *without* the zip general-purpose
 * "language encoding" flag (bit 11).
 *
 * fflate does honour bit 11 — it calls `strFromU8(nameBytes, !(flags & 2048))`, whose
 * second argument selects Latin-1 — so flagged archives decode correctly. But macOS
 * `zip` and `ditto` (what Finder's
 * "Compress" uses) write UTF-8 filename bytes and leave bit 11 clear, so fflate takes
 * the Latin-1 branch and we get classic mojibake: `שלום-תמונה.png` arrives as
 * `×©×××-×ª××× ×.png`, the parser's lookup misses, and the item shows as Missing.
 *
 * fflate's streaming `Unzip` surfaces only `{ name, compression, size, originalSize }`
 * on each entry — neither the raw filename bytes nor the flag word are exposed — so we
 * can't consult bit 11 ourselves without re-parsing the local file headers by hand.
 * Instead we undo fflate's Latin-1 reading and re-decode: the Latin-1 branch is
 * `String.fromCharCode` per byte, so every code unit is 0x00–0xFF and `charCodeAt(i)`
 * recovers the original byte exactly (a lossless round-trip). If those bytes are valid
 * UTF-8, the name was mis-flagged and we use the UTF-8 reading; otherwise we keep what
 * fflate gave us.
 *
 * False-positive risk: a name that is *genuinely* CP437/Latin-1 and also happens to be
 * well-formed UTF-8 would be re-decoded wrongly. That needs a high byte in 0xC2–0xF4
 * (`Â`–`ô`) followed by exactly the right count of bytes in 0x80–0xBF — in Latin-1 text
 * that range is control codes and stray punctuation/symbols, which essentially never
 * follow an accented letter in a real filename. The classic collision, `Ã©` → `é`, is
 * itself already mojibake, so "fixing" it is the desired outcome anyway. Two cheap
 * guards keep the sniff off everything else: names with no byte above 0x7F are returned
 * untouched, and a name containing any code unit above 0xFF cannot have come from the
 * Latin-1 branch (the UTF-8 flag was set and fflate decoded it properly), so it's left
 * alone too.
 */
export function decodeZipEntryName(name: string): string {
  let hasHighByte = false
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    // Above 0xFF ⇒ fflate used its UTF-8 branch; nothing to repair.
    if (code > 0xff) return name
    if (code > 0x7f) hasHighByte = true
  }
  if (!hasHighByte) return name

  const bytes = new Uint8Array(name.length)
  for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i)
  try {
    return strictUtf8.decode(bytes)
  } catch {
    // Not valid UTF-8 — a genuine CP437/Latin-1 name. Keep fflate's reading.
    return name
  }
}

/**
 * Decompresses a zip archive using fflate's true streaming API (`Unzip` registered
 * with the synchronous `UnzipInflate` decoder), invoking `onEntry` as each file is
 * discovered and its returned handler as that file's bytes decompress.
 *
 * Pure decompression logic only — no filesystem/OPFS access — so this is safe to
 * unit test without any browser-only APIs.
 *
 * @param onProgress optional callback reporting how many of the archive's compressed
 * input bytes have been fed to the decompressor so far, for UI progress reporting.
 */
/**
 * Either the archive already in memory, or — for a real export — the File the
 * user picked, which is read a slice at a time and never fully materialized.
 *
 * `Blob.arrayBuffer()` over a whole export is what this exists to avoid: it has
 * to allocate one contiguous buffer the size of the file, and Chrome gives up
 * around a gigabyte with `NotReadableError: The requested file could not be
 * read, typically due to permission problems…` — a message that has nothing to
 * do with permissions and sends you looking in entirely the wrong place.
 */
export type ZipSource = Uint8Array | Blob

function sourceSize(source: ZipSource): number {
  return source instanceof Uint8Array ? source.length : source.size
}

/** Only ever asked for one push slice, so peak memory is the slice, not the file. */
async function readSlice(source: ZipSource, start: number, end: number): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source.subarray(start, end)
  return new Uint8Array(await source.slice(start, end).arrayBuffer())
}

export async function unzipStreaming(
  zipBytes: ZipSource,
  onEntry: UnzipEntryHandler,
  onProgress?: (bytesConsumed: number, totalBytes: number) => void,
): Promise<void> {
  let pending: Promise<void> = Promise.resolve()
  let failure: unknown
  let hasFailure = false

  const recordFailure = (err: unknown) => {
    if (!hasFailure) {
      hasFailure = true
      failure = err
    }
  }

  const unzipper = new Unzip((file) => {
    const handleChunk = onEntry(decodeZipEntryName(file.name))
    file.ondata = (err, chunk, isLast) => {
      if (err) {
        recordFailure(err)
        return
      }
      pending = pending.then(() => handleChunk(chunk, isLast)).catch(recordFailure)
    }
    file.start()
  })
  unzipper.register(UnzipInflate)

  const total = sourceSize(zipBytes)
  if (total === 0) {
    // A well-formed zip is never actually empty (even an empty archive has a 22-byte
    // End of Central Directory record), but guard anyway so we don't skip the final
    // push for a degenerate input.
    unzipper.push(new Uint8Array(0), true)
  } else {
    for (let offset = 0; offset < total; offset += PUSH_CHUNK_SIZE) {
      const end = Math.min(offset + PUSH_CHUNK_SIZE, total)
      const isLast = end >= total
      unzipper.push(await readSlice(zipBytes, offset, end), isLast)
      // Wait for everything decompressed so far to be handed off before pulling in
      // more compressed input — this is the backpressure that bounds memory use.
      await pending
      if (hasFailure) throw failure
      onProgress?.(end, total)
    }
  }

  await pending
  if (hasFailure) throw failure
}
