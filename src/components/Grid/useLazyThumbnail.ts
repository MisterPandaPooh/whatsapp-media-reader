// src/components/Grid/useLazyThumbnail.ts
import { useEffect, useRef, useState } from 'react'
import { readMediaFile } from '../../storage/fileAccess'
import type { MediaKind, StorageRef } from '../../types'

/**
 * Lazily loads a media file as an object URL, but only once the element the
 * returned `ref` is attached to scrolls within 200px of the viewport.
 *
 * The element type is generic so callers can attach the ref to whatever they
 * actually render (a <div>, a <button>, ...) without casting.
 */
export function useLazyThumbnail<T extends Element>(
  storageRef: StorageRef,
  filename: string,
  kind: MediaKind,
  enabled = true,
  /**
   * Scroll container to observe against. It matters: with the implicit root
   * (the viewport) the intersection rect is still clipped by the scrolling
   * ancestor, and `rootMargin` does not expand that clip — so nothing would
   * ever preload ahead of the visible edge.
   */
  root: Element | null = null,
) {
  const ref = useRef<T>(null)
  const [url, setUrl] = useState<string | null>(null)

  // The storage ref is an object; keeping the latest value in a ref (rather
  // than in the dependency array) prevents the observer from being torn down
  // and rebuilt on every parent render if the caller passes a fresh object.
  const storageRefLatest = useRef(storageRef)
  storageRefLatest.current = storageRef
  const storageKey = storageRef.kind === 'opfs' ? `opfs:${storageRef.folder}` : 'directory-handle'

  useEffect(() => {
    if (!enabled) return
    if (kind !== 'photo' && kind !== 'video') return
    const el = ref.current
    if (!el) return

    let cancelled = false
    let started = false
    // Holds the URL this effect run created, so cleanup revokes exactly that one.
    let objectUrl: string | null = null

    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return
        started = true
        // One load per element — stop observing immediately so a second
        // intersection can never create a second object URL.
        observer.disconnect()
        void (async () => {
          const file = await readMediaFile(storageRefLatest.current, filename)
          // The effect may have been cleaned up while the read was in flight;
          // creating a URL here would leak it, since cleanup already ran.
          if (cancelled || !file) return
          objectUrl = URL.createObjectURL(file)
          setUrl(objectUrl)
        })()
      },
      { root, rootMargin: '200px' },
    )
    observer.observe(el)

    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
      }
      setUrl(null)
    }
  }, [storageKey, filename, kind, enabled, root])

  return { ref, url }
}
