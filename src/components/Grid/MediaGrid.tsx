// src/components/Grid/MediaGrid.tsx
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MediaItem, StorageRef } from '../../types'
import { MediaTile } from './MediaTile'
import './Grid.css'

interface Props {
  items: MediaItem[]
  storageRef: StorageRef
  activeMediaId: string | null
  onOpen: (id: string) => void
}

const TILE_SIZE = 152
const GAP = 10

export function MediaGrid({ items, storageRef, activeMediaId, onOpen }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Kept in state as well as in a ref: tiles need it as their
  // IntersectionObserver root, and that has to re-run once it exists.
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)
  const setParent = useCallback((el: HTMLDivElement | null) => {
    parentRef.current = el
    setScrollRoot(el)
  }, [])
  // Measured content width of the list (padding excluded). 0 until first
  // layout — reading a ref during render would be wrong on first paint and
  // would never update on resize.
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure() // synchronous first measure, before paint
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const measured = width > 0
  const columns = Math.max(1, Math.floor((width + GAP) / (TILE_SIZE + GAP)))

  const rows = useMemo(() => {
    if (!measured) return []
    const out: MediaItem[][] = []
    for (let i = 0; i < items.length; i += columns) out.push(items.slice(i, i + columns))
    return out
  }, [items, columns, measured])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_SIZE + GAP,
    overscan: 4,
  })

  return (
    <div ref={setParent} className="grid-scroll">
      <div
        ref={listRef}
        className="grid-sizer"
        style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="grid-row"
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              gap: GAP,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {(rows[virtualRow.index] ?? []).map((item) => (
              <MediaTile
                key={item.id}
                item={item}
                storageRef={storageRef}
                selected={item.id === activeMediaId}
                onOpen={onOpen}
                scrollRoot={scrollRoot}
              />
            ))}
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="grid-empty">No media matches these filters</div>}
    </div>
  )
}
