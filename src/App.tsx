// src/App.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImportScreen } from './components/ImportScreen/ImportScreen'
import { AppHeader } from './components/Header/AppHeader'
import { Toolbar } from './components/Toolbar/Toolbar'
import { MediaGrid } from './components/Grid/MediaGrid'
import { DetailPanel } from './components/Panel/DetailPanel'
import { useChatStore } from './store/useChatStore'
import { filteredMedia } from './store/selectors'
import { deleteChat, loadLastChat } from './storage/chatRepository'
import {
  discardStorage,
  ensurePermission,
  hasPermission,
  isStorageReachable,
} from './storage/fileAccess'
import type { StoredChat } from './types'
import './App.css'

// Both are load-bearing: OPFS is where a dropped .zip is unpacked, and the
// directory picker is the only way to open an unzipped export folder. Today
// that combination means a Chromium browser.
const SUPPORTED =
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function' &&
  typeof navigator.storage?.getDirectory === 'function'

/**
 * How long to wait for IndexedDB before giving up and showing the import
 * screen. A hung `open()` never rejects — a stale tab from an earlier session
 * holding a `deleteDatabase` blocked, for instance, queues every open behind it
 * indefinitely — and the try/catch below would wait forever, leaving `restoring`
 * stuck and the app rendering a blank white page with no explanation.
 *
 * Generous on purpose: restoring a large chat is a single multi-megabyte
 * structured-clone read, which is slow but not this slow. Ten seconds is well
 * past any real read and still short of the point where a blank screen reads as
 * broken.
 */
const RESTORE_TIMEOUT_MS = 10_000

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
  // Set when the restore was abandoned on the timeout above, so the import
  // screen can say why it is showing instead of the chat that was open last.
  const [restoreTimedOut, setRestoreTimedOut] = useState(false)
  // A restored folder-backed chat whose permission has to be re-granted by a
  // click before we can read anything out of it.
  const [needsPermission, setNeedsPermission] = useState<StoredChat | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  // "Import chat…" pressed while a chat is loaded. The import screen goes over
  // the reader, which stays mounted underneath so cancelling is free.
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!SUPPORTED) {
      setRestoring(false)
      return
    }
    // Covers all three exits — unmount, the timeout firing, and the load
    // finishing. Once it is true nothing below may touch state again, which is
    // what stops a load that finally resolves *after* the timeout from
    // clobbering an import the user has since started.
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      setRestoreTimedOut(true)
      setRestoring(false)
    }, RESTORE_TIMEOUT_MS)

    void (async () => {
      let stored: StoredChat | null = null
      try {
        stored = await loadLastChat()
      } catch {
        // A corrupt or blocked database must not wedge the app on a blank
        // screen — fall through to the import screen.
        stored = null
      }
      if (settled) return
      if (stored) {
        // Only *query* the permission here: requestPermission() needs transient
        // user activation, which a page-load effect does not have.
        const granted = await hasPermission(stored.storageRef)
        if (settled) return
        if (!granted) {
          setNeedsPermission(stored)
        } else {
          const reachable = await isStorageReachable(stored.storageRef)
          if (settled) return
          // Unreachable storage (OPFS evicted, folder deleted or moved) falls
          // through to the import screen rather than a grid of broken tiles.
          if (reachable) setChat(stored)
        }
      }
      settled = true
      clearTimeout(timer)
      setRestoring(false)
    })()

    return () => {
      settled = true
      clearTimeout(timer)
    }
  }, [setChat])

  // Escape pressed anywhere outside the panel (a grid tile, the page body)
  // closes it. The panel's own handler stops propagation before the event
  // reaches window, and the Toolbar's capture-phase handler calls
  // preventDefault() when it closes a popover — so one Escape never both
  // dismisses a popover and closes the panel.
  useEffect(() => {
    // While the import overlay is up, Escape belongs to it (ImportScreen cancels
    // itself with it). `inert` on the shell below stops clicks and Tab but has
    // no effect on a window-level key listener, so without this guard the same
    // Escape that dismisses the overlay would also close the detail panel
    // hidden behind it.
    if (!activeMediaId || importing) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const tag = (e.target as HTMLElement | null)?.tagName
      // Escape in a text field belongs to the field (clearing the search box).
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      closePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeMediaId, importing, closePanel])

  // Stable identity: ImportScreen subscribes a window listener keyed on this
  // prop, and a fresh arrow every render would tear it down and rebuild it on
  // every keystroke.
  const cancelImport = useCallback(() => setImporting(false), [])

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

  /**
   * Single-chat app: a completed import replaces whatever was loaded. The
   * replaced chat's IndexedDB record and its OPFS media are dropped afterwards
   * — without this, every re-import would leave a full copy of the previous
   * export behind in origin storage. Ordering matters: the new chat has already
   * been saved (and `lastChatId` repointed) by the import screen, so this can
   * only remove the old one. Fire-and-forget; a failure here is invisible and
   * harmless, and must not delay showing the new chat.
   */
  function adoptImportedChat(next: StoredChat) {
    const previous = useChatStore.getState().chat
    setChat(next)
    setImporting(false)
    if (previous && previous.chatId !== next.chatId) {
      void deleteChat(previous.chatId)
      void discardStorage(previous.storageRef)
    }
  }

  const media = useMemo(
    () => (chat ? filteredMedia(chat.parsed.media, filters) : []),
    [chat, filters],
  )
  const filteredIds = useMemo(() => media.map((m) => m.id), [media])
  // Looked up in the *whole* media list, not the filtered one. The selection is
  // the user's; a filter narrowed while the panel is open (typing in the search
  // box, say) must not silently yank the item they are reading out from under
  // them — and looking it up in the filtered set only *hid* the panel anyway,
  // since activeMediaId stayed set and the panel sprang back when the filter was
  // relaxed. Out-of-set is a state the panel already renders honestly: the
  // position indicator reads "— of M" and Next drops back into the filtered set.
  const activeItem = useMemo(
    () => (chat && activeMediaId ? chat.parsed.media.find((m) => m.id === activeMediaId) : undefined),
    [chat, activeMediaId],
  )

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

  if (!chat) {
    return (
      <ImportScreen
        onOpen={adoptImportedChat}
        notice={
          restoreTimedOut
            ? 'The chat you had open could not be loaded — browser storage did not respond. Closing any other tabs of this app and reloading usually clears it; otherwise import the export again.'
            : undefined
        }
      />
    )
  }

  return (
    <>
      {/* Rendered over the reader (fixed, full-screen) rather than instead of
          it, so cancelling restores the loaded chat with its scroll position,
          filters and selection intact — no re-import, no re-read of IndexedDB.
          The reader goes `inert` meanwhile: it is still there, but Tab must not
          walk into a screen the user cannot see. */}
      {importing && <ImportScreen onOpen={adoptImportedChat} onCancel={cancelImport} />}
      <div className="app-shell" inert={importing}>
        <AppHeader title={chat.title} parsed={chat.parsed} onImport={() => setImporting(true)} />
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
              allMedia={chat.parsed.media}
              filteredIds={filteredIds}
              meParticipant={chat.meParticipant}
              storageRef={chat.storageRef}
            />
          )}
        </div>
      </div>
    </>
  )
}
