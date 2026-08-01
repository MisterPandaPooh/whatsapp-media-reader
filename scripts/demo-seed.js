// A demo chat, entirely invented: made-up people, made-up captions, and
// thumbnails drawn on a canvas. Paste this whole file into the DevTools console
// on a running dev server and reload — the app comes up with a populated
// library, no export required.
//
// It writes straight to OPFS and IndexedDB in the same shape the import worker
// would, which is also what scripts/screenshot.mjs uses to produce the images
// in the README. Nothing here touches a real chat.
//
// To clear it again: Application → Storage → Clear site data.
(async () => {
  const FOLDER = 'demo-chat'
  const root = await navigator.storage.getDirectory()
  try { await root.removeEntry(FOLDER, { recursive: true }) } catch {}
  const dir = await root.getDirectoryHandle(FOLDER, { create: true })

  const PALETTES = [
    ['#f8b95c', '#e2604a', '#7a2c46'], ['#6fc2b8', '#2b7a9b', '#173a5e'],
    ['#f5d67c', '#e08a4c', '#8c4a2f'], ['#c9a8e8', '#7857c4', '#31215e'],
    ['#a8d98a', '#3f9a63', '#17492f'], ['#f7a8b8', '#d1466e', '#6b1b3a'],
    ['#9fd4f0', '#3f7fc4', '#1b2f6b'], ['#ffd5a3', '#e07a5f', '#3d405b'],
    ['#b8e0d2', '#4a9d8f', '#22503f'], ['#e8c8a0', '#b07d4f', '#5c3a24'],
    ['#d7e8a0', '#8ab04a', '#3e5220'], ['#f0b5d0', '#a8508a', '#4a1f47'],
    ['#ffe0b0', '#f08a3c', '#7a3312'], ['#bcd6f5', '#5a6fc0', '#242a5c'],
  ]

  function paint(g, i, w, h, t) {
    const p = PALETTES[i % PALETTES.length]
    const grad = g.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, p[0]); grad.addColorStop(0.55, p[1]); grad.addColorStop(1, p[2])
    g.fillStyle = grad; g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(255,255,255,0.16)'
    g.fillRect(0, h * (0.55 + 0.07 * Math.sin(i)), w, h * 0.03)
    g.beginPath(); g.arc(w * (0.2 + 0.12 * ((i % 5) / 5)), h * 0.3, w * 0.09, 0, 7)
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill()
    for (let k = 0; k < 3; k++) {
      g.beginPath(); g.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) {
        g.lineTo(x, h * (0.72 + 0.06 * k) + Math.sin((x / w) * 6 + i + k * 2 + t) * h * 0.06)
      }
      g.lineTo(w, h); g.closePath()
      g.fillStyle = `rgba(0,0,0,${0.10 + k * 0.10})`; g.fill()
    }
  }

  function shot(i, w, h) {
    const c = new OffscreenCanvas(w, h)
    paint(c.getContext('2d'), i, w, h, 0)
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  }

  async function write(name, blob) {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(blob); await w.close()
    return blob.size
  }

  const PEOPLE = ['Nina Duval', 'Amit Bar Lev', 'Chloé Marchand', 'You']
  const CAPTIONS = [
    'sunrise from the balcony', 'we made it to the top', 'last night’s dinner',
    'the whole crew', 'the street we kept getting lost on', 'view from the ferry',
    'best coffee of the trip', 'storm rolling in', 'the little blue door',
    'golden hour again', 'market haul', 'nobody else on the beach',
    'she insisted on this one', 'the long way home', 'day two, still raining',
    'hotel cat', 'from the train window', 'that ridiculous dessert',
    'tiles all the way up', 'waiting for the tram', 'someone’s laundry, 4th floor',
    'the good bakery', 'sardines, obviously', 'castle at closing time',
    'blue hour over the river', 'we walked 22km today', 'rooftop, second attempt',
    'last morning', 'the miradouro everyone means', 'still thinking about this plate',
  ]
  const REPLIES = [
    'ok that one is going on the wall', 'wait send me the full size', 'hahaha',
    'I have the same shot from the other side', 'this is the one',
    'how is this the same trip', 'framing this', 'my feet hurt just looking at it',
  ]

  const day = 24 * 3600 * 1000
  const base = Date.UTC(2026, 4, 12, 8, 30) // 12 May 2026
  const messages = [], media = [], starred = {}

  messages.push({
    id: 'm-sys', sender: '', timestampMs: base - 3600 * 1000,
    text: 'Messages and calls are end-to-end encrypted.', isSystemMessage: true,
  })

  // 30 slots: mostly photos, one doc, one voice note, one link card, and two
  // attachments the export left out (a video and a photo).
  const PLAN = {}
  PLAN[11] = 'doc'; PLAN[23] = 'voice'; PLAN[16] = 'link'
  PLAN[6] = 'video-missing'; PLAN[27] = 'missing'

  for (let i = 0; i < 30; i++) {
    const sender = PEOPLE[i % PEOPLE.length]
    const ts = base + Math.floor(i / 3) * day + (i % 3) * 14400 * 1000
    const mid = `m-${i}`
    const slot = PLAN[i] || 'photo'
    const kind = slot === 'missing' ? 'photo' : slot === 'video-missing' ? 'video' : slot
    const missing = slot === 'missing' || slot === 'video-missing'
    let filename, size = 0, durationSec

    if (slot === 'photo' || slot === 'missing') {
      filename = `IMG-20260512-WA${String(1000 + i).slice(1)}.jpg`
      if (!missing) size = await write(filename, await shot(i, 900, 1200))
    } else if (slot === 'video-missing') {
      filename = `VID-20260512-WA${String(1000 + i).slice(1)}.mp4`
      size = 8_400_000
    } else if (slot === 'voice') {
      filename = `PTT-20260512-WA${String(1000 + i).slice(1)}.opus`
      size = 214_000; durationSec = 37
    } else if (slot === 'doc') {
      filename = 'Lisbon itinerary (final).pdf'; size = 148_000
    } else {
      filename = 'https://example.com/the-blue-door-guesthouse'
    }

    const caption =
      slot === 'link' ? 'found the place for next time'
      : slot === 'doc' ? 'everything in one file'
      : slot === 'voice' ? '' : CAPTIONS[i % CAPTIONS.length]

    messages.push({ id: mid, sender, timestampMs: ts, text: caption, mediaId: `x-${i}`, isSystemMessage: false })
    if (i % 3 === 1) {
      messages.push({
        id: `t-${i}`, sender: PEOPLE[(i + 2) % PEOPLE.length], timestampMs: ts + 90_000,
        text: REPLIES[i % REPLIES.length], isSystemMessage: false,
      })
    }
    const item = {
      id: `x-${i}`, kind, filename, size, caption, sender, timestampMs: ts,
      anchorMessageId: mid, starred: i % 8 === 3, missing, durationSec,
    }
    if (item.starred) starred[item.id] = true
    media.push(item)
  }

  media.sort((a, b) => b.timestampMs - a.timestampMs)
  messages.sort((a, b) => a.timestampMs - b.timestampMs)

  const chat = {
    chatId: 'demo', title: 'Lisbon, May 2026', importedAtMs: Date.now(),
    storageRef: { kind: 'opfs', folder: FOLDER },
    meParticipant: 'You',
    parsed: { messages, media, participants: PEOPLE },
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
  return `seeded ${media.length} media, ${messages.length} messages`
})()
