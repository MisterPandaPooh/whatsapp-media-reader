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

export async function ensurePermission(ref: StorageRef): Promise<boolean> {
  if (ref.kind === 'opfs') return true
  const handle = ref.handle
  const opts = { mode: 'read' as const }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}
