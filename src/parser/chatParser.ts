// src/parser/chatParser.ts
import type { Message, MediaItem, ParsedChat } from '../types'
import { matchDatePrefix } from './dateFormats'
import { extractMediaFilename, detectKind, isSystemMessage } from './mediaIndicators'
import { makeIdGenerator } from './id'

const URL_RE = /https?:\/\/\S+/i

function splitSenderContent(rest: string): { sender: string; content: string } {
  const colonIndex = rest.indexOf(':')
  if (colonIndex > 0 && colonIndex < 50) {
    return { sender: rest.slice(0, colonIndex).trim(), content: rest.slice(colonIndex + 1).trim() }
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
      const item: MediaItem = {
        id: `${id}-media`,
        kind: detectKind(filename),
        filename,
        size: 0,
        caption: pending.text.replace(filename, '').trim(),
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
