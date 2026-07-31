// src/storage/fileAccess.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discardStorage } from './fileAccess'
import type { StorageRef } from '../types'

function stubOpfsRoot() {
  const root = { removeEntry: vi.fn(async () => undefined) }
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: vi.fn(async () => root) },
  })
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('discardStorage', () => {
  it('removes the OPFS folder the app itself wrote', async () => {
    const root = stubOpfsRoot()

    await discardStorage({ kind: 'opfs', folder: 'chat-1' })

    expect(root.removeEntry).toHaveBeenCalledWith('chat-1', { recursive: true })
  })

  it('never touches a folder the user picked', async () => {
    // The one that matters: a directory-handle chat points at the user's own
    // export on their disk. Replacing the chat must not delete their files.
    const root = stubOpfsRoot()
    const handle = { name: 'Lisbon Trip', removeEntry: vi.fn() } as unknown as FileSystemDirectoryHandle
    const ref: StorageRef = { kind: 'directory-handle', handle }

    await discardStorage(ref)

    expect(root.removeEntry).not.toHaveBeenCalled()
    expect(handle.removeEntry).not.toHaveBeenCalled()
  })

  it('swallows a failure to remove an already-evicted folder', async () => {
    const root = stubOpfsRoot()
    root.removeEntry.mockRejectedValueOnce(new Error('NotFoundError'))

    await expect(discardStorage({ kind: 'opfs', folder: 'gone' })).resolves.toBeUndefined()
  })
})
