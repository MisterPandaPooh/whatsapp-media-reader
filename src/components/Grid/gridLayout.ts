// src/components/Grid/gridLayout.ts
// Pure layout arithmetic for the virtualized media grid. Lives outside the
// component so the row-index mapping the "scroll selection into view" effect
// depends on can be tested without a layout engine.
import type { MediaItem } from '../../types'

export const TILE_SIZE = 152
export const GAP = 10

/**
 * How many tiles fit across `width` px of content box. The trailing tile needs
 * no gap after it, hence the `+ GAP` before the division. Always at least 1, so
 * a narrower-than-one-tile viewport still renders a (clipped) column rather
 * than dividing by zero rows.
 */
export function columnsForWidth(width: number): number {
  return Math.max(1, Math.floor((width + GAP) / (TILE_SIZE + GAP)))
}

/**
 * Which virtualized row holds `id`, given the current column count.
 * -1 when there is no selection, or the selection is not in `items` — the item
 * was filtered out from under the panel, and there is nothing to scroll to.
 */
export function rowIndexOfItem(items: MediaItem[], id: string | null, columns: number): number {
  if (!id || columns < 1) return -1
  const index = items.findIndex((item) => item.id === id)
  return index === -1 ? -1 : Math.floor(index / columns)
}
