// src/parser/chatParser.ts
import type { Message, MediaItem, ParsedChat } from '../types'
import { matchDatePrefix } from './dateFormats'
import { extractMediaFilename, detectKind, isSystemMessage, stripMediaMarker } from './mediaIndicators'
import { makeIdGenerator } from './id'

const URL_RE = /https?:\/\/\S+/i

// A sender name is bounded only by WhatsApp's contact-name limits, and contacts
// imported from the address book are routinely long — a full name with several
// surnames, or a phone number carrying a label. The cap exists purely to stop a
// colon *inside* a system line from being read as a sender delimiter, so it can
// be generous: 120 comfortably covers real names while still rejecting a colon
// buried deep in a sentence.
const MAX_SENDER_LENGTH = 120

function splitSenderContent(rest: string): { sender: string; content: string } {
  const colonIndex = rest.indexOf(':')
  const candidate = colonIndex > 0 ? rest.slice(0, colonIndex) : ''
  // A sender name never spans lines, so a candidate containing one is message
  // text that merely happens to contain a colon.
  if (candidate !== '' && candidate.length <= MAX_SENDER_LENGTH && !/[\r\n]/.test(candidate)) {
    return { sender: candidate.trim(), content: rest.slice(colonIndex + 1).trim() }
  }
  return { sender: '', content: rest.trim() }
}

export function parseChat(content: string, chatId: string): ParsedChat {
  const lines = content.split(/\r?\n/)
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const generateId = makeIdGenerator(chatId)
  const participants = new Set<string>()
  const messages: Message[] = []
  const media: MediaItem[] = []

  let pending: { timestampMs: number; sender: string; text: string; system: boolean } | null = null

  const flush = () => {
    if (!pending) return
    // Deliberately hashed from the *raw* line, before any marker stripping: the
    // id seeds every MediaItem id, and those are the keys of the persisted
    // `starred` map. Hashing the stripped text instead would silently orphan
    // the stars of every chat imported by an earlier build.
    const id = generateId(pending.timestampMs, pending.sender, pending.text)
    const msg: Message = {
      id,
      sender: pending.sender,
      timestampMs: pending.timestampMs,
      text: pending.text,
      isSystemMessage: pending.system,
    }

    const filename = extractMediaFilename(pending.text)
    const url = pending.text.match(URL_RE)?.[0]
    if (filename) {
      // The marker is WhatsApp's own bookkeeping, not something anyone typed,
      // so it comes off the bubble text as well as the caption — otherwise the
      // conversation thread renders a literal `<attached: IMG-0002.png>`. When
      // the marker *was* the whole message this leaves the text empty, and
      // MessageThread renders the attachment chip instead of an empty bubble.
      const caption = stripMediaMarker(pending.text)
      msg.text = caption
      const item: MediaItem = {
        id: `${id}-media`,
        kind: detectKind(filename),
        filename,
        size: 0,
        caption,
        sender: pending.sender,
        timestampMs: pending.timestampMs,
        anchorMessageId: id,
        starred: false,
        missing: false,
      }
      media.push(item)
      msg.mediaId = item.id
    } else if (url && !pending.system) {
      const item: MediaItem = {
        id: `${id}-media`,
        kind: 'link',
        filename: url,
        size: 0,
        caption: pending.text,
        sender: pending.sender,
        timestampMs: pending.timestampMs,
        anchorMessageId: id,
        starred: false,
        missing: false,
      }
      media.push(item)
      msg.mediaId = item.id
    }

    messages.push(msg)
    pending = null
  }

  for (const rawLine of lines) {
    if (!rawLine.trim() && !pending) continue
    const dateMatch = matchDatePrefix(rawLine)
    if (dateMatch) {
      flush()
      const { sender, content } = splitSenderContent(dateMatch.rest)
      const system = !sender || isSystemMessage(content)
      pending = { timestampMs: dateMatch.timestampMs, sender, text: content, system }
      if (sender && !system) participants.add(sender)
    } else if (pending) {
      pending.text += `\n${rawLine}`
    }
  }
  flush()

  return { messages, media, participants: Array.from(participants).sort() }
}
