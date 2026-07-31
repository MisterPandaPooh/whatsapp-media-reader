// src/App.tsx
import { useEffect, useMemo, useState } from 'react'
import { ImportScreen } from './components/ImportScreen/ImportScreen'
import { Toolbar } from './components/Toolbar/Toolbar'
import { MediaGrid } from './components/Grid/MediaGrid'
import { DetailPanel } from './components/Panel/DetailPanel'
import { useChatStore } from './store/useChatStore'
import { filteredMedia } from './store/selectors'
import { loadLastChat } from './storage/chatRepository'
import { ensurePermission, hasPermission, isStorageReachable } from './storage/fileAccess'
import type { StoredChat } from './types'
import './App.css'

// Both are load-bearing: OPFS is where a dropped .zip is unpacked, and the
// directory picker is the only way to open an unzipped export folder. Today
// that combination means a Chromium browser.
const SUPPORTED =
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function' &&
  typeof navigator.storage?.getDirectory === 'function'

export default function App() {
  const chat = useChatStore((s) => s.chat)
  const setChat = useChatStore((s) => s.setChat)
  const filters = useChatStore((s) => s.filters)
  const activeMediaId = useChatStore((s) => s.activeMediaId)
  const openMedia = useChatStore((s) => s.openMedia)
  const closePanel = useChatStore((s) => s.closePanel)

  // Nothing renders until IndexedDB has been consulted: showing the drop zone
  // first and swapping to the grid a beat later is a visible flash of the wrong
  // screen on every reload.
  const [restoring, setRestoring] = useState(true)
  // A restored folder-backed chat whose permission has to be re-granted by a
  // click before we can read anything out of it.
  const [needsPermission, setNeedsPermission] = useState<StoredChat | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  useEffect(() => {
    if (!SUPPORTED) {
      setRestoring(false)
      return
    }
    let cancelled = false
    void (async () => {
      let stored: StoredChat | null = null
      try {
        stored = await loadLastChat()
      } catch {
        // A corrupt or blocked database must not wedge the app on a blank
        // screen — fall through to the import screen.
        stored = null
      }
      if (cancelled) return
      if (stored) {
        // Only *query* the permission here: requestPermission() needs transient
        // user activation, which a page-load effect does not have.
        const granted = await hasPermission(stored.storageRef)
        if (cancelled) return
        if (!granted) {
          setNeedsPermission(stored)
        } else {
          const reachable = await isStorageReachable(stored.storageRef)
          if (cancelled) return
          // Unreachable storage (OPFS evicted, folder deleted or moved) falls
          // through to the import screen rather than a grid of broken tiles.
          if (reachable) setChat(stored)
        }
      }
      if (!cancelled) setRestoring(false)
    })()
    return () => {
      cancelled = true
    }
  }, [setChat])

  // Escape pressed anywhere outside the panel (a grid tile, the page body)
  // closes it. The panel's own handler stops propagation before the event
  // reaches window, and the Toolbar's capture-phase handler calls
  // preventDefault() when it closes a popover — so one Escape never both
  // dismisses a popover and closes the panel.
  useEffect(() => {
    if (!activeMediaId) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const tag = (e.target as HTMLElement | null)?.tagName
      // Escape in a text field belongs to the field (clearing the search box).
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      closePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeMediaId, closePanel])

  async function reconnect() {
    const pending = needsPermission
    if (!pending) return
    setPermissionError(null)
    let granted = false
    try {
      granted = await ensurePermission(pending.storageRef)
    } catch {
      granted = false
    }
    if (!granted) {
      setPermissionError('Access was not granted. Without it this export cannot be read.')
      return
    }
    if (!(await isStorageReachable(pending.storageRef))) {
      setPermissionError('That folder is no longer where it was. Import the export again.')
      return
    }
    setChat(pending)
    setNeedsPermission(null)
  }

  const media = useMemo(
    () => (chat ? filteredMedia(chat.parsed.media, filters) : []),
    [chat, filters],
  )
  const filteredIds = useMemo(() => media.map((m) => m.id), [media])
  // Deliberately looked up only within the *filtered* set: if the active item
  // drops out of the filtered results (the user changed a filter while the
  // panel was open), the panel closes itself instead of showing a stale item
  // with a broken "N of M" position indicator.
  const activeItem = activeMediaId ? media.find((m) => m.id === activeMediaId) : undefined

  if (!SUPPORTED) {
    return (
      <div className="unsupported">
        <div className="unsupported-title">This reader needs a Chromium browser</div>
        <p>
          It reads your export straight off disk using the File System Access API and the origin
          private file system — Chrome, Edge, Brave, Arc and Opera support both today; Safari and
          Firefox do not. Nothing is ever uploaded, which is precisely why it needs them.
        </p>
      </div>
    )
  }

  if (restoring) return null

  if (needsPermission) {
    return (
      <div className="import-overlay">
        <div className="import-card summary-card">
          <div className="import-title">Reconnect “{needsPermission.title}”</div>
          <div className="import-sub">
            This export lives in a folder on your disk. Browsers drop folder access when the tab
            closes, so it has to be granted again — one click, the same folder as before.
          </div>
          <div className="import-actions">
            <button type="button" className="btn-primary" onClick={() => void reconnect()}>
              Reconnect folder
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setNeedsPermission(null)
                setPermissionError(null)
              }}
            >
              Import a different export
            </button>
          </div>
          {permissionError && (
            <div className="import-error" role="alert">
              {permissionError}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!chat) return <ImportScreen onOpen={(c: StoredChat) => setChat(c)} />

  return (
    <div className="app-shell">
      <Toolbar media={chat.parsed.media} resultCount={media.length} />
      <div className="app-body">
        <main className="app-main">
          <MediaGrid
            // Remounts on a chat switch. useLazyThumbnail collapses every
            // directory handle to the same effect key, so a tile carried over
            // from a previous chat could otherwise read from the old folder.
            key={chat.chatId}
            items={media}
            storageRef={chat.storageRef}
            activeMediaId={activeMediaId}
            onOpen={openMedia}
          />
        </main>
        {activeItem && (
          <DetailPanel
            activeItem={activeItem}
            messages={chat.parsed.messages}
            filteredIds={filteredIds}
            meParticipant={chat.meParticipant}
            storageRef={chat.storageRef}
          />
        )}
      </div>
    </div>
  )
}
