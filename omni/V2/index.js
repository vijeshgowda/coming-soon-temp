import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';

const PORT = process.env.PORT || 8080;

// roomCode -> { peers: [ws, ws?], createdAt: timestamp }
const rooms = new Map();

// ─── HTTP server (health check for Fly.io) ───────────────────────────────────
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
  res.writeHead(404);
  res.end();
});

// ─── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

/**
 * Generate a human-readable 6-char room code.
 * Excludes ambiguous chars: 0/O, 1/I, L
 */
function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/** Send a JSON message to a WebSocket safely */
function send(ws, msg) {
  if (ws.readyState === 1) { // OPEN
    ws.send(JSON.stringify(msg));
  }
}

/** Get the other peer in a room */
function getOther(room, ws) {
  return room.peers.find(p => p !== ws);
}

// ─── Cleanup stale rooms every 5 minutes ─────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const stale = now - room.createdAt > 3_600_000; // 1 hour
    const empty = room.peers.every(p => p.readyState !== 1);
    if (stale || empty) rooms.delete(code);
  }
}, 300_000);

// ─── Connection handler ───────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // Peer A: create a new room (with optional custom code)
      case 'create': {
        let code;

        // Strip everything except alphanumeric, uppercase, cap at 20 chars
        const requested = (msg.code || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 20);

        if (requested.length > 0) {
          // ── Custom code path ──────────────────────────────────────────────
          if (requested.length < 4) {
            send(ws, { type: 'error', message: 'Custom codes must be at least 4 characters.' });
            return;
          }
          if (rooms.has(requested)) {
            send(ws, { type: 'error', message: 'That code is already in use. Try a different one.' });
            return;
          }
          code = requested;
        } else {
          // ── Random code path ──────────────────────────────────────────────
          let attempts = 0;
          do {
            code = generateCode();
            if (++attempts > 100) { send(ws, { type: 'error', message: 'Server busy' }); return; }
          } while (rooms.has(code));
        }

        rooms.set(code, { peers: [ws], createdAt: Date.now() });
        ws.roomCode = code;
        send(ws, { type: 'created', code, custom: requested.length > 0 });
        break;
      }

      // Peer B: join an existing room
      case 'join': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
          send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
          return;
        }
        if (room.peers.length >= 2) {
          send(ws, { type: 'error', message: 'Room is full.' });
          return;
        }

        room.peers.push(ws);
        ws.roomCode = code;

        send(ws, { type: 'joined', code });
        send(room.peers[0], { type: 'peer-joined' }); // notify creator
        break;
      }

      // Relay SDP offer/answer and ICE candidates between peers
      case 'signal': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const other = getOther(room, ws);
        if (other) send(other, { type: 'signal', payload: msg.payload });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    const other = getOther(room, ws);
    if (other) send(other, { type: 'peer-left' });

    rooms.delete(ws.roomCode);
  });

  ws.on('error', () => ws.terminate());
});

// ─── Heartbeat: drop zombie connections ──────────────────────────────────────
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[project-a] Signaling server listening on :${PORT}`);
});
