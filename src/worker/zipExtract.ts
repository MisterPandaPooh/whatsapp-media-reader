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

  // Note: the progress-percentage math below divides by `names.length`, but it only
  // runs inside this loop's body, which the `for` condition (`i < names.length`)
  // guarantees never executes when `names.length` is 0. So a zero-entry zip can never
  // reach the division, and the `!chatText` check after the loop already rejects that
  // case anyway. No explicit guard needed.
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
