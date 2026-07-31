import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChat } from './chatParser'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8')
}

describe('parseChat', () => {
  it('parses messages, sender, and participants from a basic export', () => {
    const { messages, participants } = parseChat(fixture('basic.txt'), 'chat-1')
    expect(messages).toHaveLength(3)
    expect(messages[0].sender).toBe('Ana Ferreira')
    expect(messages[0].text).toContain('Landing 14:20')
    expect(participants.sort()).toEqual(['Ana Ferreira', 'Tomás Silva', 'You'].sort())
  })

  it('links a media message to a MediaItem with the extracted filename', () => {
    const { messages, media } = parseChat(fixture('basic.txt'), 'chat-1')
    const mediaMsg = messages[1]
    expect(mediaMsg.mediaId).toBeDefined()
    const item = media.find((m) => m.id === mediaMsg.mediaId)
    expect(item).toBeDefined()
    expect(item!.filename).toBe('IMG-20250903-WA0001.jpg')
    expect(item!.kind).toBe('photo')
    expect(item!.anchorMessageId).toBe(mediaMsg.id)
  })

  it('joins multiline messages into the previous message', () => {
    const { messages } = parseChat(fixture('multiline-and-system.txt'), 'chat-2')
    const first = messages.find((m) => m.text.startsWith('First line'))
    expect(first!.text).toBe('First line\nsecond line of the same message')
  })

  it('flags system messages and excludes their sender-less line from participants oddly attributed', () => {
    const { messages } = parseChat(fixture('multiline-and-system.txt'), 'chat-2')
    const systemMsg = messages.find((m) => m.text.includes('created group'))
    expect(systemMsg!.isSystemMessage).toBe(true)
  })

  it('produces stable ids across repeated parses of the same content', () => {
    const a = parseChat(fixture('basic.txt'), 'chat-1')
    const b = parseChat(fixture('basic.txt'), 'chat-1')
    expect(a.messages.map((m) => m.id)).toEqual(b.messages.map((m) => m.id))
  })

  it('retains a real sender and does not flag their message as a system message when the text contains "left"/"added"/"removed"', () => {
    const content = '3/9/25, 8:14 AM - Ana Ferreira: I left my keys at home\n'
    const { messages, participants } = parseChat(content, 'chat-3')
    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('Ana Ferreira')
    expect(messages[0].isSystemMessage).toBe(false)
    expect(participants).toContain('Ana Ferreira')
  })

  it('does not append a spurious trailing newline to the last message from a trailing-newline-terminated export', () => {
    const { messages } = parseChat(fixture('basic.txt'), 'chat-1')
    const last = messages[messages.length - 1]
    expect(last.text).toBe('Sending the boarding pass now')
    expect(last.text.endsWith('\n')).toBe(false)
  })

  it('does not append a spurious trailing newline when content ends with two blank lines', () => {
    const content = '3/9/25, 8:14 AM - Ana Ferreira: I left my keys at home\n\n'
    const { messages } = parseChat(content, 'chat-5')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('I left my keys at home')
  })

  it('preserves an intentional blank line in the middle of a multiline message', () => {
    const content = [
      '3/9/25, 8:14 AM - Ana Ferreira: First paragraph',
      '',
      'Second paragraph',
    ].join('\n')
    const { messages } = parseChat(content, 'chat-4')
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('First paragraph\n\nSecond paragraph')
  })
})
