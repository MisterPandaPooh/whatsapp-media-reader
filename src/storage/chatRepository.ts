// src/storage/chatRepository.ts
import { getDb } from './db'
import type { StoredChat } from '../types'

export async function saveChat(chat: StoredChat): Promise<void> {
  const db = await getDb()
  await db.put('chats', chat)
  await db.put('meta', { key: 'lastChatId', value: chat.chatId })
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
  const chat = await db.get('chats', chatId)
  if (!chat) return
  chat.starred = { ...chat.starred, [mediaId]: starred }
  await db.put('chats', chat)
}
