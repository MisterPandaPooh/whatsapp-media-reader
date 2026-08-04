import type { ImportProgress } from '../types'
import type { ZipSource } from './unzipStreaming'
import { unzipStreaming } from './unzipStreaming'

/** The name WhatsApp always gives the transcript inside an export. */
const CHAT_FILENAME = '_chat.txt'

/** A `.txt` entry buffered while we wait to see whether a real `_chat.txt` follows. */
type TxtCandidate = { name: string; chunks: Uint8Array<ArrayBuffer>[] }

function concatChunks(chunks: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
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
 * macOS AppleDouble sidecars: Finder's "Compress" (and `ditto`) store each file's
 * resource fork / extended attributes as a parallel `__MACOSX/…/._name` entry, and
 * bare `._name` entries also appear when a Mac writes to a non-native filesystem.
 * They're never referenced by the transcript, so writing them to OPFS just doubles the
 * archive's storage footprint — a real export produced 265 entries where only 132 were
 * needed. Skipping them also removes the risk of `__MACOSX/.__chat.txt` (the sidecar
 * for `_chat.txt`) being mistaken for the transcript itself.
 */
function isAppleDoubleEntry(path: string, basename: string): boolean {
  if (path.split('/').some((segment) => segment === '__MACOSX')) return true
  return basename.startsWith('._')
}

/**
 * A view whose bytes are *exactly* the bytes meant for the file.
 *
 * fflate hands back subarrays of a larger buffer, and for a stored
 * (uncompressed) entry — which is what both a WhatsApp export and this project's
 * own demo archive contain — that subarray points into the 1 MB slice being
 * pushed through the decompressor.
 *
 * Chromium's `FileSystemWritableFileStream.write()` honours a view's
 * `byteOffset`/`byteLength`. WebKit writes the whole backing `ArrayBuffer`, so
 * every media file arrived on disk as the entire 1 MB slice: a 110 KB photo
 * stored as a megabyte of mostly other files' bytes. Nothing decoded, so every
 * tile in Safari failed with `error loading url blob:…`, and a 108 MB export
 * occupied 1.08 GB of origin storage — ten times its real size, which is how the
 * bug was finally spotted.
 *
 * Copying only when the view does not already cover its buffer keeps the case
 * that was always correct free of an extra allocation.
 */
function exactly(chunk: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
    ? chunk
    : chunk.slice()
}

export async function extractZipToOpfs(
  zipBytes: ZipSource,
  folderName: string,
  onProgress: (p: ImportProgress) => void,
): Promise<{ chatText: string; mediaFilenames: string[] }> {
  onProgress({ stage: 'reading', progress: 0 })

  const root = await navigator.storage.getDirectory()
  const chatDir = await root.getDirectoryHandle(folderName, { create: true })

  let chatText = ''
  const mediaFilenames: string[] = []
  // Whether an entry named `_chat.txt` has already been claimed as "the chat file".
  // This must be decided synchronously at dispatch time (inside onEntry, before any
  // async chunk work runs) — onEntry fires synchronously for every entry as it's
  // scanned, so if two .txt entries land in the same push slice, both would see an
  // unassigned `chatText` and both would race to claim it if we checked `!chatText`
  // instead. Checking/setting this flag here restores the original for-loop's
  // deterministic "first match wins" guarantee.
  let chatFileClaimed = false
  // Holds at most one entry: the first non-`_chat.txt` .txt, kept as a *provisional*
  // transcript. We can't know at dispatch time whether a real `_chat.txt` appears later
  // in the archive, and onEntry must decide synchronously (see above) — so rather than
  // peeking ahead, this candidate's bytes are buffered and the winner is resolved after
  // the scan. Buffering is safe: either it turns out to be the transcript (always
  // small), or it's a .txt attachment, which is flushed to OPFS as media at the end.
  // Claiming stays a synchronous, single-writer decision — `chatFileClaimed` and this
  // slot are only ever read/written inside onEntry, never from an async chunk handler,
  // so two .txt entries in one push slice still can't both claim the transcript.
  const provisionalChat: TxtCandidate[] = []

  try {
    onProgress({ stage: 'extracting', progress: 10 })

    const writeMedia = (cleanName: string) => {
      // Media file: stream each decompressed chunk straight into an OPFS
      // writable as it arrives, instead of buffering the whole file in memory.
      mediaFilenames.push(cleanName)
      let writable: FileSystemWritableFileStream | null = null
      return async (chunk: Uint8Array<ArrayBuffer>, isLast: boolean) => {
        if (!writable) {
          const fileHandle = await chatDir.getFileHandle(cleanName, { create: true })
          writable = await fileHandle.createWritable()
        }
        if (chunk.length) await writable.write(exactly(chunk))
        if (isLast) await writable.close()
      }
    }

    await unzipStreaming(
      zipBytes,
      (name) => {
        // Directory entries carry no bytes of their own — nothing to write.
        if (name.endsWith('/')) return () => {}

        const filename = name.split('/').pop() ?? name
        const cleanName = filename.replace(/^﻿/, '')

        // Drop macOS AppleDouble junk before anything else, so it can neither be
        // written to OPFS nor claimed as the transcript.
        if (isAppleDoubleEntry(name, cleanName)) return () => {}

        if (cleanName.toLowerCase().endsWith('.txt') && !chatFileClaimed) {
          if (cleanName.toLowerCase() === CHAT_FILENAME) {
            // A real `_chat.txt` always wins outright — decided synchronously, right
            // here, so two entries in the same push slice can never both claim it.
            chatFileClaimed = true
            // The chat transcript is always small, so buffering it fully (rather than
            // writing it to OPFS) is fine — Task 10's import worker needs it as a
            // string immediately anyway.
            const decoder = new TextDecoder()
            let text = ''
            return (chunk, isLast) => {
              text += decoder.decode(chunk, { stream: !isLast })
              if (isLast) chatText = text
            }
          }

          if (provisionalChat.length === 0) {
            // Some exports name the transcript something else ("WhatsApp Chat with
            // Ana.txt"), so the first .txt is still a candidate — but only
            // provisionally, until we know whether a `_chat.txt` follows. Buffer it;
            // it's resolved (as transcript, or flushed as media) after the scan.
            const candidate: TxtCandidate = { name: cleanName, chunks: [] }
            provisionalChat.push(candidate)
            return (chunk) => {
              if (chunk.length) candidate.chunks.push(chunk.slice())
            }
          }
        }

        return writeMedia(cleanName)
      },
      (bytesConsumed, totalBytes) => {
        const fraction = totalBytes > 0 ? bytesConsumed / totalBytes : 1
        onProgress({ stage: 'extracting', progress: 10 + Math.round(fraction * 80) })
      },
    )

    // Resolve the provisional candidate now that the whole archive has been scanned.
    const candidate = provisionalChat[0]
    if (candidate) {
      const bytes = concatChunks(candidate.chunks)
      if (chatFileClaimed) {
        // A real `_chat.txt` turned up later, so this was only a .txt attachment —
        // flush its buffered bytes to OPFS as media, which the streaming path skipped.
        await writeMedia(candidate.name)(bytes, true)
      } else {
        chatText = new TextDecoder().decode(bytes)
      }
    }

    if (!chatText) {
      throw new Error('No _chat.txt file found in the zip archive.')
    }

    // Keep the transcript alongside the media rather than only handing it back as
    // a string. A zip-imported chat has no other copy of its source — the archive
    // the user dropped is gone once the import finishes — so without this the
    // parse could never be redone, and a later parser fix could not reach a chat
    // already in the library (see PARSER_VERSION). Deliberately not added to
    // `mediaFilenames`: it is the source, not an attachment.
    const chatFile = await chatDir.getFileHandle(CHAT_FILENAME, { create: true })
    const chatWritable = await chatFile.createWritable()
    await chatWritable.write(new TextEncoder().encode(chatText))
    await chatWritable.close()

    onProgress({ stage: 'extracting', progress: 100 })
    return { chatText, mediaFilenames }
  } catch (err) {
    // Don't leave a partial OPFS folder behind on any failure (including the
    // "no chat text found" case above) — a retry with the same folderName would
    // otherwise accumulate orphaned files on top of whatever caused the original
    // failure, making a quota-exceeded retry strictly worse. The inner .catch is
    // intentional: a cleanup failure must not mask the original error.
    await root.removeEntry(folderName, { recursive: true }).catch(() => {})
    throw err
  }
}
