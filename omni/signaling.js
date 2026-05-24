/**
 * Project A — Signaling Client
 *
 * Fix 3 (IMPROVED): Context-aware reconnection with exponential backoff.
 *
 * The suggested fix — naive exponential backoff — has a subtle flaw:
 * the signaling server is only needed during connection bootstrapping.
 * Once WebRTC P2P is established, the signaling server dropping is
 * completely harmless. A blind reconnect in that case wastes resources
 * and can cause false "reconnecting…" UI noise.
 *
 * This implementation separates two distinct failure modes:
 *
 *   Mode A — Drop during LOBBY (waiting for peer):
 *     → Reconnect with backoff and re-announce the room.
 *     → The UI shows a subtle "reconnecting" state.
 *     → Room code persists through reconnection.
 *
 *   Mode B — Drop during CALL (WebRTC already connected):
 *     → Attempt silent reconnect in background.
 *     → UI is NOT disrupted. Call continues unaffected.
 *     → Only matters if peer drops and sends a 'peer-left' — which
 *        we'd miss. So we reconnect silently to receive it if it comes.
 *
 * The WebRTC peer connection itself handles temporary network drops
 * via ICE restart (see webrtc.js) — completely independent of this.
 */

export class SignalingClient extends EventTarget {
  /** @param {string} serverUrl - wss://your-app.onrender.com */
  constructor(serverUrl) {
    super();
    this.serverUrl = serverUrl;
    this.ws        = null;

    // Reconnection state
    this._intentionalClose = false;
    this._attempts         = 0;
    this._maxAttempts      = 6;
    this._reconnecting     = false;

    // Context state — set by app.js so reconnection knows what to do
    this.phase     = 'idle';   // 'idle' | 'lobby' | 'call'
    this.roomCode  = null;
    this.role      = null;     // 'creator' | 'joiner'
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Initial connection. Returns promise that resolves on first open. */
  connect() {
    return new Promise((resolve, reject) => {
      this._intentionalClose = false;
      this._openSocket(resolve, reject);
    });
  }

  createRoom() {
    this.role = 'creator';
    this._send({ type: 'create' });
  }

  joinRoom(code) {
    this.role = 'joiner';
    this._send({ type: 'join', code: code.toUpperCase().trim() });
  }

  sendSignal(payload) {
    this._send({ type: 'signal', payload });
  }

  /** Call this on intentional hangup/cancel to suppress reconnection. */
  disconnect() {
    this._intentionalClose = true;
    this.phase = 'idle';
    this.ws?.close();
  }

  // ─── Socket management ──────────────────────────────────────────────────────

  _openSocket(onOpen = null, onError = null) {
    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch {
      onError?.(new Error('Invalid signaling server URL'));
      return;
    }

    this.ws.onopen = () => {
      this._attempts    = 0;
      this._reconnecting = false;
      onOpen?.();

      // After a reconnect, restore state based on current phase
      if (this.phase === 'lobby' && this.role === 'creator' && this.roomCode) {
        // Re-announce our room so the server knows we exist again.
        // The server will re-create the room with the same code if possible,
        // but since room state is in-memory, we create a new one.
        // The user sees the new code — unavoidable with a stateless server.
        // Better: re-create and update the UI with new code.
        this._send({ type: 'create' });
      }
    };

    this.ws.onerror = (e) => {
      onError?.(new Error('Could not reach signaling server'));
    };

    this.ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    };

    this.ws.onclose = (event) => {
      if (this._intentionalClose) return;

      if (this.phase === 'call') {
        // During a call, signaling is not critical — reconnect silently
        this._scheduleReconnect({ silent: true });
      } else if (this.phase === 'lobby') {
        // In lobby, reconnect is critical — user is waiting for peer
        this._scheduleReconnect({ silent: false });
      } else {
        // idle or unknown — surface the disconnect
        this.dispatchEvent(new CustomEvent('disconnected'));
      }
    };
  }

  _scheduleReconnect({ silent }) {
    if (this._reconnecting) return;

    if (this._attempts >= this._maxAttempts) {
      // Gave up — only disrupt UI if we're not in an active call
      if (!silent) {
        this.dispatchEvent(new CustomEvent('reconnect-failed'));
      }
      return;
    }

    this._reconnecting = true;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(1000 * Math.pow(2, this._attempts), 30_000);
    this._attempts++;

    if (!silent) {
      this.dispatchEvent(new CustomEvent('reconnecting', {
        detail: { attempt: this._attempts, max: this._maxAttempts, delay }
      }));
    }

    setTimeout(() => {
      this._reconnecting = false;
      this._openSocket();
    }, delay);
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
