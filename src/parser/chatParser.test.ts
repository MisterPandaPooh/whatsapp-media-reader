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

  it('leaves an empty caption when a media message is just an attachment marker', () => {
    const { messages, media } = parseChat(fixture('basic.txt'), 'chat-1')
    const item = media.find((m) => m.id === messages[1].mediaId)!
    expect(item.caption).toBe('')
  })

  it('keeps only the user caption for an iOS attachment with a caption', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: ‎<attached: IMG-20250903-WA0001.jpg>\nsunset at the beach\n'
    const { media } = parseChat(content, 'chat-6')
    expect(media).toHaveLength(1)
    expect(media[0].caption).toBe('sunset at the beach')
  })

  it('keeps only the user caption for an Android attachment with a caption', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: IMG-20250903-WA0012.jpg (file attached)\nsunset at the beach\n'
    const { media } = parseChat(content, 'chat-7')
    expect(media).toHaveLength(1)
    expect(media[0].filename).toBe('IMG-20250903-WA0012.jpg')
    expect(media[0].caption).toBe('sunset at the beach')
  })

  it('leaves an empty caption for a bare Android attachment', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: IMG-20250903-WA0012.jpg (file attached)\n'
    const { media } = parseChat(content, 'chat-8')
    expect(media[0].caption).toBe('')
  })

  it('strips the attachment marker from the message text, not only from the caption', () => {
    // The thread in the detail panel renders Message.text verbatim, so a marker
    // left here shows up as a literal "<attached: IMG-…jpg>" bubble.
    const { messages } = parseChat(fixture('basic.txt'), 'chat-1')
    expect(messages[1].mediaId).toBeDefined()
    expect(messages[1].text).toBe('')
  })

  it('keeps only the user caption in the message text of a captioned iOS attachment', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: ‎<attached: IMG-20250903-WA0001.jpg>\nsunset at the beach\n'
    const { messages } = parseChat(content, 'chat-9')
    expect(messages[0].text).toBe('sunset at the beach')
  })

  it('keeps only the user caption in the message text of a captioned Android attachment', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: IMG-20250903-WA0012.jpg (file attached)\nsunset at the beach\n'
    const { messages } = parseChat(content, 'chat-10')
    expect(messages[0].text).toBe('sunset at the beach')
  })

  it('never leaves attachment marker residue in any message text', () => {
    const { messages } = parseChat(fixture('basic.txt'), 'chat-1')
    for (const m of messages) {
      expect(m.text).not.toContain('attached')
      expect(m.text).not.toContain('<')
      expect(m.text).not.toContain('‎')
    }
  })

  it('leaves the text of a plain message that merely contains a URL alone', () => {
    // A link "media item" has no marker to strip: its text is the message.
    const content = '3/9/25, 8:15 AM - Ana Ferreira: look at https://example.com/x nice\n'
    const { messages, media } = parseChat(content, 'chat-11')
    expect(media[0].kind).toBe('link')
    expect(messages[0].text).toBe('look at https://example.com/x nice')
  })

  it('never leaves attachment marker residue in a caption', () => {
    const { media } = parseChat(fixture('basic.txt'), 'chat-1')
    for (const item of media) {
      expect(item.caption).not.toContain('attached')
      expect(item.caption).not.toContain('<')
      expect(item.caption).not.toContain('‎')
    }
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

  it('extracts a document filename containing spaces and keeps the caption clean', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: Q1 Budget Review.pdf (file attached)\nthe numbers we discussed\n'
    const { messages, media } = parseChat(content, 'chat-12')
    expect(media).toHaveLength(1)
    expect(media[0].filename).toBe('Q1 Budget Review.pdf')
    expect(media[0].kind).toBe('doc')
    expect(media[0].caption).toBe('the numbers we discussed')
    expect(messages[0].text).toBe('the numbers we discussed')
  })

  it('extracts a spaced document filename from a bidi-prefixed Android marker', () => {
    const content = '3/9/25, 8:15 AM - Tomás Silva: ‎Trip Photos 2026.zip (file attached)\n'
    const { media } = parseChat(content, 'chat-13')
    expect(media[0].filename).toBe('Trip Photos 2026.zip')
    expect(media[0].caption).toBe('')
  })

  it('keeps a sender name longer than 50 characters instead of treating the line as a system message', () => {
    const sender = 'Maria João Fernandes da Silva Costa Ribeiro Almeida'
    expect(sender.length).toBeGreaterThanOrEqual(50)
    const content = `3/9/25, 8:14 AM - ${sender}: see you at the gate\n`
    const { messages, participants } = parseChat(content, 'chat-14')
    expect(messages[0].sender).toBe(sender)
    expect(messages[0].text).toBe('see you at the gate')
    expect(messages[0].isSystemMessage).toBe(false)
    expect(participants).toContain(sender)
  })

  it('keeps a long phone-plus-label contact string as the sender', () => {
    const sender = '+351 912 345 678 (Lisbon Airbnb Host - Do Not Call)'
    expect(sender.length).toBeGreaterThanOrEqual(50)
    const content = `3/9/25, 8:14 AM - ${sender}: check-in is at 3pm\n`
    const { messages, participants } = parseChat(content, 'chat-15')
    expect(messages[0].sender).toBe(sender)
    expect(messages[0].isSystemMessage).toBe(false)
    expect(participants).toContain(sender)
  })

  it('still treats a sender-less line as a system message', () => {
    const content = '3/9/25, 8:20 AM - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.\n'
    const { messages, participants } = parseChat(content, 'chat-16')
    expect(messages[0].sender).toBe('')
    expect(messages[0].isSystemMessage).toBe(true)
    expect(participants).toEqual([])
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

// Reproduces a real iOS export: every line prefixed with U+200E, and the
// attachment marker prefixed with one too. Before the date patterns stripped
// the mark, none of these lines matched — so they were all appended to whatever
// message came first, and the reader showed "[29/07/2026, 14:01:39] Nina
// Duval: <attached: …>" as raw text inside a single bubble.
describe('parseChat on a real iOS export', () => {
  const LTR = '‎'
  const content = [
    `${LTR}[29/07/2026, 14:01:02] Nina Duval: on est en route`,
    `${LTR}[29/07/2026, 14:01:21] Nina Duval: ${LTR}<attached: 00000104-PHOTO-2026-07-29-14-01-21.jpg>`,
    `${LTR}[29/07/2026, 14:01:39] Nina Duval: ${LTR}<attached: 00000105-PHOTO-2026-07-29-14-01-39.jpg>`,
    `${LTR}[29/07/2026, 14:01:57] Nina Duval: ${LTR}<attached: 00000106-PHOTO-2026-07-29-14-01-57.jpg>`,
  ].join('\n')

  it('parses every line as its own message', () => {
    const { messages } = parseChat(content, 'ios-chat')
    expect(messages).toHaveLength(4)
  })

  it('attributes the sender instead of swallowing the prefix as text', () => {
    const { messages, participants } = parseChat(content, 'ios-chat')
    expect(participants).toEqual(['Nina Duval'])
    for (const m of messages) {
      expect(m.sender).toBe('Nina Duval')
      expect(m.text).not.toContain('[29/07/2026')
      expect(m.text).not.toContain('Nina Duval:')
    }
  })

  it('links each attachment and leaves no marker in the text', () => {
    const { messages, media } = parseChat(content, 'ios-chat')
    expect(media).toHaveLength(3)
    expect(media.map((m) => m.filename)).toEqual([
      '00000104-PHOTO-2026-07-29-14-01-21.jpg',
      '00000105-PHOTO-2026-07-29-14-01-39.jpg',
      '00000106-PHOTO-2026-07-29-14-01-57.jpg',
    ])
    for (const m of messages) expect(m.text).not.toContain('<attached:')
  })

  it('reads the timestamps rather than collapsing them onto one message', () => {
    const { messages } = parseChat(content, 'ios-chat')
    const seconds = messages.map((m) => new Date(m.timestampMs).getSeconds())
    expect(seconds).toEqual([2, 21, 39, 57])
  })
})
