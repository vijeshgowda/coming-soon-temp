import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';

const PORT        = process.env.PORT || 8080;
const GRACE_MS    = 90_000;    // 90s before a vacant lobby room is deleted
const ROOM_TTL_MS = 3_600_000; // hard max room lifetime: 1 hour

// roomCode -> { peers, createdAt, custom, creatorVacated, graceTimer }
const rooms = new Map();

// ─── HTTP (health check for Render keep-alive cron) ───────────────────────────
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

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getOther(room, ws) {
  return room.peers.find(p => p !== ws);
}

// ─── Stale room cleanup (grace timers handle the fast path) ──────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      clearTimeout(room.graceTimer);
      rooms.delete(code);
    }
  }
}, 300_000);

// ─── Connection handler ───────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.isAlive  = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Create room (random or custom code) ──────────────────────────────
      case 'create': {
        let code;
        const requested = (msg.code || '')
          .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

        if (requested.length > 0) {
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
          let attempts = 0;
          do {
            code = generateCode();
            if (++attempts > 100) { send(ws, { type: 'error', message: 'Server busy' }); return; }
          } while (rooms.has(code));
        }

        rooms.set(code, {
          peers:          [ws],
          createdAt:      Date.now(),
          custom:         requested.length > 0,
          creatorVacated: false,
          graceTimer:     null,
        });
        ws.roomCode = code;
        send(ws, { type: 'created', code, custom: requested.length > 0 });
        break;
      }

      // ── Rejoin: creator reconnects during the 90s grace window ───────────
      // Preserves the room code so the user doesn't have to share a new one
      // after switching apps briefly.
      case 'rejoin': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room || !room.creatorVacated) {
          // Room gone or not in grace state — tell client to create fresh
          send(ws, { type: 'rejoin-failed', code });
          return;
        }

        // Cancel the deletion timer
        clearTimeout(room.graceTimer);
        room.graceTimer      = null;
        room.creatorVacated  = false;
        room.peers           = [ws];
        ws.roomCode          = code;

        send(ws, { type: 'rejoined', code, custom: room.custom });
        break;
      }

      // ── Join room ─────────────────────────────────────────────────────────
      case 'join': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
          send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
          return;
        }
        if (room.peers.filter(p => p.readyState === 1).length >= 2) {
          send(ws, { type: 'error', message: 'Room is full.' });
          return;
        }

        room.peers.push(ws);
        ws.roomCode = code;

        send(ws, { type: 'joined', code });
        const creator = room.peers.find(p => p !== ws && p.readyState === 1);
        if (creator) send(creator, { type: 'peer-joined' });
        break;
      }

      // ── Signal relay ──────────────────────────────────────────────────────
      case 'signal': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const other = getOther(room, ws);
        if (other) send(other, { type: 'signal', payload: msg.payload });
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    const other = getOther(room, ws);

    if (other && other.readyState === 1) {
      // Both peers were connected — the other peer needs to know
      send(other, { type: 'peer-left' });
      rooms.delete(ws.roomCode);
    } else {
      // Creator left the lobby alone.
      // Start a 90s grace window instead of deleting immediately.
      // This covers: switching to WhatsApp to paste the code, brief network drops, etc.
      room.peers          = room.peers.filter(p => p !== ws);
      room.creatorVacated = true;
      room.graceTimer     = setTimeout(() => {
        rooms.delete(ws.roomCode);
      }, GRACE_MS);
    }
  });

  ws.on('error', () => ws.terminate());
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[omni] Signaling server listening on :${PORT}`);
});
