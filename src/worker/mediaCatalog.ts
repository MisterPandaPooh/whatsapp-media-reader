import type { MediaItem } from '../types'

export function reconcileMediaWithFiles(
  items: MediaItem[],
  fileSizesByName: Map<string, number>,
): MediaItem[] {
  return items.map((item) => {
    if (item.kind === 'link') return item
    const size = fileSizesByName.get(item.filename)
    return { ...item, missing: size === undefined, size: size ?? item.size }
  })
}
