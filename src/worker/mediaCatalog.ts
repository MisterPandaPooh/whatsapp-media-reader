import type { MediaItem } from '../types'

/**
 * macOS writes filenames to disk decomposed (NFD: `e` + combining acute), while
 * the transcript WhatsApp generates carries whatever form the sending device
 * used — usually composed (NFC: `é`). The two are canonically equivalent and
 * look identical, but they are different strings, so a plain `Map.get` misses
 * and a file sitting right there on disk is reported as missing.
 *
 * Normalizing both sides to NFC makes the lookup form-insensitive. This is the
 * same class of failure as the mis-flagged-UTF-8 entry names handled in
 * `unzipStreaming`: the bytes are fine, the two spellings just have to be
 * reconciled before they are compared.
 */
export function normalizeFilename(name: string): string {
  return name.normalize('NFC')
}

export function reconcileMediaWithFiles(
  items: MediaItem[],
  fileSizesByName: Map<string, number>,
): MediaItem[] {
  // Built lazily: only pay for the extra map when a name actually needs folding,
  // which is never for a plain-ASCII export.
  let normalized: Map<string, number> | null = null
  const sizeOf = (filename: string): number | undefined => {
    const exact = fileSizesByName.get(filename)
    if (exact !== undefined) return exact
    if (!normalized) {
      normalized = new Map()
      for (const [name, size] of fileSizesByName) normalized.set(normalizeFilename(name), size)
    }
    return normalized.get(normalizeFilename(filename))
  }

  return items.map((item) => {
    if (item.kind === 'link') return item
    const size = sizeOf(item.filename)
    return { ...item, missing: size === undefined, size: size ?? item.size }
  })
}
