// src/storage/originStorage.ts
//
// What this app costs the browser, and how to get it back.
//
// Only a *zip* import costs anything: its attachments are unpacked into OPFS,
// which is a second full copy of the export on disk. A folder import costs
// nothing at all — we hold a handle and read the user's own folder in place.

import { getDb } from './db'

export interface StorageUsage {
  /** Bytes this origin is using, as the browser reports it. */
  usage: number
  /** Bytes it will let the origin use. 0 when the browser won't say. */
  quota: number
  /** Whether the browser has agreed not to evict this data under pressure. */
  persisted: boolean
}

export interface SweepResult {
  /** Folder names removed. */
  removed: string[]
  /** Bytes reclaimed, measured either side of the sweep. Never negative — a
   *  concurrent write can make the second reading the larger of the two. */
  bytesFreed: number
}

/**
 * How long an unfinished extraction is left alone. A zip import writes into its
 * OPFS folder for as long as the unpacking takes — minutes, for a large export —
 * and the chat record that would claim the folder is not written until the user
 * presses "Open media reader" at the end. So an in-progress import is
 * indistinguishable from an abandoned one except by age, and sweeping too eagerly
 * would delete the import running in another tab right now.
 */
const IN_FLIGHT_GRACE_MS = 60 * 60 * 1000

export async function storageEstimate(): Promise<StorageUsage | null> {
  try {
    if (typeof navigator.storage?.estimate !== 'function') return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const persisted =
      typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : false
    return { usage, quota, persisted }
  } catch {
    return null
  }
}

/** Folder names OPFS holds for chats that still exist. */
async function claimedFolders(): Promise<Set<string>> {
  const db = await getDb()
  const chats = await db.getAll('chats')
  const claimed = new Set<string>()
  for (const chat of chats) {
    if (chat.storageRef.kind === 'opfs') claimed.add(chat.storageRef.folder)
  }
  return claimed
}

/**
 * Whether an unclaimed folder is safe to delete.
 *
 * `_chat.txt` is written *last*, once the whole archive has been unpacked, so
 * its presence means the extraction finished — and an unclaimed finished
 * extraction is an import the user walked away from at the summary screen.
 *
 * Without it the extraction either crashed or is still running. Those two look
 * identical from here, so the tie-break is the age of the bytes already written:
 * a live extraction is writing continuously, so any file in the folder carries a
 * recent timestamp. One entry is enough to tell, which keeps this O(1) rather
 * than a stat of every file in a 13 GB export.
 */
async function isAbandoned(dir: FileSystemDirectoryHandle, now: number): Promise<boolean> {
  try {
    await dir.getFileHandle('_chat.txt')
    return true
  } catch {
    // No transcript — fall through to the age check.
  }
  for await (const [, entry] of dir.entries()) {
    if (entry.kind !== 'file') continue
    const file = await entry.getFile()
    return now - file.lastModified > IN_FLIGHT_GRACE_MS
  }
  // Empty folder: created, nothing written. Nothing to lose either way.
  return true
}

/**
 * Removes OPFS folders no chat points at.
 *
 * These are the real leak. Importing a new chat and "Close chat" both discard
 * the folder they replace, so ordinary use does not accumulate — but a tab
 * closed mid-extraction, or a crash after several gigabytes have been written,
 * strands a folder that nothing will ever reference or delete again.
 *
 * Deliberately unconditional: no size threshold and no expiry. Data the user can
 * still reach is never touched, and data nothing can reach is never worth
 * keeping, whatever its size or age.
 */
export async function sweepOrphanedStorage(): Promise<SweepResult> {
  const empty: SweepResult = { removed: [], bytesFreed: 0 }
  if (typeof navigator.storage?.getDirectory !== 'function') return empty

  let root: FileSystemDirectoryHandle
  let claimed: Set<string>
  try {
    root = await navigator.storage.getDirectory()
    claimed = await claimedFolders()
  } catch {
    // A database we cannot read means we cannot tell claimed from orphaned, and
    // guessing here deletes someone's library. Do nothing.
    return empty
  }

  const before = await storageEstimate()
  const now = Date.now()
  const removed: string[] = []

  // Collected first: removing entries while iterating the directory is exactly
  // the sort of thing that quietly skips every other one.
  const candidates: FileSystemDirectoryHandle[] = []
  const names: string[] = []
  try {
    for await (const [name, entry] of root.entries()) {
      if (entry.kind !== 'directory' || claimed.has(name)) continue
      candidates.push(entry)
      names.push(name)
    }
  } catch {
    return empty
  }

  for (let i = 0; i < candidates.length; i++) {
    try {
      if (!(await isAbandoned(candidates[i], now))) continue
      await root.removeEntry(names[i], { recursive: true })
      removed.push(names[i])
    } catch {
      // One folder we cannot read or remove must not stop the rest.
    }
  }

  const after = await storageEstimate()
  const bytesFreed = before && after ? Math.max(0, before.usage - after.usage) : 0
  return { removed, bytesFreed }
}

/**
 * Asks the browser not to evict this origin. Without it OPFS is discardable
 * under storage pressure, which for this app means a library disappearing
 * between visits with no explanation. Chromium grants it silently for a site the
 * user engages with and refuses otherwise; either way there is nothing to
 * report, so this is fire-and-forget.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator.storage?.persist !== 'function') return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
