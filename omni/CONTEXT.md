# Omni — Developer Context

Use this file as context when working in VS Code (or with any AI assistant).
It covers architecture decisions, data flows, module contracts, known constraints,
and the reasoning behind non-obvious code choices.

---

## What This Project Is

A 1-on-1 browser-based encrypted video/audio call app with P2P file transfer,
chat, screen sharing, and typing indicators. No user accounts. No data stored
anywhere. Two people open the site, one creates a room, shares a 4–10 character
code, the other joins, and a direct encrypted connection is established.

**Core trust model:** The server is architecturally incapable of reading your data.
It only ever sees room codes and opaque WebRTC handshake blobs (SDP/ICE).

---

## Hosting Architecture

```
GitHub Pages                Render (free tier)           Internet
─────────────               ──────────────────           ───────
/                           server/                      Google STUN
  index.html                  index.js                   Metered.ca TURN
  css/styles.css            (WebSocket signaling only)
  js/*.js
  (static, no build step)
```

- **GitHub Pages** serves the static frontend. Auto-deploys on push to `main`
  via `.github/workflows/deploy.yml`. No build step — pure ES modules.
- **Render free tier** runs the signaling server. Spins down after 15 min
  inactivity. A cron job hits `/health` every 14 min to keep it alive.
- **Google STUN** (`stun.l.google.com:19302`) — free, helps peers discover
  their public IP. No data flows through it.
- **Metered.ca TURN** — relay fallback for ~15% of connections behind strict
  NAT. Data flows through it but is DTLS-encrypted before it arrives.
- **WebRTC P2P** — all actual audio, video, chat, and file data travels
  directly between browsers once connected. Server is out of the loop.

---

## File Structure

```
omni/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages deploy on push to main
├── server/
│   ├── index.js                # Entire signaling server (~210 lines)
│   ├── package.json            # Only dependency: ws
│   ├── Dockerfile
│   └── render.yaml             # Render deployment blueprint
├── tests/
│   ├── package.json            # Test runner config (node:test)
│   ├── crypto.test.js          # 18 tests — key gen, encrypt/decrypt, SHA-256
│   ├── server.test.js          # 17 tests — room lifecycle, rejoin, sanitisation
│   ├── integration.test.js     # 7 tests — full signaling flow (parallel peers)
│   ├── quality.test.js         # 17 tests — getQualityLevel thresholds
│   ├── filequeue.test.js       # 7 tests — sequential queue processing
│   ├── e2e.test.js             # 19 tests — incremental hash, file transfer, glare, server hardening
│   ├── features.test.js        # 13 tests — SAS, room password, multiplexed files, QR generator
│   └── i18n.test.js            # 21 tests — translation completeness, placeholders, HTML key contract
├── index.html                  # App UI — 3 screens + CSP + <base href="/omni/"> + PWA meta
├── manifest.json               # PWA manifest (standalone, portrait, scope "./")
├── sw.js                       # Service worker (network-first, same-origin only, /omni scope)
├── css/
│   └── styles.css              # Dual-theme (dark orange / light green), PWA-native
├── js/
│   ├── config.js               # ← EDIT THIS: signaling URL + Metered credentials
│   ├── app.js                  # UI state machine — orchestrates everything
│   ├── boot.js                 # Theme toggle + service-worker registration (CSP-safe, was inline)
│   ├── signaling.js            # WebSocket client with reconnection + 30s timeout
│   ├── webrtc.js               # RTCPeerConnection + DataChannel + perfect negotiation + ICE restart
│   ├── crypto.js               # ECDH + AES-GCM + SHA-256 + IncrementalSHA256 + safetyString (Web Crypto API)
│   ├── recorder.js             # CallRecorder — canvas compositor + mixed audio → local .webm
│   ├── qrcode.js               # Vendored byte-mode QR generator (share-link QR, CSP-safe)
│   ├── i18n.js                 # Translations (en/es/fr/de/hi) + t() / applyTranslations()
│   └── sounds.js               # Web Audio API notification tones + quality calc
├── CONTEXT.md                  # This file
└── README.md
```

---

## Module Contracts

### `config.js`
The only file users need to edit after deployment.

```js
CONFIG.SIGNALING_URL   // wss://your-app.onrender.com
CONFIG.ICE_SERVERS     // Array of RTCIceServer — STUN + TURN entries
```

### `crypto.js`
Pure functions. No state. No side effects. All async (Web Crypto API).

| Export | Input | Output | Notes |
|---|---|---|---|
| `generateKeyPair()` | — | `CryptoKeyPair` | ECDH P-256, extractable |
| `exportPublicKey(kp)` | `CryptoKeyPair` | `string` (base64) | Safe to transmit |
| `importPublicKey(b64)` | `string` | `CryptoKey` | Peer's public key |
| `deriveSharedKey(priv, pub, pass?)` | two `CryptoKey`s, optional `string` | `CryptoKey` (AES-GCM 256) | ECDH → HKDF → AES; `pass` folded into HKDF info |
| `encrypt(key, data)` | `CryptoKey`, `string\|Uint8Array` | `Uint8Array` | `[12B IV][ciphertext][16B tag]` |
| `decrypt(key, data)` | `CryptoKey`, `Uint8Array` | `ArrayBuffer` | Throws on auth failure |
| `sha256(data)` | `string\|ArrayBuffer` | `string` (hex) | For file integrity |
| `safetyString(pubA, pubB)` | two base64 pubkeys | `{ emoji, code }` | Order-independent SAS (MITM check) |
| `IncrementalSHA256` | — (class) | `.update(bytes)` → `.digest()` (hex) | Streaming hash, O(1) RAM for large files |
| `uint8ToBase64(bytes)` | `Uint8Array` | `string` | |
| `base64ToUint8(b64)` | `string` | `Uint8Array` | |

**Key derivation chain:**
```
ECDH(ourPrivate, theirPublic)
  → 256 bits shared secret
  → HKDF(SHA-256, salt=32×0x00, info="project-a-v1"[ + "\x00" + roomPassword ])
  → AES-GCM-256 key
```
Both peers independently derive the same key. The server never sees any key
material. When an optional room password is supplied it is appended to the HKDF
`info`, so peers with different passwords derive different keys (the encrypted
layer then fails — surfaced by the `__verify` handshake in `app.js`). With no
password the derivation is byte-identical to before (backward compatible).

### `signaling.js` — `SignalingClient extends EventTarget`

**State fields (set by `app.js`):**
```js
signaling.phase     // 'idle' | 'lobby' | 'call'
signaling.roomCode  // current room code (string)
signaling.role      // 'creator' | 'joiner'
```

**Methods:**
```js
await signaling.connect()       // Initial WS connection (30s timeout)
signaling.createRoom()          // Server responds with 'created' event
signaling.joinRoom(code)        // Server responds with 'joined' or 'error' event
signaling.sendSignal(payload)   // Relay SDP/ICE to other peer
signaling.disconnect()          // Intentional close — suppresses reconnection
```

**Connection timeout:** `connect()` rejects after 30 seconds if the WebSocket
doesn't open. This handles Render cold starts gracefully.

**Events emitted:**
```
created          { code, custom }         Room created
joined           { code }                 Successfully joined room
peer-joined      {}                       Other peer joined our room
peer-left        {}                       Other peer disconnected
signal           { payload }              Incoming SDP/ICE from peer
error            { message }              Server error
rejoined         { code, custom }         Rejoined existing room after reconnect
rejoin-failed    { code }                 Grace window expired, need new room
reconnecting     { attempt, max, delay }  Mid-reconnect (lobby phase only)
reconnect-failed {}                       Gave up after maxAttempts
disconnected     {}                       Intentional close or idle-phase drop
```

**Reconnection behaviour (context-aware):**
- `phase === 'lobby'` → visible reconnect, fires `reconnecting` events, UI updates
- `phase === 'call'`  → silent background reconnect, UI not touched
- `phase === 'idle'`  → fires `disconnected`, no retry

### `webrtc.js` — `PeerConnection extends EventTarget`

**Constructor:**
```js
new PeerConnection(signalingClient, isInitiator, iceServers, passphrase?)
// isInitiator = true for room creator, false for joiner
// passphrase  = optional room password, folded into deriveSharedKey()
```

**Key method:**
```js
await peer.initialize(localStream)
// Sets up RTCPeerConnection, adds media tracks, creates/receives DataChannel.
// Negotiation is driven by onnegotiationneeded (perfect negotiation) — adding
// tracks / creating the DataChannel triggers the first offer automatically.
// Call this after receiving 'peer-joined' (creator) or 'joined' (joiner).
```

**Additional methods:**
```js
await peer.replaceVideoTrack(newTrack)  // Screen sharing: swap video sender's track
await peer.setSendQuality(level)        // Adaptive bitrate: 'good'|'fair'|'poor'
peer.toggleAudio(enabled)               // Mute/unmute mic
peer.toggleVideo(enabled)               // Enable/disable camera
await peer.send(data)                   // Encrypt and send JSON via DataChannel
await peer.sendFile(file, opts?)        // Chunked encrypted send; opts={fileId,startIndex}
peer.hangup()                           // Stop tracks, close PC + DC
```

**Events emitted:**
```
remote-stream         { stream }          Remote MediaStream ready
secure-channel-ready  { safety }          ECDH done, AES key derived; safety = SAS {emoji,code}
connection-state      { state }           RTCPeerConnection state change
ice-state             { state }           ICE connection state change
ice-restarting        {}                  ICE restart triggered (network drop)
data                  { ...inner }        Decrypted DataChannel message
file-chunk            { data }            Raw ArrayBuffer file chunk (binary frame)
file-send-progress    { fileId, name, sent, total } Outgoing file progress
channel-closed        {}                  DataChannel closed
error                 { message }         Any error
```

**DataChannel message types (internal):**
```
pubkey     { key: base64 }         ECDH public key exchange (plaintext, by design)
encrypted  { data: base64 }        AES-GCM encrypted JSON wrapper
binary frame                       [4B fileId LE][4B chunkIndex LE][AES-GCM encrypted chunk]
```

**Encrypted application message types (inside `encrypted` wrapper):**
```
chat       { type:'chat', text }   Chat message
file-meta  { type:'file-meta', fileId, name, size, mimeType, hash, chunks }  File metadata
typing     { type:'typing' }       Typing indicator heartbeat
__verify   { type:'__verify' }     Password-verification ping (app.js)
__verified { type:'__verified' }   Reply proving the AES key matches
```

**Backpressure (Fix 2):**
```
BUFFER_HIGH = 16MB  — pause sendFile loop, await bufferedamountlow
BUFFER_LOW  = 4MB   — resume (bufferedAmountLowThreshold is set to this)
```

**Perfect negotiation (offer/answer):**
- A single `onnegotiationneeded` handler drives every (re)negotiation, including
  the initial offer. SDP travels as a unified `{ type:'description', sdp }` signal
  (there are no separate `offer`/`answer` signal types anymore).
- Roles: initiator = **impolite**, joiner = **polite** (`_polite = !isInitiator`).
- On glare (simultaneous offers): the impolite peer ignores the incoming offer;
  the polite peer accepts it (implicit rollback via `setRemoteDescription`).
- ICE candidates that arrive before the remote description is set are buffered
  in `pendingIce`, then flushed once the remote description is applied.

**ICE restart (network drop):**
- Triggered when `iceConnectionState → 'disconnected'`
- Only the initiator triggers it (prevents restart collision)
- Calls `pc.restartIce()`, which fires `onnegotiationneeded` → fresh offer
- Handles user switching WiFi ↔ cellular mid-call

### `app.js`
Orchestrates UI state machine and wires all events together.

**Screens:** `home` → `lobby` → `call`

**In-call features:**
- Screen sharing (via `getDisplayMedia()` + `replaceTrack()`)
- Call timer (starts on `secure-channel-ready` or ICE connected, formats as MM:SS or H:MM:SS)
- Typing indicator (debounced `{ type:'typing' }` messages, 3s auto-hide)
- Picture-in-Picture (auto-enters when tab hidden, exits when visible; manual button fallback)
- Flip camera (front/back toggle via `facingMode`)
- Connection quality badge (polls `getStats()` every 2s — good/fair/poor)
- Adaptive bitrate — quality changes drive `peer.setSendQuality()` (caps bitrate + scales resolution)
- Draggable local video (pointer events + corner snapping)
- Multi-file queue — parallel/multiplexed sends, each file its own `fileId`, demuxed on receive
- Drag-and-drop & clipboard paste to send files (drop overlay on the call screen)
- Image/video preview in chat (inline thumbnails for received media)
- Safety number (SAS) panel — emoji + hex, compared out-of-band to detect a MITM
- Room password — entered on home; `__verify` handshake ends the call on mismatch
- Local recording — `CallRecorder` composites remote+local onto a canvas, mixes audio, saves `.webm` locally
- Mic level meter on the local PiP + "you’re muted" nudge when speaking while muted
- Clear-chat button (chat is never stored; this also clears the on-screen log)
- Lobby share link + QR (`#code` deep link; auto-fills the join box on load; Web Share / clipboard fallback)
- Notification sounds (Web Audio tones on join, message, hangup)

**Progress bar (connecting state):**
- Shown while WebSocket handshake or room creation is in flight
- CSS animation forcibly restarted on each show (handles repeat attempts)
- Disabled buttons prevent double-clicks during connection
- Hidden by: success events, error events, disconnected event, or timeout

**File receive state machine:**
```
Receive file-meta (carries a fileId)
  ↓
Look up / create a per-fileId receive state in the fileReceives Map
  (several transfers can be in flight at once; binary frames carry the fileId)
  ↓
Browser supports showSaveFilePicker?
  ├─ YES → showSaveFilePicker() → FileSystemWritableFileStream
  │         each chunk: writable.write(bytes) + IncrementalSHA256.update(bytes)
  │         nothing retained in RAM → true O(1) streaming hash
  └─ NO  → accumulate chunks[] in memory (fallback)
              warn if file > 500MB
              full SHA-256 at end

On final chunk:
  streaming path → writable.close() → hasher.digest() vs meta.hash → system message
  fallback path  → merge Uint8Array → sha256() vs meta.hash → Blob URL download
```

**signaling.phase transitions:**
```
connectSignaling()     → phase = 'idle'
created event fires    → phase = 'lobby'
startCall() called     → phase = 'call'
hangup() / reset       → signaling.disconnect() (phase = 'idle')
```

**Media acquisition fallback:** `startCall()` requests `{ video, audio }`; if that
fails (no camera / camera busy) it retries `{ video:false, audio:true }` and posts
an "audio only" system message before giving up.

**Single source of truth for events:** the `created` and `error` listeners are
registered once in `connectSignaling()` (no per-click duplicates). The persistent
`created` handler covers both initial creation and the rejoin-failed fallback.

**Theme + service worker** live in `js/boot.js`, loaded as an external script so
the strict CSP needs no `'unsafe-inline'`.

---

## Connection Flow (Full Sequence)

```
Peer A (creator)                  Server                  Peer B (joiner)
─────────────────                 ──────                  ───────────────
connect WebSocket          →
createRoom()               →
                           ←      { type:'created', code:'X7K2PQ' }
[shows lobby screen]

                                                    connect WebSocket  →
                                                    joinRoom('X7K2PQ') →
                           peer-joined →
                           ←      { type:'joined' }                   →
[startCall(isInitiator=true)]                               [startCall(isInitiator=false)]
getUserMedia() (video+audio, audio-only fallback)          getUserMedia() (same)
generateKeyPair()                                           generateKeyPair()
createDataChannel() → onnegotiationneeded                   (waits for ondatachannel)
  setLocalDescription() (implicit offer)
                           relay { description: offer }                →
                                                    setRemoteDescription()
                                                    setLocalDescription() (implicit answer)
                           relay { description: answer } ←
setRemoteDescription()
[ICE candidates exchanged in parallel; glare resolved by polite/impolite roles]

[WebRTC P2P connection established — server is now irrelevant]

DataChannel opens
send({ type:'pubkey', key })  ──────────────────────────────────────→
                              ←──────────────────────────────────────  send({ type:'pubkey', key })
deriveSharedKey()                                           deriveSharedKey()
[Both have identical AES-GCM key — server never saw it]

emit('secure-channel-ready')                                emit('secure-channel-ready')
[🔒 badge activates in UI]                                  [🔒 badge activates in UI]
```

---

## Encryption Layers

```
Application data (chat/file)
  └─ AES-GCM-256 (your key, ECDH-derived)      ← Layer 2: you control this
       └─ DTLS 1.3 (WebRTC transport)           ← Layer 1: browser handles this
            └─ TLS (WSS to Render signaling)    ← Signaling channel only
```

The TURN server (if used) receives DTLS-encrypted packets. It forwards bytes
without decrypting them. It sees ciphertext only.

---

## Security Hardening

Beyond the two encryption layers, the app applies defence-in-depth at the edges:

### Content-Security-Policy
`index.html` ships a strict CSP `<meta>`:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob:; media-src 'self' blob:;
connect-src 'self' wss: ws://localhost:*; base-uri 'self';
object-src 'none'; frame-ancestors 'none'
```
- `script-src 'self'` (no `'unsafe-inline'`) is why the theme/SW bootstrap was
  moved out of an inline `<script>` into `js/boot.js`.
- `connect-src` allows `wss:` (production signaling) and `ws://localhost:*`
  (local dev only).
- `img-src`/`media-src` allow `blob:` for received-file thumbnails and downloads,
  and `data:` for the inline SVG icons.

### Signaling server (server/index.js)
- **Origin allowlist** — `ALLOWED_ORIGINS` (comma-separated env var) is enforced
  via `verifyClient`. If unset, all origins are allowed (dev default); set it in
  production to block cross-site WebSocket hijacking.
- **`maxPayload: 256 KB`** — caps signaling frames (SDP/ICE are far smaller), so an
  oversized message closes the socket with code `1009` instead of buffering
  unbounded memory.

### Client input handling (app.js)
- `escapeHtml()` coerces with `String(...)` before escaping (a non-string peer
  payload can't throw); all rendered peer text goes through it.
- Incoming chat text is capped at 4000 chars.

---

## Binary Frame Format (File Transfer)

Each file chunk sent over the DataChannel as a binary ArrayBuffer:

```
Offset  Size   Content
──────  ────   ───────
0       4B     Chunk index (uint32, little-endian)
4       12B    AES-GCM IV (random, included by encrypt())
16      nB     AES-GCM ciphertext
16+n    16B    AES-GCM authentication tag (appended by SubtleCrypto)
```

The receiver extracts `chunkIndex` from bytes 0–3, then passes bytes 4–end
to `decrypt()`. The IV is the first 12 bytes of the decrypt input.

---

## Known Constraints & Edge Cases

### File System Access API availability
`showSaveFilePicker()` is available in Chrome 86+, Edge 86+.
Not available in Firefox or Safari. The fallback (in-memory accumulation)
is used automatically. For Firefox/Safari users sending files >500MB,
warn them upfront.

### Streaming SHA-256 (IncrementalSHA256)
`crypto.subtle.digest()` needs the whole input at once, so the streaming receive
path uses `IncrementalSHA256` (pure JS, in `crypto.js`). Each chunk is fed to
`.update(bytes)` as it is written to disk and then released — nothing is retained,
so RAM stays O(1) regardless of file size. `.digest()` is called once on the final
chunk and compared against `meta.hash`. The fallback (non-streaming) path still
uses Web Crypto `sha256()` over the in-memory buffer. The class is verified
bit-for-bit against Web Crypto across chunk boundaries in `tests/e2e.test.js`.

### ICE restart is initiator-only
Only the room creator triggers ICE restart on disconnection (via
`pc.restartIce()`), preventing both peers restarting simultaneously. The restart
fires `onnegotiationneeded`, producing a fresh offer that flows through the same
perfect-negotiation path; the polite joiner answers it transparently.

### Room codes expire on server restart
The signaling server stores rooms in a `Map()` (in-memory). A Render deploy
or crash clears all rooms. Peers in an active WebRTC session are unaffected
(signaling is no longer needed). Peers in the lobby will need to create a
new room — the reconnection logic handles this by calling `createRoom()`
again after reconnect, and the UI updates with the new code.

### Server rejoin & grace period
When the creator disconnects from the lobby, the server keeps the room alive
for 90 seconds (`GRACE_MS`). During this window:
- Creator can reconnect and send `{ type: 'rejoin', code }` to reclaim the room
- A joiner can still join the room (they get `joined` but no `peer-joined` yet)
- If a joiner arrived during grace, the `rejoin` response includes an immediate
  `peer-joined` so the creator transitions straight into the call
- If grace expires, server deletes the room; creator's reconnect gets
  `rejoin-failed` and the client transparently creates a fresh room

### Render free tier cold starts
The 14-min cron job prevents spin-down during active use. However, the very
first request after deployment will have a ~30s cold start. The `connect()`
method in `signaling.js` has a 30-second timeout — on cold starts the server
usually wakes in 5–15s, which fits within the timeout. The progress bar on
the home screen keeps the user informed during the wait.

### DataChannel ordered mode
The DataChannel uses `{ ordered: true }`. This means file chunks always
arrive in sequence, which is why the receiver can write them to disk
immediately without re-ordering. If you ever switch to `ordered: false`
for performance, the file receive logic must change to buffer by chunkIndex
before writing.

### No multi-tab support
Opening the same room code in two tabs on the same browser will likely
cause ICE failures due to shared camera/mic state. This is expected behaviour
for a 1-on-1 tool.

### Sub-path deployment (mounted at /omni/)
The app is served from `/omni/` (sibling apps live at the repo root), so it must
not assume it owns the origin root:
- `index.html` sets `<base href="/omni/">` — every relative URL (assets, manifest,
  SW registration) resolves under `/omni/` even without a trailing slash.
- `manifest.json` uses `start_url: "./"` and `scope: "./"` → both resolve to `/omni/`.
- `js/boot.js` registers `sw.js` (relative) → `/omni/sw.js`, scope `/omni/`.
- `sw.js` precaches relative paths (`./`, `./index.html`, …) and only intercepts
  **same-origin** GETs, so it never touches the sibling apps at root.
If you move the app, update the single `<base href>` (and re-confirm the manifest
scope).

---

## Adding Features — Guidelines

### Adding a new DataChannel message type
1. Define the message shape in a comment in `webrtc.js`
2. Add a `case` in `_setupDataChannel` → `channel.onmessage` (if non-encrypted)
3. Or just send via `peer.send({ type: 'yourType', ...data })` (encrypted path)
4. Handle in `app.js` → `handleIncomingData()` switch statement
5. Example: typing indicator uses this exact pattern (`{ type: 'typing' }`)

### Adding a new UI screen
1. Add `<section id="screen-yourscreen" class="screen">` in `index.html`
2. Add to `screens` object in `app.js`
3. Call `showScreen('yourscreen')` to transition
4. Update `signaling.phase` appropriately so reconnection behaves correctly

### Replacing Render with another host
Only two things need to change:
1. `server/render.yaml` → whatever deploy config the new host needs
2. `js/config.js` → `SIGNALING_URL` to the new `wss://` URL
The signaling server itself (`server/index.js`) has zero platform-specific code.

---

## PWA & Theming

### Progressive Web App
- Mounted at `/omni/` — `<base href="/omni/">` in `index.html`; `manifest.json`
  uses `start_url: "./"` and `scope: "./"`
- `sw.js` (cache `omni-v3`) is **network-first with cache fallback**, precaches the
  app shell via relative paths, and skips all cross-origin requests (signaling,
  STUN/TURN, Google Fonts) so it only manages this sub-app
- Service worker is registered from `js/boot.js` as a relative path → `/omni/sw.js`
- Meta tags: `apple-mobile-web-app-capable`, `theme-color`, `viewport-fit=cover`
- Body has `overscroll-behavior: none`, `-webkit-tap-highlight-color: transparent`
- Safe-area insets respected via `env(safe-area-inset-top/bottom)`

### Theme Toggle (Dark/Light)
- Dark theme (default): warm orange accent (`#f4956a`) on near-black (`#0c0a09`)
- Light theme: green accent (`#22a65a`) on soft white (`#f8faf8`)
- Toggle button (🌙/☀️) in top-right of home screen, wired in `js/boot.js`
- Persisted to `localStorage('omni-theme')`
- `meta[name=theme-color]` updated dynamically for browser chrome
- Smooth 300ms transition via `.theme-transitioning` class
- All colors use CSS custom properties — no hardcoded values in component styles

### `sounds.js`

| Export | Purpose |
|---|---|
| `ensureAudioContext()` | Resume AudioContext on first user gesture |
| `playJoinTone()` | Rising two-note tone when peer joins |
| `playMessageTone()` | Short blip on incoming chat message |
| `playHangupTone()` | Descending tone on call end |
| `getQualityLevel({ bitrate, packetLoss, rtt })` | Returns `{ level, label }` — 'good'/'fair'/'poor' |

**Quality thresholds:**
- Poor: packetLoss > 8% OR bitrate < 50kbps OR rtt > 500ms
- Fair: packetLoss > 3% OR bitrate < 200kbps OR rtt > 250ms
- Good: everything else

### `i18n.js` — Internationalization

| Export | Purpose |
|---|---|
| `t(key, params?)` | Translate a dotted key; interpolates `{placeholder}` params; falls back en → key |
| `applyTranslations(root=document)` | Fill `data-i18n` (textContent), `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria-label` |
| `setLanguage(code)` | Switch language, persist to `localStorage['omni-lang']`, set `<html lang>` |
| `getLanguage()` | Current language code |
| `LANGUAGES` | `[{ code, label }]` — en, es, fr, de, hi (native labels) |
| `_translations` | Raw table (exposed for tests) |

- **Node-safe**: guards `localStorage` / `navigator` / `document` so it imports in the test runner.
- **Markup contract**: every `data-i18n*` key in `index.html` must exist in the table — enforced by `i18n.test.js`.
- **Dynamic strings**: `app.js` builds runtime messages via `t('sys.…', { name, size })` etc.
- **Where it's wired**: `app.js` `initI18n()` runs `applyTranslations(document)` on load and on the home-screen language `<select>` change. `boot.js` sets `<html lang>` early to reduce flash. The selector lives on the home screen, so language is chosen before a call.

**Accessibility (a11y):**
- Live regions: `#chat-messages` is `role="log" aria-live="polite"`; `#lobby-status`, `#connecting-state`, `#file-progress`, the muted nudge are `role="status"`; `#home-error` is `role="alert"`; a visually-hidden `#sr-announcer` (`.sr-only`) announces language changes via `announce()`.
- Icon-only emoji are `aria-hidden="true"` so screen readers read the adjacent label/`aria-label` instead.
- SAS panel is a `role="dialog" aria-modal="true"` — focus moves to it on show, **Esc** dismisses, and focus is restored to the previously focused element.
- Global `:focus-visible` outline for keyboard users; `@media (prefers-reduced-motion: reduce)` neutralizes animations/transitions.
- `<html lang>` tracks the active language for correct screen-reader pronunciation.

---

## Testing

```bash
cd tests && npm install        # installs ws (test dependency)
cd .. && node --test tests/*.test.js   # run from the repo root
```

**119 tests across 8 suites:**

| Suite | Tests | What it covers |
|---|---|---|
| `crypto.test.js` | 18 | Key generation, encrypt/decrypt roundtrip, SHA-256, base64 utils |
| `server.test.js` | 17 | Room create/join, custom codes, rejoin grace period, sanitisation |
| `integration.test.js` | 7 | Full signaling flow — two WebSocket clients, relay, peer-left |
| `quality.test.js` | 17 | `getQualityLevel` boundary conditions, edge cases |
| `filequeue.test.js` | 7 | Sequential queue processing, error handling |
| `e2e.test.js` | 19 | Incremental SHA-256, real chunked file transfer, perfect-negotiation glare, origin allowlist + maxPayload, full lifecycle |
| `features.test.js` | 13 | Safety number symmetry/MITM, room-password key derivation, multiplexed file frames, QR generator structure |
| `i18n.test.js` | 21 | Translation key completeness across 5 languages, placeholder consistency, `t()` interpolation/fallback, index.html key contract |

All tests use Node.js built-in `node:test` runner — no external test framework.

### Upgrading to room-based multi-party calls
The current architecture is 1-on-1 (mesh). For multi-party you need an SFU
(Selective Forwarding Unit). Recommended: LiveKit or mediasoup. This is a
significant architecture change — the DataChannel-based file/chat layer can
stay as-is; only the media layer changes.

---

## Dev Setup

```bash
# Terminal 1 — signaling server (local)
cd server
npm install
node --watch index.js
# Listening on :8080

# Terminal 2 — client (needs HTTPS for camera/mic)
# Option A: VS Code Live Server extension (set to HTTPS in settings)
# Option B: local-ssl-proxy or mkcert
npx local-ssl-proxy --source 3001 --target 3000
npx serve . -l 3000

# Update config.js for local dev:
SIGNALING_URL: 'ws://localhost:8080'
# (plain ws:// is fine on localhost even with HTTPS frontend — the CSP
#  connect-src already allows ws://localhost:*)
#
# Note: <base href="/omni/"> means local serving must also be under /omni/
# (e.g. http://localhost:3000/omni/). Adjust the base if you serve at root locally.
```

**Testing the P2P connection locally:**
Open two browser tabs. Tab 1 creates a room. Tab 2 joins with the code.
Both tabs share the same machine so ICE will use `host` candidates (local
network) — STUN and TURN are not exercised. To test TURN, use two different
devices on different networks, or use a tool like `clumsy` (Windows) /
`tc` (Linux) to simulate NAT.

---

## Environment Summary

| Thing | Value |
|---|---|
| Node.js version | ≥ 18 (ESM native) |
| Server dependencies | `ws@^8` only |
| Client dependencies | None (zero npm packages) |
| Build step | None |
| Module system (server) | ESM (`"type": "module"` in package.json) |
| Module system (client) | ES Modules (`type="module"` in script tag) |
| Browser support | Chrome 86+, Edge 86+, Firefox 90+, Safari 15+ |
| PWA support | Installable (Add to Home Screen) on all modern browsers |
| Theme | Dark (orange) default, Light (green) toggle |
| File System Access API | Chrome/Edge only (graceful fallback for others) |
| Signaling server port | `process.env.PORT \|\| 8080` |
| Render internal port | 10000 (set in render.yaml) |
| Mount path | `/omni/` (via `<base href>`; sibling apps at root) |
| CSP | strict `<meta>` in index.html (`script-src 'self'`) |
| Origin allowlist | `ALLOWED_ORIGINS` env on server (optional; unset ⇒ allow all) |
| Signaling frame cap | `maxPayload` 256 KB (oversized ⇒ close 1009) |
| Tests | 119 across 8 suites (`node --test tests/*.test.js`) |

---

## Custom Room Codes

Users can optionally choose their own room code instead of getting a server-generated one.

### Rules
- **Length:** 4–10 characters
- **Characters:** alphanumeric only (`A-Z`, `0-9`)
- **Case:** always normalised to uppercase (input and server both sanitise)
- **Uniqueness:** server checks live room Map — rejected if already in use
- **Availability:** only checked at creation time against currently active rooms.
  A code that was used yesterday is available again today (rooms are in-memory, cleared on server restart).

### Data flow
```
User types "VIJESH" in custom code input
  ↓
app.js: strip non-alphanumeric, uppercase → "VIJESH"
  ↓
client-side: length >= 4? ✓
  ↓
signaling.createRoom("VIJESH")
  ↓
server: strip non-alphanumeric, uppercase → "VIJESH"
  ↓
server: rooms.has("VIJESH")?
  ├─ YES → send { type: 'error', message: 'That code is already in use.' }
  └─ NO  → rooms.set("VIJESH", ...) → send { type: 'created', code: 'VIJESH', custom: true }
  ↓
app.js: lobby screen shows "VIJESH" with custom indicator (✦)
```

### Sanitisation (two layers — belt and braces)
Both `app.js` and `server/index.js` independently strip non-alphanumeric characters
and uppercase the result. A malicious or buggy client cannot inject special characters
into the room Map key.

### `created` event shape (updated)
```js
{ type: 'created', code: 'VIJESH', custom: true }   // custom code
{ type: 'created', code: 'X7K2PQ', custom: false }  // server-generated
```
`app.js` uses the `custom` flag to show different lobby status text and a visual indicator.

### The toggle UI
The custom code input is hidden behind a `▸ Use a custom code` toggle to keep the
default create flow uncluttered. CSS `grid-template-rows: 0fr → 1fr` transition
animates the reveal without needing `max-height` hacks. The toggle closes and
clears the input if collapsed.
