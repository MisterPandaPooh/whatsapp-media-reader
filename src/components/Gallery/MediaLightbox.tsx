import { useEffect, useMemo, useRef, useState } from 'react'
import Lightbox, { type Slide } from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import { readMediaFile } from '../../storage/fileAccess'
import type { MediaItem, StorageRef } from '../../types'

/**
 * Slides either side of the current one to hold in memory. The gallery can be
 * opened over thousands of items, and every slide costs a file read plus a blob
 * URL — so URLs are minted for a window around the cursor and revoked as it
 * moves, rather than for the whole set up front.
 */
const PRELOAD_RADIUS = 2

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Stands in for a slide whose bytes are still being read. Slide indices have to
 * line up with `items` for the counter and the arrow keys to mean anything, so
 * an unloaded slide cannot simply be omitted — and an empty `src` is worse than
 * a placeholder: React warns about it, and the browser treats `src=""` as a
 * request for the page itself.
 */
const TRANSPARENT_PX =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

interface Props {
  items: MediaItem[]
  index: number
  storageRef: StorageRef
  onClose: () => void
  /** Keeps the reader's selection in step with the slide being viewed, so
   *  closing the gallery leaves the grid and panel where the eye ended up. */
  onIndexChange?: (mediaId: string) => void
}

export function MediaLightbox({ items, index, storageRef, onClose, onIndexChange }: Props) {
  const [current, setCurrent] = useState(index)
  const [urls, setUrls] = useState<Record<string, string>>({})
  // Mutable mirror of `urls` for the cleanup path: an effect that revoked from
  // the state snapshot would free URLs the newest render is still showing.
  const held = useRef<Map<string, string>>(new Map())

  useEffect(() => setCurrent(index), [index])

  useEffect(() => {
    let cancelled = false
    const wanted = new Set<string>()
    for (let i = current - PRELOAD_RADIUS; i <= current + PRELOAD_RADIUS; i++) {
      const item = items[i]
      if (item) wanted.add(item.id)
    }

    for (const [id, url] of held.current) {
      if (!wanted.has(id)) {
        URL.revokeObjectURL(url)
        held.current.delete(id)
      }
    }

    void Promise.all(
      [...wanted]
        .filter((id) => !held.current.has(id))
        .map(async (id) => {
          const item = items.find((m) => m.id === id)
          if (!item) return
          const file = await readMediaFile(storageRef, item.filename)
          if (cancelled || !file) return
          // The window may have moved on while this read was in flight; a URL
          // nobody wants any more must be freed rather than parked in state.
          if (!wanted.has(id)) return
          held.current.set(id, URL.createObjectURL(file))
        }),
    ).then(() => {
      if (!cancelled) setUrls(Object.fromEntries(held.current))
    })

    return () => {
      cancelled = true
    }
  }, [current, items, storageRef])

  // Revoke everything still held when the gallery closes.
  useEffect(() => {
    const map = held.current
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
      map.clear()
    }
  }, [])

  const slides = useMemo<Slide[]>(
    () =>
      items.map((item) => {
        const src = urls[item.id] ?? ''
        const description = `${item.sender} · ${dateFmt.format(item.timestampMs)}`
        if (item.kind === 'video') {
          return {
            type: 'video',
            sources: src ? [{ src, type: 'video/mp4' }] : [],
            title: item.caption || item.filename,
            description,
          } as Slide
        }
        return { src: src || TRANSPARENT_PX, title: item.caption || item.filename, description } as Slide
      }),
    [items, urls],
  )

  return (
    <Lightbox
      open
      close={onClose}
      index={current}
      slides={slides}
      plugins={[Captions, Counter, Video, Zoom]}
      // Arrow keys and Escape are the plugin's own keyboard controller; this
      // adds dismissing by clicking the backdrop around the image.
      controller={{ closeOnBackdropClick: true }}
      on={{
        view: ({ index: i }) => {
          setCurrent(i)
          const item = items[i]
          if (item) onIndexChange?.(item.id)
        },
      }}
      carousel={{ finite: true, preload: PRELOAD_RADIUS }}
      captions={{ descriptionTextAlign: 'center' }}
      styles={{ container: { backgroundColor: 'rgba(0, 0, 0, .92)' } }}
    />
  )
}
