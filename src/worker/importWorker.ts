// src/worker/importWorker.ts
import { parseChat } from '../parser/chatParser'
import { extractZipToOpfs } from './zipExtract'
import { reconcileMediaWithFiles } from './mediaCatalog'
import type { ImportProgress, ParsedChat, StorageRef } from '../types'

export type ImportRequest =
  | { kind: 'zip'; chatId: string; zipBytes: Uint8Array }
  | { kind: 'directory'; chatId: string; handle: FileSystemDirectoryHandle }

export type ImportResponse =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; parsed: ParsedChat; storageRef: StorageRef }
  | { type: 'error'; message: string }

async function listDirectoryFiles(handle: FileSystemDirectoryHandle): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      sizes.set(name, file.size)
    }
  }
  return sizes
}

async function findChatText(handle: FileSystemDirectoryHandle): Promise<string> {
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file' && name.toLowerCase().endsWith('.txt')) {
      const file = await entry.getFile()
      return file.text()
    }
  }
  throw new Error('No _chat.txt file found in the selected folder.')
}

self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const req = e.data
  const post = (msg: ImportResponse) => (self as unknown as Worker).postMessage(msg)

  try {
    let chatText: string
    let fileSizes: Map<string, number>
    let storageRef: StorageRef

    if (req.kind === 'zip') {
      post({ type: 'progress', progress: { stage: 'reading', progress: 0 } })
      const extracted = await extractZipToOpfs(req.zipBytes, req.chatId, (p) => post({ type: 'progress', progress: p }))
      chatText = extracted.chatText
      storageRef = { kind: 'opfs', folder: req.chatId }
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(req.chatId)
      fileSizes = await listDirectoryFiles(dir)
    } else {
      post({ type: 'progress', progress: { stage: 'reading', progress: 20 } })
      chatText = await findChatText(req.handle)
      storageRef = { kind: 'directory-handle', handle: req.handle }
      post({ type: 'progress', progress: { stage: 'reading', progress: 60 } })
      fileSizes = await listDirectoryFiles(req.handle)
    }

    post({ type: 'progress', progress: { stage: 'parsing', progress: 0 } })
    const parsed = parseChat(chatText, req.chatId)
    parsed.media = reconcileMediaWithFiles(parsed.media, fileSizes)
    post({ type: 'progress', progress: { stage: 'parsing', progress: 100 } })

    post({ type: 'done', parsed, storageRef })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
