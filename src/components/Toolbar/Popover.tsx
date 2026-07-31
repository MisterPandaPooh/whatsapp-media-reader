// src/components/Toolbar/Popover.tsx
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** The control the popover hangs off; its rect drives the placement. */
  anchorRef: RefObject<HTMLElement | null>
  className?: string
  label: string
  children: ReactNode
}

/** Breathing room kept between the popover and the viewport edges. */
const MARGIN = 8
/** Vertical offset from the anchor, matching the old `top: 32px` on a 26px chip. */
const OFFSET = 6

/**
 * A popover rendered into `document.body` rather than next to its anchor.
 *
 * The toolbar is a wrapping flex row inside an `overflow: hidden` app shell, so
 * an absolutely-positioned popover was doubly constrained: it could be clipped
 * by the shell, and it could not be kept inside the viewport when its anchor
 * sat near the right edge. In a portal it is positioned in viewport
 * coordinates and clamped, which is also what makes it safe for the toolbar to
 * scroll or wrap at narrow widths.
 */
export function Popover({ anchorRef, className, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Hidden (but laid out) until placed: reading offsetWidth needs a real box,
  // and painting at 0,0 for a frame would be a visible flicker.
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current
      const el = ref.current
      if (!anchor || !el) return
      const a = anchor.getBoundingClientRect()
      const { offsetWidth: w, offsetHeight: h } = el
      const maxLeft = Math.max(MARGIN, window.innerWidth - w - MARGIN)
      const left = Math.min(Math.max(a.left, MARGIN), maxLeft)
      // Prefer below the anchor; flip above only when that would run off the
      // bottom and there is more room up top.
      const below = a.bottom + OFFSET
      const above = a.top - OFFSET - h
      const top = below + h > window.innerHeight - MARGIN && above > MARGIN ? above : below
      setStyle({ position: 'fixed', top, left, visibility: 'visible' })
    }
    place()
    window.addEventListener('resize', place)
    // Capture phase: any ancestor scrolling moves the anchor, and scroll events
    // on inner elements do not bubble.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef])

  return createPortal(
    <div ref={ref} className={className} style={style} role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  )
}
