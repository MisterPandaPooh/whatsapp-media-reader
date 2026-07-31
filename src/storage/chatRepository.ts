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

export async function loadLastChat(): Promise<StoredChat | null> {
  const db = await getDb()
  const last = await db.get('meta', 'lastChatId')
  if (!last) return null
  const chat = await db.get('chats', last.value)
  return chat ?? null
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
  await tx.store.put(chat)
  await tx.done
}
