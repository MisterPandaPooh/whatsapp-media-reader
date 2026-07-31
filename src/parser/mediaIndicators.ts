import type { MediaKind } from '../types'

const ATTACHED_RE = /<attached:\s*([^>]+)>/i
const FILE_ATTACHED_RE = /([^\s/\\]+\.[A-Za-z0-9]{2,5})\s*\((?:file attached|arquivo anexado|fichier joint|archivo adjunto)\)/i

export function extractMediaFilename(text: string): string | null {
  const m1 = text.match(ATTACHED_RE)
  if (m1) return m1[1].trim()
  const m2 = text.match(FILE_ATTACHED_RE)
  if (m2) return m2[1].trim()
  return null
}

const EXT_KIND: Record<string, MediaKind> = {
  jpg: 'photo', jpeg: 'photo', png: 'photo', gif: 'photo', webp: 'photo', heic: 'photo',
  mp4: 'video', mov: 'video', avi: 'video', '3gp': 'video', webm: 'video',
  opus: 'voice', m4a: 'voice', ogg: 'voice',
}

export function detectKind(filename: string): MediaKind {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return EXT_KIND[ext] ?? 'doc'
}

const SYSTEM_INDICATORS = [
  "joined using this group's invite link", 'created group', 'created this group',
  'changed the subject', "changed this group's icon", 'changed the group description',
  'Messages and calls are end-to-end encrypted', 'security code changed',
  'turned on disappearing messages', 'turned off disappearing messages',
  'added', 'removed', 'left',
]

export function isSystemMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return SYSTEM_INDICATORS.some((s) => lower.includes(s.toLowerCase()))
}
