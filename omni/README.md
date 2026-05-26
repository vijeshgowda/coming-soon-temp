# Omni

> Browser-to-browser encrypted video calls, chat, and file sharing. The server never touches your data.

**Live demo:** `https://yourusername.github.io/omni`

---

## Features

- **End-to-end encrypted** — ECDH P-256 key exchange + AES-GCM-256 on top of WebRTC DTLS
- **P2P video/audio calls** — direct browser-to-browser, no media server
- **Encrypted chat** — real-time messaging over DataChannel
- **File transfer** — chunked, encrypted, SHA-256 verified, multi-file queue
- **Screen sharing** — one-tap on desktop, auto-fallback message on mobile
- **Flip camera** — front/back toggle
- **Picture-in-Picture** — auto-enters when tab hidden, manual button too
- **Connection quality** — live bitrate/loss/RTT monitoring with colored indicator
- **Notification sounds** — Web Audio tones on join, message, hangup
- **Typing indicator** — shows when peer is composing
- **Draggable local video** — drag your PiP preview, snaps to corners
- **Image/video previews** — inline thumbnails for received media files
- **PWA installable** — Add to Home Screen, works offline (cached assets)
- **Dark/Light theme** — toggle between warm orange (dark) and green (light)
- **Zero dependencies** — vanilla JS, no build step, no npm packages in the client
- **66 automated tests** — crypto, signaling server, integration, quality, file queue

---

## How it works

```
GitHub Pages          Render (free)         Google STUN       Metered.ca TURN
────────────          ─────────────         ───────────       ───────────────
HTML/CSS/JS     →     Signaling only    →   NAT discovery →   Relay fallback
(static files)        (room codes,          (finds public     (for strict NAT,
                       SDP relay)            IP/port)          ~15% of users)

                            ↕ WebSocket (signaling only)
                    
Peer A ─────────────── WebRTC (P2P) ────────────── Peer B
         Audio, video, chat, files — direct, encrypted
         Server sees: nothing. Ever.
```

### Encryption

Two independent layers:

| Layer | What | Who controls keys |
|---|---|---|
| **DTLS** | Transport (built into WebRTC) | Browser, automatic |
| **AES-GCM** | Application (this app) | Peers only, ECDH-derived |

The signaling server only sees room codes and opaque SDP blobs. It is architecturally incapable of reading your calls or messages.

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/yourusername/omni
cd omni
```

### 2. Deploy the signaling server to Render

Note your app URL: `wss://your-app-name.onrender.com`

### 3. Get free TURN credentials

1. Sign up at [metered.ca](https://www.metered.ca/stun-turn) (free)
2. Copy your username and credential from the dashboard

### 4. Configure the client

Edit `js/config.js`:

```js
export const CONFIG = {
  SIGNALING_URL: `wss://your-app-name.onrender.com`,  // ← your Render URL
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'YOUR_USERNAME',     // ← from metered.ca
      credential: 'YOUR_CREDENTIAL',
    },
    // ... (keep the other TURN entries, same credentials)
  ],
};
```

### 5. Deploy the frontend to GitHub Pages

Push to `main` — GitHub Actions deploys automatically (see `.github/workflows/deploy.yml`).

Or enable Pages manually: **Settings → Pages → Source: GitHub Actions**

---

## Development

```bash
# Terminal 1 — signaling server (local)
cd server
npm install
node --watch index.js
# Listening on :8080

# Terminal 2 — serve frontend (needs HTTPS for camera access)
# Option A: VS Code Live Server extension
# Option B:
npx serve .
# Note: camera/mic requires HTTPS. Use ngrok for testing with real devices.
```

For local dev, update `SIGNALING_URL` in `js/config.js` to `ws://localhost:8080`.

### Running Tests

```bash
cd tests
npm install
npm test
# 66 tests, 5 suites, 0 failures
```

Tests use Node.js built-in `node:test` — no external test framework needed.

---

## PWA & Themes

The app is installable as a PWA — "Add to Home Screen" on mobile for a native-app experience with no browser chrome.

- **Dark mode** (default): warm orange accent on near-black background
- **Light mode**: green accent on soft white background
- Toggle via the 🌙/☀️ button on the home screen. Persists across sessions.

---

## Project Structure

```
omni/
├── .github/
│   └── workflows/
│       └── deploy.yml        # Auto-deploy to GitHub Pages
├── server/
│   ├── index.js              # WebSocket signaling server (~210 lines)
│   ├── package.json
│   ├── Dockerfile
│   └── render.yaml           # Render deployment config
├── tests/
│   ├── package.json          # node:test runner, ws dependency
│   ├── crypto.test.js        # 18 tests
│   ├── server.test.js        # 17 tests
│   ├── integration.test.js   # 7 tests
│   ├── quality.test.js       # 17 tests
│   └── filequeue.test.js     # 7 tests
├── index.html                # Full app UI (3 screens) + PWA meta
├── manifest.json             # PWA manifest (standalone, portrait)
├── sw.js                     # Service worker (cache-first)
├── css/
│   └── styles.css            # Dual-theme (dark/light), mobile-first
└── js/
    ├── config.js             # ← Edit this with your URLs/credentials
    ├── app.js                # UI state machine + all feature orchestration
    ├── signaling.js          # WebSocket client with reconnection
    ├── webrtc.js             # RTCPeerConnection + DataChannel + file transfer
    ├── crypto.js             # ECDH + AES-GCM + SHA-256 (Web Crypto API)
    └── sounds.js             # Web Audio notification tones + quality calc
```

---

## Security

| Threat | Mitigation |
|---|---|
| Server reads your call | Server only sees opaque SDP blobs. DTLS + AES-GCM protect all media/data |
| MITM on signaling | DTLS certificate fingerprint verified by WebRTC automatically |
| File tampering | SHA-256 checksum verified on every received file |
| Room code brute force | Rate limit on join attempts; codes expire on disconnect |
| Replay attacks | AES-GCM nonces are unique per message |

---

## Tech Stack

- **No frameworks, no bundler** — vanilla JS with ES modules, runs directly in browser
- **WebRTC** — browser-native P2P audio/video/data
- **Web Crypto API** — browser-native ECDH + AES-GCM, no crypto libraries
- **Web Audio API** — notification tones, no audio files
- **WebSockets** — signaling only, via `ws` npm package
- **Service Worker** — offline caching for PWA
- **Render** — signaling server (free tier, always-on via cron)
- **GitHub Pages** — frontend (free, deploys on push)
- **Metered.ca** — TURN relay fallback (free tier)

---

## Contributing

PRs welcome. The codebase is intentionally small and dependency-light.

```bash
# No build step. Edit files, refresh browser.
```

---

## License

MIT
