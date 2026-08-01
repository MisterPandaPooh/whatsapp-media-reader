// src/storage/reparseChat.ts
import { PARSER_VERSION } from '../parser/version'
import { saveChat } from './chatRepository'
import type { ImportResponse } from '../worker/importWorker'
import type { MediaItem, StoredChat } from '../types'

/** True when `chat` was parsed by an older build and should be re-parsed. */
export function needsReparse(chat: StoredChat): boolean {
  return chat.parserVersion !== PARSER_VERSION
}

/**
 * Re-parses a stored chat from the transcript still in its storage and returns
 * the updated record, already saved.
 *
 * Stars are carried over by id. Message ids are a hash of the chat id, the
 * timestamp, the sender and the raw line, so every message the fix did not
 * affect keeps its id and its star; a star on an item whose message boundaries
 * *were* wrong has no counterpart in the corrected parse and is dropped, which
 * is the honest outcome — that item, as it was stored, did not exist.
 *
 * Throws if the transcript can no longer be read (folder moved, permission not
 * granted, OPFS evicted). Callers fall back to showing the stored parse: stale
 * is worse than correct, but far better than nothing.
 */
export function reparseChat(chat: StoredChat): Promise<StoredChat> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../worker/importWorker.ts', import.meta.url), {
      type: 'module',
    })
    const finish = () => worker.terminate()

    worker.onmessage = (e: MessageEvent<ImportResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') return
      finish()
      if (msg.type === 'error') {
        reject(new Error(msg.message))
        return
      }
      // A re-parse that finds nothing is not an upgrade, it is a failure to read
      // the transcript — keep the stored chat rather than replacing a working
      // library with an empty one.
      if (msg.parsed.messages.length === 0) {
        reject(new Error('The transcript could not be re-read.'))
        return
      }
      const media: MediaItem[] = msg.parsed.media.map((m) =>
        chat.starred[m.id] ? { ...m, starred: true } : m,
      )
      // Drop stars whose item no longer exists, so the map cannot grow without
      // bound across successive upgrades.
      const live = new Set(media.map((m) => m.id))
      const starred = Object.fromEntries(
        Object.entries(chat.starred).filter(([id, on]) => on && live.has(id)),
      )
      const next: StoredChat = {
        ...chat,
        parsed: { ...msg.parsed, media },
        starred,
        parserVersion: PARSER_VERSION,
      }
      saveChat(next).then(
        () => resolve(next),
        // The parse itself is good; only persisting it failed. Show it now and
        // let the next load try the upgrade again.
        () => resolve(next),
      )
    }
    worker.onerror = (e) => {
      finish()
      reject(new Error(e.message || 'The import worker crashed.'))
    }

    worker.postMessage({ kind: 'reparse', chatId: chat.chatId, storageRef: chat.storageRef })
  })
}
