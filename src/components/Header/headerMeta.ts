// src/components/Header/headerMeta.ts
// Pure formatting for the app header's identity block, kept out of the
// component so the awkward cases (no messages, one-day chat, odd titles) are
// testable without rendering.
import type { ParsedChat } from '../../types'

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Up to two initials for the avatar block. Code-point aware, so an emoji or a
 * non-Latin script in the chat title yields one whole character rather than
 * half a surrogate pair.
 */
export function initialsOf(title: string): string {
  const words = title.split(/[\s_-]+/).filter((w) => /\p{L}|\p{N}/u.test(w))
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w).find((c) => /\p{L}|\p{N}/u.test(c)) ?? '')
    .join('')
  return (letters || '?').toUpperCase()
}

/** `null` when there is nothing to describe — the caller drops the segment. */
export function dateRangeLabel(timestamps: number[]): string | null {
  if (timestamps.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const t of timestamps) {
    if (t < min) min = t
    if (t > max) max = t
  }
  const from = dayFmt.format(min)
  const to = dayFmt.format(max)
  // A chat that spans a single day reads as a date, not as "X – X".
  return from === to ? from : `${from} – ${to}`
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

/** "2,481 messages · Jan 3, 2024 – Aug 19, 2024 · 7 people" */
export function chatMetaLine(parsed: ParsedChat): string {
  const parts = [plural(parsed.messages.length, 'message')]
  const range = dateRangeLabel(parsed.messages.map((m) => m.timestampMs))
  if (range) parts.push(range)
  parts.push(
    parsed.participants.length === 1
      ? '1 person'
      : `${parsed.participants.length.toLocaleString()} people`,
  )
  return parts.join(' · ')
}
