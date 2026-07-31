// src/storage/chatRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { saveChat, loadLastChat, setStarred, reconcileStarredFlags } from './chatRepository'
import { filteredMedia } from '../store/selectors'
import { EMPTY_FILTERS } from '../store/useChatStore'
import type { MediaItem, StoredChat } from '../types'

function makeMedia(id: string): MediaItem {
  return {
    id,
    kind: 'photo',
    filename: `${id}.jpg`,
    size: 1024,
    caption: '',
    sender: 'Ana',
    timestampMs: 1_700_000_000_000,
    anchorMessageId: `${id}-msg`,
    starred: false,
    missing: false,
  }
}

function makeChat(chatId: string, media: MediaItem[] = []): StoredChat {
  return {
    chatId,
    title: 'Lisbon Trip',
    importedAtMs: Date.now(),
    storageRef: { kind: 'opfs', folder: chatId },
    meParticipant: 'You',
    parsed: { messages: [], media, participants: ['You', 'Ana'] },
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

  it('handles concurrent setStarred calls on different mediaIds without losing an update', async () => {
    const chat = makeChat('chat-c')
    await saveChat(chat)
    await Promise.all([
      setStarred('chat-c', 'media-1', true),
      setStarred('chat-c', 'media-2', true),
    ])
    const loaded = await loadLastChat()
    expect(loaded?.starred).toEqual({ 'media-1': true, 'media-2': true })
  })

  it('keeps the denormalized media[].starred flag in step, so the starred filter survives a reload', async () => {
    const chat = makeChat('chat-d', [makeMedia('media-1'), makeMedia('media-2')])
    await saveChat(chat)
    await setStarred('chat-d', 'media-1', true)

    const loaded = await loadLastChat()
    expect(loaded?.parsed.media.find((m) => m.id === 'media-1')?.starred).toBe(true)
    expect(loaded?.parsed.media.find((m) => m.id === 'media-2')?.starred).toBe(false)
    // The `starredOnly` filter reads item.starred, not the map — this is what
    // silently under-reported after a reload before the flags were reconciled.
    const starredOnly = filteredMedia(loaded!.parsed.media, { ...EMPTY_FILTERS, starredOnly: true })
    expect(starredOnly.map((m) => m.id)).toEqual(['media-1'])
  })

  it('repairs a record whose starred map and media flags disagree', async () => {
    // What an older build left on disk: map updated, denormalized flags stale.
    const stale = makeChat('chat-e', [makeMedia('media-1'), makeMedia('media-2')])
    stale.starred = { 'media-1': true, 'media-2': false }
    await saveChat(stale)

    const loaded = await loadLastChat()
    expect(loaded?.parsed.media.map((m) => m.starred)).toEqual([true, false])
  })

  it('reconcileStarredFlags leaves an already-consistent chat untouched', () => {
    const chat = makeChat('chat-f', [makeMedia('media-1')])
    const same = reconcileStarredFlags(chat)
    expect(same.parsed.media[0]).toBe(chat.parsed.media[0])
  })
})
