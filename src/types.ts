// src/types.ts
export type MediaKind = 'photo' | 'video' | 'doc' | 'voice' | 'link'

export interface Message {
  id: string
  sender: string
  timestampMs: number
  text: string
  mediaId?: string
  /**
   * Set when the message carried an attachment that the export left out —
   * `image omitted` rather than `<attached: …>`. There is no file and no
   * filename, so there is no MediaItem either; the thread says an attachment
   * was here and that it is not in this export.
   */
  omittedMedia?: MediaKind
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
  /**
   * Which build of the parser produced `parsed`. Optional because records
   * written before this field existed have none — and those are precisely the
   * ones that need re-parsing, so `undefined` correctly reads as "stale".
   * See `PARSER_VERSION`.
   */
  parserVersion?: number
}

export type ImportProgress = {
  stage: 'reading' | 'extracting' | 'parsing'
  progress: number
}
