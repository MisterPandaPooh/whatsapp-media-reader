// src/storage/chatRepository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveChat,
  loadLastChat,
  setStarred,
  reconcileStarredFlags,
  stripStoredMediaMarkers,
  deleteChat,
  forgetChat,
} from './chatRepository'
import { filteredMedia } from '../store/selectors'
import { EMPTY_FILTERS } from '../store/useChatStore'
import type { MediaItem, Message, StoredChat } from '../types'

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

function makeMessage(patch: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    sender: 'Ana',
    timestampMs: 1_700_000_000_000,
    text: '',
    isSystemMessage: false,
    ...patch,
  }
}

describe('stripStoredMediaMarkers', () => {
  it('strips a raw attachment marker left in the text by an older build', () => {
    // The conversation thread renders Message.text verbatim, and parsing only
    // happens at import time — so a chat already in IndexedDB would keep showing
    // "<attached: …>" forever without this fix-up.
    const chat = makeChat('chat-legacy', [makeMedia('media-1')])
    chat.parsed.messages = [
      makeMessage({ id: 'msg-1', mediaId: 'media-1', text: '‎<attached: media-1.jpg>' }),
    ]

    expect(stripStoredMediaMarkers(chat).parsed.messages[0].text).toBe('')
  })

  it('keeps the user caption of a captioned legacy attachment', () => {
    const chat = makeChat('chat-legacy-2', [makeMedia('media-1')])
    chat.parsed.messages = [
      makeMessage({
        id: 'msg-1',
        mediaId: 'media-1',
        text: '‎<attached: media-1.jpg>\nsunset at the beach',
      }),
    ]

    expect(stripStoredMediaMarkers(chat).parsed.messages[0].text).toBe('sunset at the beach')
  })

  it('strips a raw marker left in a legacy MediaItem.caption', () => {
    // The caption regressed in a separate release from Message.text, so a chat
    // can have clean text and a dirty caption. The caption shows on every tile
    // and feeds the search haystack, where "<attached:" would match everything.
    const media = makeMedia('media-1')
    media.caption = '‎<attached: media-1.jpg>'
    const chat = makeChat('chat-legacy-caption', [media])

    expect(stripStoredMediaMarkers(chat).parsed.media[0].caption).toBe('')
  })

  it('keeps the user caption of a captioned legacy media item', () => {
    const media = makeMedia('media-1')
    media.caption = '‎<attached: media-1.jpg>\nsunset at the beach'
    const chat = makeChat('chat-legacy-caption-2', [media])

    expect(stripStoredMediaMarkers(chat).parsed.media[0].caption).toBe('sunset at the beach')
  })

  it('leaves a link item alone — its caption is the message, not a marker', () => {
    const media: MediaItem = {
      ...makeMedia('media-1'),
      kind: 'link',
      filename: 'https://example.com/a',
      caption: 'the villa listing https://example.com/a',
    }
    const chat = makeChat('chat-legacy-link', [media])

    expect(stripStoredMediaMarkers(chat).parsed.media[0].caption).toBe(
      'the villa listing https://example.com/a',
    )
  })

  it('leaves a message with no attachment alone', () => {
    const chat = makeChat('chat-legacy-3')
    chat.parsed.messages = [makeMessage({ text: 'use <div> for the wrapper' })]

    expect(stripStoredMediaMarkers(chat).parsed.messages[0].text).toBe('use <div> for the wrapper')
  })

  it('returns the same object when nothing needed stripping', () => {
    // Every chat the current parser writes takes this path; copying the whole
    // message array on each load would be pure waste.
    const chat = makeChat('chat-current', [makeMedia('media-1')])
    chat.parsed.messages = [makeMessage({ mediaId: 'media-1', text: 'sunset at the beach' })]

    expect(stripStoredMediaMarkers(chat)).toBe(chat)
  })

  it('applies on the way out of IndexedDB', async () => {
    const chat = makeChat('chat-legacy-load', [makeMedia('media-1')])
    chat.parsed.messages = [
      makeMessage({ mediaId: 'media-1', text: 'look ‎<attached: media-1.jpg> at this' }),
    ]
    await saveChat(chat)

    const loaded = await loadLastChat()
    expect(loaded!.parsed.messages[0].text).toBe('look at this')
  })
})

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

  it('drops a replaced chat without disturbing the one that replaced it', async () => {
    // The order the app uses: the new chat is saved (repointing lastChatId)
    // before the old record is deleted.
    await saveChat(makeChat('chat-old', [makeMedia('media-1')]))
    await saveChat(makeChat('chat-new', [makeMedia('media-2')]))

    await deleteChat('chat-old')

    const loaded = await loadLastChat()
    expect(loaded?.chatId).toBe('chat-new')
    expect(loaded?.parsed.media.map((m) => m.id)).toEqual(['media-2'])
  })

  it('is a no-op when the chat is already gone', async () => {
    await saveChat(makeChat('chat-g'))
    await expect(deleteChat('never-existed')).resolves.toBeUndefined()
    expect((await loadLastChat())?.chatId).toBe('chat-g')
  })
})

describe('forgetChat', () => {
  it('leaves nothing to restore on the next load', async () => {
    await saveChat(makeChat('chat-h', [makeMedia('media-1')]))

    await forgetChat('chat-h')

    // Both halves matter: the record is gone AND lastChatId no longer points
    // at it, so a reload lands on the import screen rather than briefly trying
    // to restore a chat that is not there.
    expect(await loadLastChat()).toBeNull()
  })

  it('does not resurrect an earlier chat by clearing only the record', async () => {
    await saveChat(makeChat('chat-i'))
    await saveChat(makeChat('chat-j'))

    await forgetChat('chat-j')

    expect(await loadLastChat()).toBeNull()
  })

  it('is a no-op for a chat that is already gone', async () => {
    await expect(forgetChat('never-existed')).resolves.toBeUndefined()
    expect(await loadLastChat()).toBeNull()
  })
})
