// src/types.ts
export type MediaKind = 'photo' | 'video' | 'doc' | 'voice' | 'link'

export interface Message {
  id: string
  sender: string
  timestampMs: number
  text: string
  mediaId?: string
  isSystemMessage: boolean
}

export interface MediaItem {
  id: string
  kind: MediaKind
  filename: string
  size: number
  caption: string
  sender: string
  timestampMs: number
  anchorMessageId: string
  starred: boolean
  durationSec?: number
  missing: boolean
}

export interface ParsedChat {
  messages: Message[]
  media: MediaItem[]
  participants: string[]
}

export type StorageRef =
  | { kind: 'opfs'; folder: string }
  | { kind: 'directory-handle'; handle: FileSystemDirectoryHandle }

export interface StoredChat {
  chatId: string
  title: string
  importedAtMs: number
  storageRef: StorageRef
  meParticipant: string | null
  parsed: ParsedChat
  starred: Record<string, boolean>
}

export type ImportProgress = {
  stage: 'reading' | 'extracting' | 'parsing'
  progress: number
}
