# Project A

> Browser-to-browser encrypted video calls and file sharing. The server never touches your data.

**Live demo:** `https://yourusername.github.io/project-a`

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
git clone https://github.com/yourusername/project-a
cd project-a
```

### 2. Deploy the signaling server to Render

Note your app URL: `wss://your-app-name.onrender.com`

### 3. Get free TURN credentials

1. Sign up at [metered.ca](https://www.metered.ca/stun-turn) (free)
2. Copy your username and credential from the dashboard

### 4. Configure the client

Edit `client/js/config.js`:

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
# Run signaling server locally
cd server
npm install
npm run dev
# Listening on :8080

# Serve client locally (needs HTTPS for camera access)
# Option A: VS Code Live Server extension
# Option B:
npx serve client
# Note: camera/mic requires HTTPS. Use ngrok for testing with real devices.
```

For local dev, update `SIGNALING_URL` in `config.js` to `ws://localhost:8080`.

---

## Project Structure

```
project-a/
├── .github/
│   └── workflows/
│       └── deploy.yml        # Auto-deploy client to GitHub Pages
├── server/
│   ├── index.js              # WebSocket signaling server (~100 lines)
│   ├── package.json
│   ├── Dockerfile
│   └── render.yaml             # Render deployment config
├── client/
│   ├── index.html            # Full app UI (3 screens: home, lobby, call)
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── config.js         # ← Edit this with your URLs/credentials
│       ├── app.js            # UI state machine + event wiring
│       ├── signaling.js      # WebSocket client
│       ├── webrtc.js         # RTCPeerConnection + DataChannel
│       └── crypto.js         # ECDH + AES-GCM + SHA-256 (Web Crypto API)
└── README.md
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
- **WebSockets** — signaling only, via `ws` npm package
- **Render** — signaling server (free tier, always-on, global)
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
