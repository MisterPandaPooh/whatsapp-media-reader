import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatBytes, sweepOrphanedStorage } from './originStorage'
import { saveChat } from './chatRepository'
import type { StoredChat } from '../types'

const HOUR = 60 * 60 * 1000

/**
 * A stub of just the OPFS surface the sweep touches. Real OPFS is not available
 * in jsdom, and the thing under test here is the decision — which folders are
 * safe to delete — not the file system underneath it.
 */
function stubOpfs(folders: Record<string, { files: Record<string, number> }>) {
  const removed: string[] = []

  const makeDir = (name: string): FileSystemDirectoryHandle =>
    ({
      kind: 'directory',
      name,
      async getFileHandle(file: string) {
        if (!(file in folders[name].files)) throw new DOMException('missing', 'NotFoundError')
        return { kind: 'file', getFile: async () => ({ lastModified: folders[name].files[file] }) }
      },
      async *entries() {
        for (const [file, lastModified] of Object.entries(folders[name].files)) {
          yield [file, { kind: 'file', getFile: async () => ({ lastModified }) }]
        }
      },
    }) as unknown as FileSystemDirectoryHandle

  const root = {
    async *entries() {
      for (const name of Object.keys(folders)) yield [name, makeDir(name)]
    },
    async removeEntry(name: string) {
      removed.push(name)
      delete folders[name]
    },
  }

  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => root,
      estimate: async () => ({ usage: 0, quota: 0 }),
      persisted: async () => false,
    },
  })
  return { removed }
}

function chat(chatId: string, folder: string): StoredChat {
  return {
    chatId,
    title: chatId,
    importedAtMs: 0,
    storageRef: { kind: 'opfs', folder },
    meParticipant: null,
    parsed: { messages: [], media: [], participants: [] },
    starred: {},
  }
}

beforeEach(async () => {
  indexedDB.deleteDatabase('whatsapp-media-reader')
})
afterEach(() => vi.unstubAllGlobals())

describe('sweepOrphanedStorage', () => {
  it('never touches a folder a chat still points at', async () => {
    const now = Date.now()
    const { removed } = stubOpfs({ 'live-1': { files: { '_chat.txt': now } } })
    await saveChat(chat('live-1', 'live-1'))

    const result = await sweepOrphanedStorage()

    expect(removed).toEqual([])
    expect(result.removed).toEqual([])
  })

  it('removes a finished extraction nothing points at', async () => {
    // `_chat.txt` present means the unpack completed; unclaimed means the user
    // never pressed "Open media reader", or the record has since been deleted.
    const { removed } = stubOpfs({ 'ghost-1': { files: { '_chat.txt': Date.now(), 'a.jpg': Date.now() } } })

    const result = await sweepOrphanedStorage()

    expect(removed).toEqual(['ghost-1'])
    expect(result.removed).toEqual(['ghost-1'])
  })

  it('leaves an extraction that is still writing', async () => {
    // No transcript yet and the bytes are fresh: this is an import running in
    // another tab, not a corpse.
    const { removed } = stubOpfs({ 'busy-1': { files: { 'a.jpg': Date.now() - 5_000 } } })

    await sweepOrphanedStorage()

    expect(removed).toEqual([])
  })

  it('removes an extraction that died partway', async () => {
    const { removed } = stubOpfs({ 'crashed-1': { files: { 'a.jpg': Date.now() - 3 * HOUR } } })

    await sweepOrphanedStorage()

    expect(removed).toEqual(['crashed-1'])
  })

  it('removes a folder created with nothing ever written to it', async () => {
    const { removed } = stubOpfs({ 'stillborn-1': { files: {} } })

    await sweepOrphanedStorage()

    expect(removed).toEqual(['stillborn-1'])
  })

  it('sorts the live from the dead in one pass', async () => {
    const now = Date.now()
    const { removed } = stubOpfs({
      'live-1': { files: { '_chat.txt': now } },
      'ghost-1': { files: { '_chat.txt': now } },
      'busy-1': { files: { 'a.jpg': now } },
      'crashed-1': { files: { 'a.jpg': now - 3 * HOUR } },
    })
    await saveChat(chat('live-1', 'live-1'))

    await sweepOrphanedStorage()

    expect(removed.sort()).toEqual(['crashed-1', 'ghost-1'])
  })

  it('does nothing at all when the chat database cannot be read', async () => {
    // Without the list of claimed folders every folder looks orphaned, and
    // guessing here would delete someone's library. The folder below would
    // otherwise be swept on sight, so the assertion only passes if the
    // unreadable database stopped the sweep outright.
    const { removed } = stubOpfs({ 'ghost-1': { files: { '_chat.txt': Date.now() } } })
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('blocked', 'InvalidStateError')
      },
    })
    // The repository memoises its connection, so the failure only reaches the
    // sweep through a module registry that has not opened one yet.
    vi.resetModules()
    const { sweepOrphanedStorage: freshSweep } = await import('./originStorage')

    const result = await freshSweep()

    expect(removed).toEqual([])
    expect(result).toEqual({ removed: [], bytesFreed: 0 })
  })

  it('reports the space it reclaimed', async () => {
    stubOpfs({ 'ghost-1': { files: { '_chat.txt': Date.now() } } })
    let call = 0
    // 3 GB before, 1 GB after.
    navigator.storage.estimate = async () =>
      ({ usage: call++ === 0 ? 3 * 1024 ** 3 : 1024 ** 3, quota: 0 })

    const result = await sweepOrphanedStorage()

    expect(formatBytes(result.bytesFreed)).toBe('2.0 GB')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [900, '900 B'],
    [1536, '1.5 KB'],
    [1024 ** 2 * 12, '12 MB'],
    [1024 ** 3 * 1.4, '1.4 GB'],
    [1024 ** 4 * 2, '2.0 TB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
