// src/components/Grid/gridLayout.test.ts
import { describe, expect, it } from 'vitest'
import { GAP, TILE_SIZE, columnsForWidth, rowIndexOfItem } from './gridLayout'
import type { MediaItem } from '../../types'

function items(n: number): MediaItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    kind: 'photo' as const,
    filename: `IMG-${i}.jpg`,
    size: 0,
    caption: '',
    sender: 'Alice',
    timestampMs: 0,
    anchorMessageId: `msg${i}`,
    starred: false,
    missing: false,
  }))
}

describe('columnsForWidth', () => {
  it('fits exactly one tile with no trailing gap', () => {
    expect(columnsForWidth(TILE_SIZE)).toBe(1)
  })

  it('needs a gap between tiles before a second column appears', () => {
    expect(columnsForWidth(TILE_SIZE * 2 + GAP - 1)).toBe(1)
    expect(columnsForWidth(TILE_SIZE * 2 + GAP)).toBe(2)
  })

  it('never returns zero, even before the first measurement', () => {
    expect(columnsForWidth(0)).toBe(1)
    expect(columnsForWidth(40)).toBe(1)
  })
})

describe('rowIndexOfItem', () => {
  it('maps an item index to its row at the current column count', () => {
    const list = items(20)
    expect(rowIndexOfItem(list, 'm0', 4)).toBe(0)
    expect(rowIndexOfItem(list, 'm3', 4)).toBe(0)
    expect(rowIndexOfItem(list, 'm4', 4)).toBe(1)
    expect(rowIndexOfItem(list, 'm19', 4)).toBe(4)
  })

  it('re-maps the same item when the column count changes', () => {
    const list = items(20)
    // Same item, narrower window: it moves further down the row list.
    expect(rowIndexOfItem(list, 'm10', 5)).toBe(2)
    expect(rowIndexOfItem(list, 'm10', 2)).toBe(5)
  })

  it('returns -1 with no selection', () => {
    expect(rowIndexOfItem(items(5), null, 3)).toBe(-1)
  })

  it('returns -1 when the selection is not in the filtered list', () => {
    // The user narrowed the filters while the panel was open: there is no tile
    // to scroll to, and row 0 would be a wrong answer.
    expect(rowIndexOfItem(items(5), 'not-here', 3)).toBe(-1)
  })

  it('returns -1 before the grid has been measured', () => {
    expect(rowIndexOfItem(items(5), 'm2', 0)).toBe(-1)
  })
})
