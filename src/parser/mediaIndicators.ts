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

// Bidi control characters iOS sprinkles around attachment markers
// (LRM, RLM, and the LRE/RLE/PDF/LRO/RLO block).
const BIDI = '\\u200e\\u200f\\u202a-\\u202e'
// Whitespace or bidi mark at either end of the whole caption.
const EDGE_TRIM_RE = new RegExp(`^[\\s${BIDI}]+|[\\s${BIDI}]+$`, 'g')
// Same-line padding (spaces/tabs/bidi marks, never newlines) hugging the marker.
const PAD = `(?:[^\\S\\r\\n]|[${BIDI}])*`
const PAD_BEFORE_RE = new RegExp(`${PAD}$`)
const PAD_AFTER_RE = new RegExp(`^${PAD}`)

/**
 * Removes a WhatsApp attachment marker (iOS `<attached: name.jpg>` or Android
 * `name.jpg (file attached)`) from a message body, leaving only the user's caption.
 * Returns `''` when the message was nothing but the marker, and returns text
 * without a marker unchanged. Uses the same patterns as `extractMediaFilename`
 * so the two can never drift apart.
 */
export function stripMediaMarker(text: string): string {
  const match = text.match(ATTACHED_RE) ?? text.match(FILE_ATTACHED_RE)
  if (!match || match.index === undefined) return text

  const before = text.slice(0, match.index).replace(PAD_BEFORE_RE, '')
  const after = text.slice(match.index + match[0].length).replace(PAD_AFTER_RE, '')

  const endsLine = /\n$/.test(before)
  const startsLine = /^\r?\n/.test(after)
  // The marker had a line to itself: drop that line rather than leaving a blank one.
  if (endsLine && startsLine) {
    return `${before}${after.replace(/^\r?\n/, '')}`.replace(EDGE_TRIM_RE, '')
  }
  // Re-join with a single space only when real caption text remains on the same
  // line on both sides; otherwise the surrounding newline already separates them.
  const needsSpace = before !== '' && after !== '' && !endsLine && !startsLine
  return `${before}${needsSpace ? ' ' : ''}${after}`.replace(EDGE_TRIM_RE, '')
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
]

export function isSystemMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return SYSTEM_INDICATORS.some((s) => lower.includes(s.toLowerCase()))
}
