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
 * straight into DOM APIs like `FileSystemWritableFileStream.write()`, whose
 * `FileSystemWriteChunkType` requires an `ArrayBuffer`-backed view, without needing an
 * unsafe cast at the call site.
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
export async function unzipStreaming(
  zipBytes: Uint8Array,
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
    const handleChunk = onEntry(file.name)
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

  const total = zipBytes.length
  if (total === 0) {
    // A well-formed zip is never actually empty (even an empty archive has a 22-byte
    // End of Central Directory record), but guard anyway so we don't skip the final
    // push for a degenerate input.
    unzipper.push(zipBytes, true)
  } else {
    for (let offset = 0; offset < total; offset += PUSH_CHUNK_SIZE) {
      const end = Math.min(offset + PUSH_CHUNK_SIZE, total)
      const isLast = end >= total
      unzipper.push(zipBytes.subarray(offset, end), isLast)
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
