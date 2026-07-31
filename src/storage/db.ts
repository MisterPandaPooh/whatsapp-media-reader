// src/storage/db.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StoredChat } from '../types'

interface ReaderDB extends DBSchema {
  chats: {
    key: string
    value: StoredChat
  }
  meta: {
    key: string
    value: { key: string; value: string }
  }
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null

export function getDb(): Promise<IDBPDatabase<ReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>('whatsapp-media-reader', 1, {
      upgrade(db) {
        db.createObjectStore('chats', { keyPath: 'chatId' })
        db.createObjectStore('meta', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}
