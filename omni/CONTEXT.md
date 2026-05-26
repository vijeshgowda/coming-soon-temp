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
├── index.html                  # Full app UI — 3 screens
├── css/
│   └── styles.css
├── js/
│   ├── config.js               # ← EDIT THIS: Render URL + Metered credentials
│   ├── app.js                  # UI state machine — orchestrates everything
│   ├── signaling.js            # WebSocket client with reconnection + timeout
│   ├── webrtc.js               # RTCPeerConnection + DataChannel + ICE restart
│   └── crypto.js               # ECDH + AES-GCM + SHA-256 (Web Crypto API only)
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
| `deriveSharedKey(priv, pub)` | two `CryptoKey`s | `CryptoKey` (AES-GCM 256) | ECDH → HKDF → AES |
| `encrypt(key, data)` | `CryptoKey`, `string\|Uint8Array` | `Uint8Array` | `[12B IV][ciphertext][16B tag]` |
| `decrypt(key, data)` | `CryptoKey`, `Uint8Array` | `ArrayBuffer` | Throws on auth failure |
| `sha256(data)` | `string\|ArrayBuffer` | `string` (hex) | For file integrity |
| `uint8ToBase64(bytes)` | `Uint8Array` | `string` | |
| `base64ToUint8(b64)` | `string` | `Uint8Array` | |

**Key derivation chain:**
```
ECDH(ourPrivate, theirPublic)
  → 256 bits shared secret
  → HKDF(SHA-256, salt=32×0x00, info="project-a-v1")
  → AES-GCM-256 key
```
Both peers independently derive the same key. The server never sees any key material.

### `signaling.js` — `SignalingClient extends EventTarget`

**State fields (set by `app.js`):**
```js
signaling.phase     // 'idle' | 'lobby' | 'call'
signaling.roomCode  // current room code (string)
signaling.role      // 'creator' | 'joiner'
```

**Methods:**
```js
await signaling.connect()       // Initial WS connection (15s timeout)
signaling.createRoom()          // Server responds with 'created' event
signaling.joinRoom(code)        // Server responds with 'joined' or 'error' event
signaling.sendSignal(payload)   // Relay SDP/ICE to other peer
signaling.disconnect()          // Intentional close — suppresses reconnection
```

**Connection timeout:** `connect()` rejects after 15 seconds if the WebSocket
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
new PeerConnection(signalingClient, isInitiator, iceServers)
// isInitiator = true for room creator, false for joiner
```

**Key method:**
```js
await peer.initialize(localStream)
// Sets up RTCPeerConnection, adds media tracks, creates/receives DataChannel,
// creates SDP offer (if initiator) and sends via signaling.
// Call this after receiving 'peer-joined' (creator) or 'joined' (joiner).
```

**Additional methods:**
```js
await peer.replaceVideoTrack(newTrack)  // Screen sharing: swap video sender's track
peer.toggleAudio(enabled)               // Mute/unmute mic
peer.toggleVideo(enabled)               // Enable/disable camera
await peer.send(data)                   // Encrypt and send JSON via DataChannel
await peer.sendFile(file)               // Chunked encrypted file transfer
peer.hangup()                           // Stop tracks, close PC + DC
```

**Events emitted:**
```
remote-stream         { stream }          Remote MediaStream ready
secure-channel-ready  {}                  ECDH done, AES key derived
connection-state      { state }           RTCPeerConnection state change
ice-state             { state }           ICE connection state change
ice-restarting        {}                  ICE restart triggered (network drop)
data                  { ...inner }        Decrypted DataChannel message
file-chunk            { data }            Raw ArrayBuffer file chunk (binary frame)
file-send-progress    { name, sent, total } Outgoing file progress
channel-closed        {}                  DataChannel closed
error                 { message }         Any error
```

**DataChannel message types (internal):**
```
pubkey     { key: base64 }         ECDH public key exchange (plaintext, by design)
encrypted  { data: base64 }        AES-GCM encrypted JSON wrapper
binary frame                       [4B chunkIndex LE][AES-GCM encrypted chunk]
```

**Encrypted application message types (inside `encrypted` wrapper):**
```
chat       { type:'chat', text }   Chat message
file-meta  { type:'file-meta', name, size, mimeType, hash, chunks }  File metadata
typing     { type:'typing' }       Typing indicator heartbeat
```

**Backpressure (Fix 2):**
```
BUFFER_HIGH = 16MB  — pause sendFile loop, await bufferedamountlow
BUFFER_LOW  = 4MB   — resume (bufferedAmountLowThreshold is set to this)
```

**ICE restart (bonus fix):**
- Triggered when `iceConnectionState → 'disconnected'`
- Only the initiator triggers it (prevents restart collision)
- Creates a new offer with `{ iceRestart: true }`, sends via signaling
- Handles user switching WiFi ↔ cellular mid-call

### `app.js`
Orchestrates UI state machine and wires all events together.

**Screens:** `home` → `lobby` → `call`

**In-call features:**
- Screen sharing (via `getDisplayMedia()` + `replaceTrack()`)
- Call timer (starts on `secure-channel-ready`, formats as MM:SS or H:MM:SS)
- Typing indicator (debounced `{ type:'typing' }` messages, 3s auto-hide)
- Picture-in-Picture (auto-enters when tab hidden, exits when visible)

**Progress bar (connecting state):**
- Shown while WebSocket handshake or room creation is in flight
- CSS animation forcibly restarted on each show (handles repeat attempts)
- Disabled buttons prevent double-clicks during connection
- Hidden by: success events, error events, disconnected event, or timeout

**File receive state machine (Fix 1):**
```
Receive file-meta
  ↓
Browser supports showSaveFilePicker?
  ├─ YES → showSaveFilePicker() → FileSystemWritableFileStream
  │         chunks written to disk as they arrive (zero RAM)
  │         hash computed in parallel from hashBuffer
  │         hashBuffer cleared per chunk → O(1) RAM
  └─ NO  → accumulate chunks[] in memory (fallback)
              warn if file > 500MB
              full SHA-256 at end

On final chunk:
  streaming path → writable.close() → verify hash → system message
  fallback path  → merge Uint8Array → verify hash → Blob URL download
```

**signaling.phase transitions:**
```
connectSignaling()     → phase = 'idle'
created event fires    → phase = 'lobby'
startCall() called     → phase = 'call'
hangup() / reset       → signaling.disconnect() (phase = 'idle')
```

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
getUserMedia()                                              getUserMedia()
generateKeyPair()                                           generateKeyPair()
createDataChannel()                                         (waits for ondatachannel)
createOffer()              →
                           relay SDP offer                             →
                                                    setRemoteDescription()
                                                    createAnswer()     →
                           relay SDP answer  ←
setRemoteDescription()
[ICE candidates exchanged in parallel via signaling]

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

### SHA-256 is not incremental in Web Crypto
`crypto.subtle.digest()` requires the full data. For the streaming path,
chunks are accumulated in `fileReceive.hashBuffer` and merged only at the
end for hash computation. Peak RAM during hash = full file size, but only
for the duration of `mergeChunks()` + `sha256()` (milliseconds), then GC'd.
The disk write itself is streaming. If this RAM spike is unacceptable for
very large files (>2GB), replace with a pure-JS incremental SHA-256
(no external library needed, ~80 lines).

### ICE restart is initiator-only
Only the room creator triggers ICE restart on disconnection. This prevents
both peers simultaneously restarting and creating a collision. The joiner
responds to the new offer normally (handleSignal handles it transparently).

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
method in `signaling.js` has a 15-second timeout — on cold starts the server
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
# (plain ws:// is fine on localhost even with HTTPS frontend)
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
| File System Access API | Chrome/Edge only (graceful fallback for others) |
| Signaling server port | `process.env.PORT \|\| 8080` |
| Render internal port | 10000 (set in render.yaml) |

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
