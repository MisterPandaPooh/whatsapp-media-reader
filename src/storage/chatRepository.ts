// src/storage/chatRepository.ts
import { getDb } from './db'
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

export async function loadLastChat(): Promise<StoredChat | null> {
  const db = await getDb()
  const last = await db.get('meta', 'lastChatId')
  if (!last) return null
  const chat = await db.get('chats', last.value)
  return chat ? reconcileStarredFlags(chat) : null
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
