// src/App.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImportScreen } from './components/ImportScreen/ImportScreen'
import { AppHeader } from './components/Header/AppHeader'
import { Toolbar } from './components/Toolbar/Toolbar'
import { MediaGrid } from './components/Grid/MediaGrid'
import { DetailPanel } from './components/Panel/DetailPanel'
import { MediaLightbox } from './components/Gallery/MediaLightbox'
import { galleryItems } from './components/Gallery/galleryItems'
import { useChatStore } from './store/useChatStore'
import { filteredMedia } from './store/selectors'
import { deleteChat, forgetChat, loadLastChat } from './storage/chatRepository'
import { needsReparse, reparseChat } from './storage/reparseChat'
import {
  formatBytes,
  requestPersistence,
  storageEstimate,
  sweepOrphanedStorage,
  type StorageUsage,
} from './storage/originStorage'
import {
  discardStorage,
  ensurePermission,
  hasPermission,
  isStorageReachable,
} from './storage/fileAccess'
import type { StoredChat } from './types'
import './App.css'

// The origin private file system is the one hard requirement: it is where a
// dropped .zip is unpacked and where every thumbnail is read back from. A zip
// needs nothing else — the file arrives through a plain <input type="file"> or a
// drop event, both of which every browser has had for a decade.
//
// The File System Access *pickers* are a separate spec, and only the unzipped-
// folder import depends on them. Requiring them here too used to shut Safari and
// Firefox out of the app entirely, including the zip path — which is the path
// almost everyone takes, since WhatsApp hands you a .zip. Verified against
// WebKit: no pickers, but OPFS create/write/stream/iterate/remove all behave
// exactly as they do in Chromium, on the main thread and inside a worker.
const SUPPORTED = typeof window !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'

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
  // A restored chat whose stored parse predates the current parser and is being
  // re-derived from its transcript before it is shown. Held out of `chat` on
  // purpose: rendering the stale parse first and swapping it under the user is
  // exactly the flash of wrong content the restore gate above avoids.
  const [upgrading, setUpgrading] = useState<StoredChat | null>(null)
  // "Import chat…" pressed while a chat is loaded. The import screen goes over
  // the reader, which stays mounted underneath so cancelling is free.
  const [importing, setImporting] = useState(false)
  // Whether the fullscreen gallery is up. Declared here with the other overlay
  // state because the Escape effect below reads it — the gallery, the import
  // screen and the panel all answer to the same key, and only one of them may.
  const [galleryOpen, setGalleryOpen] = useState(false)
  // "Close chat" pressed. Confirmed rather than immediate: it throws away the
  // stars, and for a zip import the unpacked media too — neither of which can
  // be got back without importing the export again.
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  // What this origin costs, for the header's storage button and its card.
  // Null until the first reading lands, and on any browser that will not say.
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [storageOpen, setStorageOpen] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [sweptMessage, setSweptMessage] = useState<string | null>(null)

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
          if (reachable) {
            if (needsReparse(stored)) setUpgrading(stored)
            else setChat(stored)
          }
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

  // Re-parse a restored chat written by an older parser. Deliberately outside
  // the restore effect and its timeout: this reads the whole export folder, so
  // it can legitimately take longer than a database read, and being cut off
  // would throw away a chat that is merely slow to upgrade. A failure here is
  // not fatal — the stored parse is opened as-is, and the next load tries again.
  useEffect(() => {
    if (!upgrading) return
    let cancelled = false
    void reparseChat(upgrading).then(
      (next) => {
        if (cancelled) return
        setChat(next)
        setUpgrading(null)
      },
      () => {
        if (cancelled) return
        setChat(upgrading)
        setUpgrading(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [upgrading, setChat])

  /**
   * Reclaim what nothing points at, ask not to be evicted, and read the meter.
   *
   * Deliberately after the restore effect rather than inside it: the sweep walks
   * OPFS and the restore is what puts the first screen up, so making the page
   * wait on it would trade a visible delay for storage nobody was asking about
   * yet. Runs once per load, and never blocks anything.
   */
  useEffect(() => {
    if (!SUPPORTED) return
    let cancelled = false
    void (async () => {
      await sweepOrphanedStorage()
      // Only worth asking once there is something to protect: a fresh visitor
      // with an empty origin has nothing that eviction could take.
      if (useChatStore.getState().chat) void requestPersistence()
      const reading = await storageEstimate()
      if (!cancelled) setUsage(reading)
    })()
    return () => {
      cancelled = true
    }
  }, [chat])

  async function freeUpSpace() {
    if (sweeping) return
    setSweeping(true)
    setSweptMessage(null)
    const { removed, bytesFreed } = await sweepOrphanedStorage()
    const reading = await storageEstimate()
    setUsage(reading)
    setSweeping(false)
    setSweptMessage(
      removed.length === 0
        ? 'Nothing to reclaim — every byte here belongs to the chat you have open.'
        : `Removed ${removed.length} abandoned import${removed.length === 1 ? '' : 's'}${
            bytesFreed > 0 ? `, reclaiming ${formatBytes(bytesFreed)}` : ''
          }.`,
    )
  }

  // Escape backs out of the close confirmation, the conventional gesture for a
  // modal. preventDefault marks the key as consumed so the panel's own handler
  // — which honours defaultPrevented — leaves the selection alone.
  useEffect(() => {
    if (!closing && !storageOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      setClosing(false)
      setStorageOpen(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [closing, storageOpen])

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
    //
    // The gallery is the same story: it closes itself on Escape, and the panel
    // is what the reader lands back on. Without this guard one Escape would
    // dismiss the gallery *and* the panel behind it, so a double-click into
    // fullscreen and a press of Escape would leave the reader with nothing
    // selected at all.
    if (!activeMediaId || importing || galleryOpen || closing || storageOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const tag = (e.target as HTMLElement | null)?.tagName
      // Escape in a text field belongs to the field (clearing the search box).
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      closePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeMediaId, importing, galleryOpen, closing, storageOpen, closePanel])

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
    if (needsReparse(pending)) setUpgrading(pending)
    else setChat(pending)
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

  /**
   * Drop the loaded chat and go back to the import screen. The IndexedDB record
   * and `lastChatId` go together so a reload really does land on the drop zone,
   * and the OPFS copy goes with them — leaving it behind would keep a full
   * duplicate of the export in origin storage that nothing can ever reach
   * again. A folder-backed chat's own folder is untouched: it is the user's,
   * and we only ever had read permission on it.
   */
  async function closeChat() {
    const current = useChatStore.getState().chat
    if (!current) return
    setCloseError(null)
    try {
      await forgetChat(current.chatId)
    } catch (err) {
      // Stop rather than pretend: the UI would show the import screen while a
      // reload brought the chat straight back.
      setCloseError(
        `Could not close this chat: ${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }
    // Best-effort, and only after the record is gone: media with no record is
    // merely wasted space, whereas a record whose media has been deleted is a
    // library of broken tiles.
    void discardStorage(current.storageRef)
    setGalleryOpen(false)
    setClosing(false)
    setChat(null)
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
  //
  // The gallery walks the same filtered set the panel's prev/next does, minus
  // the kinds it cannot show. Kept separate from `media` so a document sitting
  // between two photos does not silently shift the gallery's indices.
  const gallery = useMemo(() => galleryItems(media), [media])

  // Double-click anywhere a photo or video is shown — a grid tile, a preview in
  // the thread — opens it fullscreen. Silently ignores an item the gallery has
  // no slide for, which is the same rule that hides the panel's own fullscreen
  // button: the gallery walks the filtered set, and an item outside it has no
  // position to open at.
  const openFullscreen = useCallback(
    (id: string) => {
      if (!gallery.some((m) => m.id === id)) return
      openMedia(id)
      setGalleryOpen(true)
    },
    [gallery, openMedia],
  )

  const activeItem = useMemo(
    () => (chat && activeMediaId ? chat.parsed.media.find((m) => m.id === activeMediaId) : undefined),
    [chat, activeMediaId],
  )

  if (!SUPPORTED) {
    return (
      <div className="unsupported">
        <div className="unsupported-title">This browser can’t store the export</div>
        <p>
          The reader unpacks your chat into the origin private file system, a private area this
          browser doesn’t provide. Chrome, Edge, Brave, Arc, Opera, Safari 15.2+ and Firefox 111+
          all do. Nothing is ever uploaded, which is precisely why it needs somewhere local to put
          the files.
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

  if (upgrading) {
    return (
      <div className="import-overlay">
        <div className="import-card summary-card">
          <div className="import-title">Updating “{upgrading.title}”</div>
          <div className="import-sub">
            This chat was read by an earlier version of the parser, which split some messages in
            the wrong place and credited a few attachments to the wrong person. It is being read
            again from the transcript in your export — no files are copied and nothing is uploaded.
          </div>
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
      {storageOpen && (
        <div className="import-overlay">
          <div className="import-card summary-card">
            <div className="import-title">Browser storage</div>
            <div className="import-sub">
              {usage
                ? `${formatBytes(usage.usage)} used${usage.quota > 0 ? ` of ${formatBytes(usage.quota)} available` : ''}.`
                : 'This browser will not report how much it is using.'}{' '}
              {chat.storageRef.kind === 'opfs'
                ? 'A .zip is unpacked here, so this chat is a second copy. Importing the unzipped folder instead uses none.'
                : 'This chat is read from your own folder and uses none of it.'}
              {usage && !usage.persisted ? ' The browser may clear this if the disk fills up.' : ''}
            </div>
            <div className="import-sub">
              Only leftovers from unfinished imports are removed. Your open chat stays, and your
              original .zip or folder is never touched.
            </div>
            <div className="import-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void freeUpSpace()}
                disabled={sweeping}
              >
                {sweeping ? 'Checking…' : 'Free up space'}
              </button>
              <button type="button" className="btn-primary" onClick={() => setStorageOpen(false)}>
                Done
              </button>
            </div>
            {sweptMessage && <div className="import-sub import-sub--result">{sweptMessage}</div>}
          </div>
        </div>
      )}
      {closing && (
        <div className="import-overlay">
          <div className="import-card summary-card">
            <div className="import-title">Close “{chat.title}”?</div>
            <div className="import-sub">
              {chat.storageRef.kind === 'opfs'
                ? 'This removes the reader’s copy of the export — the unpacked media in browser storage — along with anything you starred. The .zip you imported is untouched; opening this chat again means importing it again.'
                : 'This removes the reader’s record of the export and anything you starred. The folder on your disk is untouched: opening this chat again means picking that folder again.'}
            </div>
            <div className="import-actions">
              <button type="button" className="btn-primary" onClick={() => void closeChat()}>
                Close chat
              </button>
              {/* Focused rather than the destructive one: a stray Enter must
                  not be what removes the library. */}
              <button
                type="button"
                className="btn-secondary"
                autoFocus
                onClick={() => setClosing(false)}
              >
                Cancel
              </button>
            </div>
            {closeError && (
              <div className="import-error" role="alert">
                {closeError}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="app-shell" inert={importing || closing || storageOpen}>
        <AppHeader
          title={chat.title}
          parsed={chat.parsed}
          storageLabel={usage ? formatBytes(usage.usage) : undefined}
          onOpenStorage={() => {
            setSweptMessage(null)
            setStorageOpen(true)
          }}
          onImport={() => setImporting(true)}
          onClose={() => {
            setCloseError(null)
            setClosing(true)
          }}
        />
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
              onOpenFullscreen={openFullscreen}
            />
          </main>
          {activeItem && (
            <DetailPanel
              activeItem={activeItem}
              messages={chat.parsed.messages}
              allMedia={chat.parsed.media}
              filteredIds={filteredIds}
              onViewFullscreen={
                gallery.some((m) => m.id === activeItem.id) ? () => setGalleryOpen(true) : undefined
              }
              onOpenMediaFullscreen={openFullscreen}
              meParticipant={chat.meParticipant}
              storageRef={chat.storageRef}
            />
          )}
        </div>
      </div>
      {galleryOpen && activeItem && (
        <MediaLightbox
          items={gallery}
          index={Math.max(
            0,
            gallery.findIndex((m) => m.id === activeItem.id),
          )}
          storageRef={chat.storageRef}
          onClose={() => setGalleryOpen(false)}
          // Leaves the grid and panel on whatever the reader ended up looking
          // at, rather than snapping back to where the gallery was opened.
          onIndexChange={openMedia}
        />
      )}
    </>
  )
}
