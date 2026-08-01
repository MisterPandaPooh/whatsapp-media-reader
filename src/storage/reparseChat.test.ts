import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { needsReparse, reparseChat } from './reparseChat'
import { PARSER_VERSION } from '../parser/version'
import type { ImportResponse } from '../worker/importWorker'
import type { MediaItem, StoredChat } from '../types'

const saved: StoredChat[] = []
vi.mock('./chatRepository', () => ({
  saveChat: async (chat: StoredChat) => {
    saved.push(chat)
  },
}))

function item(id: string, sender: string): MediaItem {
  return {
    id,
    kind: 'photo',
    filename: `${id}.jpg`,
    size: 0,
    caption: '',
    sender,
    timestampMs: 0,
    anchorMessageId: id.replace('-media', ''),
    starred: false,
    missing: false,
  }
}

function storedChat(overrides: Partial<StoredChat> = {}): StoredChat {
  return {
    chatId: 'c1',
    title: 'Family',
    importedAtMs: 0,
    storageRef: { kind: 'opfs', folder: 'c1' },
    meParticipant: null,
    parsed: { messages: [], media: [], participants: [] },
    starred: {},
    ...overrides,
  }
}

/** Stands in for the import worker: replays a scripted response, once. */
function stubWorker(response: ImportResponse) {
  const posted: unknown[] = []
  class FakeWorker {
    onmessage: ((e: MessageEvent<ImportResponse>) => void) | null = null
    onerror: ((e: ErrorEvent) => void) | null = null
    terminated = false
    postMessage(msg: unknown) {
      posted.push(msg)
      queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<ImportResponse>))
    }
    terminate() {
      this.terminated = true
    }
  }
  vi.stubGlobal('Worker', FakeWorker)
  return posted
}

beforeEach(() => {
  saved.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('needsReparse', () => {
  it('flags a record written before the version field existed', () => {
    expect(needsReparse(storedChat())).toBe(true)
  })

  it('flags a record from an older parser', () => {
    expect(needsReparse(storedChat({ parserVersion: PARSER_VERSION - 1 }))).toBe(true)
  })

  it('leaves a current record alone', () => {
    expect(needsReparse(storedChat({ parserVersion: PARSER_VERSION }))).toBe(false)
  })
})

describe('reparseChat', () => {
  const done: ImportResponse = {
    type: 'done',
    storageRef: { kind: 'opfs', folder: 'c1' },
    parsed: {
      messages: [{ id: 'm1', sender: 'Nina', timestampMs: 1, text: '', isSystemMessage: false }],
      media: [item('m1-media', 'Nina'), item('m2-media', 'Nina')],
      participants: ['Nina'],
    },
  }

  it('re-parses in place, keeping the chat id so ids stay stable', async () => {
    const posted = stubWorker(done)
    await reparseChat(storedChat())
    expect(posted).toEqual([
      { kind: 'reparse', chatId: 'c1', storageRef: { kind: 'opfs', folder: 'c1' } },
    ])
  })

  it('stamps the current parser version and saves', async () => {
    stubWorker(done)
    const next = await reparseChat(storedChat())
    expect(next.parserVersion).toBe(PARSER_VERSION)
    expect(saved).toHaveLength(1)
    expect(saved[0].parserVersion).toBe(PARSER_VERSION)
  })

  it('carries a star over onto the freshly parsed item', async () => {
    stubWorker(done)
    const next = await reparseChat(storedChat({ starred: { 'm1-media': true } }))
    expect(next.parsed.media.find((m) => m.id === 'm1-media')!.starred).toBe(true)
    expect(next.starred).toEqual({ 'm1-media': true })
  })

  it('drops a star whose item the corrected parse no longer produces', async () => {
    stubWorker(done)
    const next = await reparseChat(storedChat({ starred: { 'gone-media': true } }))
    expect(next.starred).toEqual({})
  })

  it('rejects rather than replacing a working library with an empty parse', async () => {
    stubWorker({
      type: 'done',
      storageRef: { kind: 'opfs', folder: 'c1' },
      parsed: { messages: [], media: [], participants: [] },
    })
    await expect(reparseChat(storedChat())).rejects.toThrow()
    expect(saved).toHaveLength(0)
  })

  it('rejects when the transcript cannot be read', async () => {
    stubWorker({ type: 'error', message: 'No _chat.txt file found in the selected folder.' })
    await expect(reparseChat(storedChat())).rejects.toThrow('No _chat.txt')
  })
})
