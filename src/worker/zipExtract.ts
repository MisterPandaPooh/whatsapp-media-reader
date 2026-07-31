import type { ImportProgress } from '../types'
import { unzipStreaming } from './unzipStreaming'

export async function extractZipToOpfs(
  zipBytes: Uint8Array,
  folderName: string,
  onProgress: (p: ImportProgress) => void,
): Promise<{ chatText: string; mediaFilenames: string[] }> {
  onProgress({ stage: 'reading', progress: 0 })

  const root = await navigator.storage.getDirectory()
  const chatDir = await root.getDirectoryHandle(folderName, { create: true })

  let chatText = ''
  const mediaFilenames: string[] = []

  try {
    onProgress({ stage: 'extracting', progress: 10 })

    await unzipStreaming(
      zipBytes,
      (name) => {
        // Directory entries carry no bytes of their own — nothing to write.
        if (name.endsWith('/')) return () => {}

        const filename = name.split('/').pop() ?? name
        const cleanName = filename.replace(/^﻿/, '')

        if (cleanName.toLowerCase().endsWith('.txt') && !chatText) {
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

        // Media file: stream each decompressed chunk straight into an OPFS
        // writable as it arrives, instead of buffering the whole file in memory.
        mediaFilenames.push(cleanName)
        let writable: FileSystemWritableFileStream | null = null
        return async (chunk, isLast) => {
          if (!writable) {
            const fileHandle = await chatDir.getFileHandle(cleanName, { create: true })
            writable = await fileHandle.createWritable()
          }
          if (chunk.length) await writable.write(chunk)
          if (isLast) await writable.close()
        }
      },
      (bytesConsumed, totalBytes) => {
        const fraction = totalBytes > 0 ? bytesConsumed / totalBytes : 1
        onProgress({ stage: 'extracting', progress: 10 + Math.round(fraction * 80) })
      },
    )

    if (!chatText) {
      throw new Error('No _chat.txt file found in the zip archive.')
    }

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
