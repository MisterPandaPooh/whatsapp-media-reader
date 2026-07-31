// src/storage/chatRepository.ts
import { getDb } from './db'
import { stripMediaMarker } from '../parser/mediaIndicators'
import type { StoredChat } from '../types'

export async function saveChat(chat: StoredChat): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['chats', 'meta'], 'readwrite')
  await tx.objectStore('chats').put(chat)
  await tx.objectStore('meta').put({ key: 'lastChatId', value: chat.chatId })
  await tx.done
}

/**
 * `chat.starred` is the source of truth; `parsed.media[].starred` is a
 * denormalized copy the grid, the panel and the `starredOnly` filter all read.
 * Re-derive the copy from the map on the way out of IndexedDB so a chat written
 * by an older build (map updated, flags stale) still restores its stars.
 */
export function reconcileStarredFlags(chat: StoredChat): StoredChat {
  const media = chat.parsed.media.map((m) => {
    const starred = chat.starred[m.id] ?? m.starred
    return starred === m.starred ? m : { ...m, starred }
  })
  return { ...chat, parsed: { ...chat.parsed, media } }
}

/**
 * A chat imported before the parser learned to strip attachment markers still
 * carries the raw `<attached: IMG-0002.png>` in `Message.text` and in
 * `MediaItem.caption`. The thread renders the text verbatim, and the caption
 * shows on every tile *and* feeds the search haystack. Parsing is import-time
 * only, so without this fix-up an existing library would keep showing markers
 * until it was re-imported — the very defect the parser change removes.
 *
 * The two fields regressed in separate releases, so they are stripped
 * independently rather than assuming a chat with clean text also has clean
 * captions. The chat is returned unchanged (same identity, no copying) when
 * nothing needed stripping, which is the case for everything the current
 * parser writes.
 */
export function stripStoredMediaMarkers(chat: StoredChat): StoredChat {
  let changed = false
  const messages = chat.parsed.messages.map((m) => {
    if (!m.mediaId) return m
    const text = stripMediaMarker(m.text)
    if (text === m.text) return m
    changed = true
    return { ...m, text }
  })
  const media = chat.parsed.media.map((item) => {
    // A link item's "filename" is its URL and its caption is the message
    // itself; there is no attachment marker to strip.
    if (item.kind === 'link') return item
    const caption = stripMediaMarker(item.caption)
    if (caption === item.caption) return item
    changed = true
    return { ...item, caption }
  })
  return changed ? { ...chat, parsed: { ...chat.parsed, messages, media } } : chat
}

export async function loadLastChat(): Promise<StoredChat | null> {
  const db = await getDb()
  const last = await db.get('meta', 'lastChatId')
  if (!last) return null
  const chat = await db.get('chats', last.value)
  return chat ? stripStoredMediaMarkers(reconcileStarredFlags(chat)) : null
}

/**
 * Removes a chat replaced by a new import. `lastChatId` is not touched: the
 * replacement's `saveChat` has already pointed it at the new record, and
 * clearing it here would race that write into "no chat on reload".
 */
export async function deleteChat(chatId: string): Promise<void> {
  const db = await getDb()
  await db.delete('chats', chatId)
}

export async function setStarred(chatId: string, mediaId: string, starred: boolean): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('chats', 'readwrite')
  const chat = await tx.store.get(chatId)
  if (!chat) {
    await tx.done
    return
  }
  chat.starred = { ...chat.starred, [mediaId]: starred }
  // Keep the denormalized flag in step with the map. Without this the record on
  // disk is internally inconsistent, and everything reading `item.starred`
  // (notably the `starredOnly` filter) under-reports after a reload.
  chat.parsed = {
    ...chat.parsed,
    media: chat.parsed.media.map((m) => (m.id === mediaId ? { ...m, starred } : m)),
  }
  await tx.store.put(chat)
  await tx.done
}
