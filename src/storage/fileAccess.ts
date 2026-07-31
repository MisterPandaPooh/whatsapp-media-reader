import type { StorageRef } from '../types'

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

export async function getChatDirectory(ref: StorageRef): Promise<FileSystemDirectoryHandle> {
  if (ref.kind === 'directory-handle') return ref.handle
  const root = await getOpfsRoot()
  return root.getDirectoryHandle(ref.folder, { create: false })
}

export async function readMediaFile(ref: StorageRef, filename: string): Promise<File | null> {
  try {
    const dir = await getChatDirectory(ref)
    const fileHandle = await dir.getFileHandle(filename)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

/**
 * Drop the media of a chat that has been replaced by a new import. Deliberately
 * a no-op for directory-handle chats: that folder is the user's own export on
 * their disk, and we only ever had read permission on it. Only the OPFS copy we
 * wrote ourselves is ours to remove.
 */
export async function discardStorage(ref: StorageRef): Promise<void> {
  if (ref.kind !== 'opfs') return
  try {
    const root = await getOpfsRoot()
    await root.removeEntry(ref.folder, { recursive: true })
  } catch {
    // Already gone, or evicted. Nothing to do and nothing worth reporting.
  }
}

export async function ensurePermission(ref: StorageRef): Promise<boolean> {
  if (ref.kind === 'opfs') return true
  const handle = ref.handle
  const opts = { mode: 'read' as const }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

/**
 * Query-only counterpart of `ensurePermission`. `requestPermission()` needs
 * transient user activation, so it must never be called while restoring a chat
 * on page load — ask first, and only prompt from a click if the answer is no.
 */
export async function hasPermission(ref: StorageRef): Promise<boolean> {
  if (ref.kind === 'opfs') return true
  try {
    return (await ref.handle.queryPermission({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

/**
 * Cheap liveness probe for a restored chat: the OPFS folder may have been
 * evicted, and a persisted directory handle may point at a folder that has since
 * been moved or deleted. Listing one entry surfaces both without reading media.
 */
export async function isStorageReachable(ref: StorageRef): Promise<boolean> {
  try {
    const dir = await getChatDirectory(ref)
    await dir.entries().next()
    return true
  } catch {
    return false
  }
}
