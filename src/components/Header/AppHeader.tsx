// src/components/Header/AppHeader.tsx
import { useMemo } from 'react'
import type { ParsedChat } from '../../types'
import { chatMetaLine, initialsOf } from './headerMeta'
import './Header.css'

interface Props {
  title: string
  parsed: ParsedChat
  onImport: () => void
  /** Drops this chat and goes back to the import screen. */
  onClose: () => void
  /** What this app is using in the browser. Absent on a browser that will not
   *  say, in which case the button is not shown rather than showing nothing. */
  storageLabel?: string
  onOpenStorage: () => void
}

export function AppHeader({ title, parsed, onImport, onClose, storageLabel, onOpenStorage }: Props) {
  // Scans every message for the date range; the chat can be six figures long
  // and this re-renders on every keystroke in the toolbar's search box.
  const meta = useMemo(() => chatMetaLine(parsed), [parsed])

  return (
    <header className="app-header">
      <div className="chat-avatar" aria-hidden="true">
        {initialsOf(title)}
      </div>
      <div className="chat-ident">
        <h1 className="chat-title" title={title}>
          {title}
        </h1>
        <div className="chat-meta">{meta}</div>
      </div>
      {storageLabel && (
        <button
          type="button"
          className="header-btn header-btn--quiet header-btn--meter"
          onClick={onOpenStorage}
          title="Storage this app is using in your browser"
        >
          {storageLabel}
        </button>
      )}
      <button type="button" className="header-btn" onClick={onImport}>
        Import chat…
      </button>
      {/* Quieter than Import: it is the destructive one, so it should not be
          the button the eye lands on first. */}
      <button type="button" className="header-btn header-btn--quiet" onClick={onClose}>
        Close chat
      </button>
    </header>
  )
}
