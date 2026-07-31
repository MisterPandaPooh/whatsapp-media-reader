// src/storage/chatRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { saveChat, loadLastChat, setStarred } from './chatRepository'
import type { StoredChat } from '../types'

function makeChat(chatId: string): StoredChat {
  return {
    chatId,
    title: 'Lisbon Trip',
    importedAtMs: Date.now(),
    storageRef: { kind: 'opfs', folder: chatId },
    meParticipant: 'You',
    parsed: { messages: [], media: [], participants: ['You', 'Ana'] },
    starred: {},
  }
}

describe('chatRepository', () => {
  beforeEach(async () => {
    // fake-indexeddb persists per-test-run; each test uses a unique chatId instead of resetting.
  })

  it('saves and reloads the last-imported chat', async () => {
    const chat = makeChat('chat-a')
    await saveChat(chat)
    const loaded = await loadLastChat()
    expect(loaded?.chatId).toBe('chat-a')
    expect(loaded?.title).toBe('Lisbon Trip')
  })

  it('setStarred toggles and persists a media item star flag', async () => {
    const chat = makeChat('chat-b')
    await saveChat(chat)
    await setStarred('chat-b', 'media-1', true)
    const loaded = await loadLastChat()
    expect(loaded?.starred['media-1']).toBe(true)
    await setStarred('chat-b', 'media-1', false)
    const reloaded = await loadLastChat()
    expect(reloaded?.starred['media-1']).toBe(false)
  })
})
