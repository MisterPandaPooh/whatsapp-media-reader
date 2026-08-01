// A demo chat, entirely invented: made-up people, a written-out conversation,
// and photos pulled from Lorem Picsum (which serves Unsplash-licensed images, so
// the screenshots in the README are free to redistribute). Paste this whole file
// into the DevTools console on a running dev server and reload — the app comes
// up with a populated library, no export required.
//
// It writes straight to OPFS and IndexedDB in the same shape the import worker
// would, which is also what scripts/screenshot.mjs uses to produce the images in
// the README. Nothing here touches a real chat.
//
// Photo seeds are fixed, so the same run always produces the same library. With
// no network it falls back to drawing gradients, and everything still works.
//
// To clear it again: Application → Storage → Clear site data.
(async () => {
  const FOLDER = 'demo-chat'
  const root = await navigator.storage.getDirectory()
  try { await root.removeEntry(FOLDER, { recursive: true }) } catch {}
  const dir = await root.getDirectoryHandle(FOLDER, { create: true })

  const NINA = 'Nina Duval'
  const AMIT = 'Amit Bar Lev'
  const CHLOE = 'Chloé Marchand'
  const ME = 'You'

  // day = index from the first morning; photo = Lorem Picsum seed.
  //
  // The seed strings are just hash inputs — Picsum returns an arbitrary photo per
  // seed, not one matching the words. Each caption here was written *after*
  // looking at the photo its seed actually returns, so the library reads as one
  // coherent trip instead of a bag of stock images. Change a seed and the caption
  // above it will very likely stop making sense.
  const SCRIPT = [
    { d: 0, t: '07:58', s: NINA, text: 'Landed. Fog like soup — I cannot see the end of the runway.' },
    { d: 0, t: '08:31', s: NINA, photo: 'lisbon-taxi-window', cap: 'the drive in, fog the whole way' },
    { d: 0, t: '08:33', s: AMIT, text: 'we are an hour behind you, do not start without us' },
    { d: 0, t: '10:15', s: ME, photo: 'hotel-cat', cap: 'the bridge has completely vanished' },
    { d: 0, t: '10:16', s: CHLOE, text: 'ok that one is going on the wall' },
    { d: 0, t: '12:40', s: CHLOE, photo: 'lisbon-rooftops', cap: 'pastéis, first thing, obviously' },
    { d: 0, t: '19:05', s: AMIT, photo: 'bakery-counter', cap: 'walked the wrong way for an hour, worth it' },
    { d: 0, t: '21:20', s: NINA, photo: 'blue-door', cap: 'six of us, one pot of tea, no decisions' },

    { d: 1, t: '08:05', s: ME, doc: 'Lisbon itinerary (final).pdf', cap: 'everything in one file, stop asking me' },
    { d: 1, t: '08:06', s: AMIT, text: 'nobody is going to read this' },
    { d: 1, t: '08:07', s: CHLOE, text: 'I read it' },
    { d: 1, t: '09:44', s: CHLOE, photo: 'miradouro-view', cap: 'the street we kept getting lost on' },
    { d: 1, t: '11:12', s: NINA, photo: 'tram-waiting', cap: '50 cents to look at more fog' },
    { d: 1, t: '14:26', s: AMIT, photo: 'alfama', cap: 'the whole city from up there' },
    { d: 1, t: '16:03', s: ME, photo: 'dinner-table', cap: 'the concrete thing everyone photographs' },
    { d: 1, t: '18:41', s: NINA, video: 'VID-20260513-WA0011.mp4', cap: 'the whole square started singing' },
    { d: 1, t: '20:15', s: CHLOE, photo: 'sardines', cap: 'the good coffee. the other place is a trap.' },

    { d: 2, t: '07:12', s: AMIT, photo: 'sunrise-balcony', cap: 'nobody else awake' },
    { d: 2, t: '09:30', s: ME, photo: 'cliff-path', cap: 'the wall everyone poses against' },
    { d: 2, t: '09:31', s: NINA, text: 'we now have four photographs of this wall' },
    { d: 2, t: '13:55', s: CHLOE, photo: 'castle-walls', cap: 'the island, from the ferry' },
    { d: 2, t: '14:02', s: AMIT, text: 'I have the same shot from the other side' },
    { d: 2, t: '17:48', s: NINA, photo: 'beach-empty', cap: 'we walked 22km and I feel every one' },
    { d: 2, t: '22:10', s: ME, voice: 'PTT-20260514-WA0018.opus' },
    { d: 2, t: '22:12', s: CHLOE, text: 'a four minute voice note. incredible.' },

    { d: 3, t: '10:20', s: CHLOE, photo: 'narrow-street', cap: 'she stood there for a full minute' },
    { d: 3, t: '11:05', s: NINA, photo: 'evening-light-street', cap: 'storm coming in over the hills' },
    { d: 3, t: '13:30', s: AMIT, link: 'https://example.com/the-blue-door-guesthouse', cap: 'found the place for next time' },
    { d: 3, t: '15:12', s: ME, photo: 'river-blue-hour', cap: 'the chapel at the top, closed of course' },
    { d: 3, t: '19:55', s: NINA, photo: 'last-dinner', cap: 'under the pier at high tide' },
    { d: 3, t: '20:02', s: AMIT, text: 'this is the one. frame this one.' },

    { d: 4, t: '08:44', s: ME, photo: 'train-window', cap: 'from the train window' },
    { d: 4, t: '12:18', s: CHLOE, photo: 'tiled-facade', cap: 'a photo of Amit taking a photo' },
    { d: 4, t: '12:20', s: AMIT, text: 'delete that immediately' },
    { d: 4, t: '16:30', s: NINA, missingPhoto: 'IMG-20260516-WA0031.jpg', cap: 'this one never made it into the export' },
    { d: 4, t: '18:22', s: ME, photo: 'rooftop-second-try', cap: 'rooftop, second attempt' },
    { d: 4, t: '21:40', s: CHLOE, text: 'last night and we are still arguing about dinner' },

    { d: 5, t: '06:50', s: NINA, photo: 'last-morning', cap: 'last coffee before the airport' },
    { d: 5, t: '07:30', s: AMIT, text: 'same time next year then' },
    { d: 5, t: '07:31', s: CHLOE, text: 'booking it now before anyone talks themselves out of it' },
  ]

  // ---- media generation -----------------------------------------------------

  const PALETTES = [
    ['#f8b95c', '#e2604a', '#7a2c46'], ['#6fc2b8', '#2b7a9b', '#173a5e'],
    ['#a8d98a', '#3f9a63', '#17492f'], ['#9fd4f0', '#3f7fc4', '#1b2f6b'],
    ['#ffd5a3', '#e07a5f', '#3d405b'], ['#c9a8e8', '#7857c4', '#31215e'],
  ]

  // Offline fallback, so the seed still produces a usable library with no network.
  function drawn(i, w, h) {
    const c = new OffscreenCanvas(w, h)
    const g = c.getContext('2d')
    const p = PALETTES[i % PALETTES.length]
    const grad = g.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, p[0]); grad.addColorStop(0.55, p[1]); grad.addColorStop(1, p[2])
    g.fillStyle = grad; g.fillRect(0, 0, w, h)
    g.beginPath(); g.arc(w * 0.3, h * 0.3, w * 0.1, 0, 7)
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill()
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }

  let online = 0, offline = 0
  async function photoBlob(seed, i) {
    try {
      const r = await fetch(`https://picsum.photos/seed/${seed}/900/1200`, { cache: 'force-cache' })
      if (!r.ok) throw new Error(r.status)
      online++
      return await r.blob()
    } catch {
      offline++
      return drawn(i, 900, 1200)
    }
  }

  async function write(name, blob) {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(blob); await w.close()
    return blob.size
  }

  // ---- build the chat -------------------------------------------------------

  const day = 24 * 3600 * 1000
  const start = Date.UTC(2026, 4, 12) // 12 May 2026
  const messages = [], media = [], starred = {}
  const STARRED_CAPS = new Set([
    'nobody else awake', 'the island, from the ferry',
    'under the pier at high tide', 'last coffee before the airport',
  ])

  messages.push({
    id: 'm-sys', sender: '', timestampMs: start + 6 * 3600 * 1000,
    text: 'Messages and calls are end-to-end encrypted.', isSystemMessage: true,
  })

  for (let i = 0; i < SCRIPT.length; i++) {
    const e = SCRIPT[i]
    const [hh, mm] = e.t.split(':').map(Number)
    const ts = start + e.d * day + (hh * 60 + mm) * 60 * 1000
    const mid = `m-${i}`

    if (!e.photo && !e.video && !e.voice && !e.doc && !e.link && !e.missingPhoto) {
      messages.push({ id: mid, sender: e.s, timestampMs: ts, text: e.text, isSystemMessage: false })
      continue
    }

    const n = String(1000 + i).slice(1)
    let kind = 'photo', filename, size = 0, missing = false, durationSec

    if (e.photo) {
      filename = `IMG-2026051${e.d + 2}-WA0${n}.jpg`
      size = await write(filename, await photoBlob(e.photo, i))
    } else if (e.video) {
      // No video file: an export that was trimmed is a real case, and the tile
      // says so rather than pretending.
      kind = 'video'; filename = e.video; size = 8_412_000; missing = true
    } else if (e.voice) {
      kind = 'voice'; filename = e.voice; size = 214_000; durationSec = 247
    } else if (e.doc) {
      kind = 'doc'; filename = e.doc; size = 148_000
    } else if (e.link) {
      kind = 'link'; filename = e.link
    } else {
      filename = e.missingPhoto; missing = true
    }

    const caption = e.cap || ''
    messages.push({ id: mid, sender: e.s, timestampMs: ts, text: caption, mediaId: `x-${i}`, isSystemMessage: false })
    const item = {
      id: `x-${i}`, kind, filename, size, caption, sender: e.s, timestampMs: ts,
      anchorMessageId: mid, starred: STARRED_CAPS.has(caption), missing, durationSec,
    }
    if (item.starred) starred[item.id] = true
    media.push(item)
  }

  media.sort((a, b) => b.timestampMs - a.timestampMs)
  messages.sort((a, b) => a.timestampMs - b.timestampMs)

  const chat = {
    chatId: 'demo', title: 'Lisbon, May 2026', importedAtMs: Date.now(),
    storageRef: { kind: 'opfs', folder: FOLDER },
    meParticipant: ME,
    parsed: { messages, media, participants: [NINA, AMIT, CHLOE, ME] },
    starred, parserVersion: 3,
  }

  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('whatsapp-media-reader', 1)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'chatId' })
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' })
    }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['chats', 'meta'], 'readwrite')
    tx.objectStore('chats').put(chat)
    tx.objectStore('meta').put({ key: 'lastChatId', value: 'demo' })
    tx.oncomplete = res; tx.onerror = () => rej(tx.error)
  })
  return `seeded ${media.length} media, ${messages.length} messages (${online} fetched, ${offline} drawn)`
})()
