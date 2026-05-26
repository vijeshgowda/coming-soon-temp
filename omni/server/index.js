import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';

const PORT        = process.env.PORT || 8080;
const GRACE_MS    = 90_000;     // room survives 90s after creator disconnects
const ROOM_TTL_MS = 3_600_000;  // rooms die after 1 hour regardless

const rooms = new Map();

// ─── HTTP server (health check for Render cron) ───────────────────────────────
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

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getOther(room, ws) {
  return room.peers.find(p => p !== ws);
}

// ─── Cleanup stale rooms every 5 minutes ─────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const expired = now - room.createdAt > ROOM_TTL_MS;
    // Only auto-clean rooms NOT in an active grace period
    const deadAndNotGrace = !room.creatorVacated &&
      room.peers.every(p => p.readyState !== 1);
    if (expired || deadAndNotGrace) {
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
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 10);

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
          creatorVacated: false,  // true during grace period
          graceTimer:     null,
        });
        ws.roomCode = code;
        send(ws, { type: 'created', code, custom: requested.length > 0 });
        break;
      }

      // ── Rejoin: creator reconnects within grace window ────────────────────
      // Sent by signaling.js on reconnect instead of 'create'.
      // Preserves the room code so the peer they shared it with can still join.
      case 'rejoin': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room || !room.creatorVacated) {
          // Grace window expired or room never existed — fall back to new room
          send(ws, { type: 'rejoin-failed', code });
          return;
        }

        // Cancel the scheduled deletion
        clearTimeout(room.graceTimer);
        room.graceTimer      = null;
        room.creatorVacated  = false;

        // Preserve any joiner who connected during grace period
        const existingPeers = room.peers.filter(p => p.readyState === 1);
        room.peers           = [ws, ...existingPeers];
        ws.roomCode          = code;

        send(ws, { type: 'rejoined', code, custom: room.custom });

        // If a joiner arrived during grace window, notify creator immediately
        if (existingPeers.length > 0) {
          send(ws, { type: 'peer-joined' });
        }
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
        // Allow join even during creator's grace window — they may reconnect
        const activePeers = room.peers.filter(p => p.readyState === 1);
        if (activePeers.length >= 2) {
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
      // Active call — other peer must be notified
      send(other, { type: 'peer-left' });
      rooms.delete(ws.roomCode);
    } else {
      // Creator left the lobby alone — grace period instead of instant delete.
      // Covers the "switch to WhatsApp to paste code then come back" case.
      room.peers          = room.peers.filter(p => p !== ws);
      room.creatorVacated = true;
      const codeSnapshot  = ws.roomCode; // capture before async delay
      room.graceTimer     = setTimeout(() => {
        rooms.delete(codeSnapshot);
      }, GRACE_MS);
    }
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
  console.log(`[omni] Signaling server listening on :${PORT}`);
});
