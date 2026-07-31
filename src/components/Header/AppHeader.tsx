// src/components/Header/AppHeader.tsx
import { useMemo } from 'react'
import type { ParsedChat } from '../../types'
import { chatMetaLine, initialsOf } from './headerMeta'
import './Header.css'

interface Props {
  title: string
  parsed: ParsedChat
  onImport: () => void
}

export function AppHeader({ title, parsed, onImport }: Props) {
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
      <button type="button" className="header-btn" onClick={onImport}>
        Import chat…
      </button>
    </header>
  )
}
