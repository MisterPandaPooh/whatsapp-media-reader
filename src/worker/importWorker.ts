// src/worker/importWorker.ts
import { parseChat } from '../parser/chatParser'
import { extractZipToOpfs } from './zipExtract'
import { reconcileMediaWithFiles } from './mediaCatalog'
import type { ImportProgress, ParsedChat, StorageRef } from '../types'

export type ImportRequest =
  /** The picked file itself. Structured-cloning a Blob hands the worker a
   *  reference to the same bytes, so nothing is copied and nothing is read
   *  until `extractZipToOpfs` asks for a slice. */
  | { kind: 'zip'; chatId: string; file: Blob }
  | { kind: 'directory'; chatId: string; handle: FileSystemDirectoryHandle }
  /**
   * Re-run the parse over a chat that is already in the library, from the
   * transcript still sitting in its storage — the OPFS folder we unpacked, or
   * the user's own export folder. Nothing is copied or re-extracted. The same
   * `chatId` is passed back in so message ids (and therefore the keys of the
   * persisted `starred` map) come out identical wherever the parse is unchanged.
   */
  | { kind: 'reparse'; chatId: string; storageRef: StorageRef }

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

/**
 * `_chat.txt` wins outright over any other `.txt` in the folder, which may well
 * be an attachment someone sent. Only if there is no `_chat.txt` does the first
 * `.txt` stand in, for exports whose transcript was renamed ("WhatsApp Chat with
 * Ana.txt"). Same precedence as the zip path.
 */
async function findChatText(handle: FileSystemDirectoryHandle): Promise<string> {
  let fallback: FileSystemFileHandle | null = null
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !name.toLowerCase().endsWith('.txt')) continue
    if (name.toLowerCase() === '_chat.txt') return (await entry.getFile()).text()
    fallback ??= entry
  }
  if (fallback) return (await fallback.getFile()).text()
  throw new Error('No _chat.txt file found in the selected folder.')
}

/** The one place a StorageRef becomes a directory, for either storage kind. */
async function resolveDirectory(ref: StorageRef): Promise<FileSystemDirectoryHandle> {
  if (ref.kind === 'directory-handle') return ref.handle
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(ref.folder, { create: false })
}

self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const req = e.data
  const post = (msg: ImportResponse) => (self as unknown as Worker).postMessage(msg)

  try {
    let chatText: string
    let fileSizes: Map<string, number>
    let storageRef: StorageRef

    if (req.kind === 'reparse') {
      post({ type: 'progress', progress: { stage: 'reading', progress: 20 } })
      const dir = await resolveDirectory(req.storageRef)
      chatText = await findChatText(dir)
      storageRef = req.storageRef
      post({ type: 'progress', progress: { stage: 'reading', progress: 60 } })
      fileSizes = await listDirectoryFiles(dir)
    } else if (req.kind === 'zip') {
      post({ type: 'progress', progress: { stage: 'reading', progress: 0 } })
      const extracted = await extractZipToOpfs(req.file, req.chatId, (p) => post({ type: 'progress', progress: p }))
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
