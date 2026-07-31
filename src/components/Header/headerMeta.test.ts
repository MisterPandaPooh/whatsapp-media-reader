// src/components/Header/headerMeta.test.ts
import { describe, expect, it } from 'vitest'
import { chatMetaLine, dateRangeLabel, initialsOf } from './headerMeta'
import type { Message, ParsedChat } from '../../types'

const DAY = 24 * 60 * 60 * 1000
const JAN_3 = new Date(2024, 0, 3, 9, 30).getTime()

function chat(messageTimestamps: number[], participants: string[]): ParsedChat {
  const messages: Message[] = messageTimestamps.map((timestampMs, i) => ({
    id: `m${i}`,
    sender: participants[0] ?? 'Alice',
    timestampMs,
    text: 'hi',
    isSystemMessage: false,
  }))
  return { messages, media: [], participants }
}

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Family Trip 2024')).toBe('FT')
  })

  it('handles a single word', () => {
    expect(initialsOf('Sailing')).toBe('S')
  })

  it('splits on the separators export filenames actually use', () => {
    expect(initialsOf('WhatsApp_Chat-Group')).toBe('WC')
  })

  it('skips punctuation-only words', () => {
    expect(initialsOf('— Ski trip')).toBe('St'.toUpperCase())
  })

  it('keeps a whole code point rather than half a surrogate pair', () => {
    expect(initialsOf('🎉 Party')).toBe('P')
  })

  it('falls back to a placeholder for an unusable title', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('---')).toBe('?')
  })
})

describe('dateRangeLabel', () => {
  it('is null with nothing to describe', () => {
    expect(dateRangeLabel([])).toBeNull()
  })

  it('collapses a single-day chat to one date', () => {
    const label = dateRangeLabel([JAN_3, JAN_3 + 60_000])
    expect(label).not.toContain('–')
  })

  it('spans first to last, whatever order they arrive in', () => {
    const label = dateRangeLabel([JAN_3 + 40 * DAY, JAN_3, JAN_3 + 10 * DAY])
    const [from, to] = (label as string).split(' – ')
    expect(from).toBe(dateRangeLabel([JAN_3]))
    expect(to).toBe(dateRangeLabel([JAN_3 + 40 * DAY]))
  })
})

describe('chatMetaLine', () => {
  it('reads count · range · people', () => {
    const line = chatMetaLine(chat([JAN_3, JAN_3 + 40 * DAY], ['Alice', 'Bob', 'Cara']))
    const parts = line.split(' · ')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('2 messages')
    expect(parts[2]).toBe('3 people')
  })

  it('drops the date segment when there are no messages', () => {
    expect(chatMetaLine(chat([], ['Alice']))).toBe('0 messages · 1 person')
  })

  it('singularizes one message and one person', () => {
    expect(chatMetaLine(chat([JAN_3], ['Alice']))).toContain('1 message ·')
  })

  it('groups thousands so long chats stay readable', () => {
    const many = Array.from({ length: 1234 }, (_, i) => JAN_3 + i * 1000)
    expect(chatMetaLine(chat(many, ['Alice']))).toMatch(/^1,234 messages/)
  })
})
