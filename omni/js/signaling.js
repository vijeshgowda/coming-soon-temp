/**
 * Omni — Signaling Client
 *
 * Context-aware reconnection with exponential backoff.
 *
 *   Mode A — Drop during LOBBY:
 *     First tries 'rejoin' with the stored room code (90s grace window).
 *     If the grace window expired, server sends 'rejoin-failed' and
 *     app.js falls back to creating a fresh room.
 *
 *   Mode B — Drop during CALL:
 *     Silent background reconnect. Call continues via WebRTC P2P.
 *     UI is never disrupted.
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
    this.phase       = 'idle';  // 'idle' | 'lobby' | 'call'
    this.roomCode    = null;
    this.role        = null;    // 'creator' | 'joiner'
    this._customCode = '';      // Stored to re-use if rejoin fails
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      this._intentionalClose = false;
      this._openSocket(resolve, reject);
    });
  }

  /** @param {string} [customCode] - Empty string = server generates one */
  createRoom(customCode = '') {
    this.role        = 'creator';
    this._customCode = customCode;
    this._send({ type: 'create', code: customCode });
  }

  joinRoom(code) {
    this.role = 'joiner';
    this._send({ type: 'join', code: code.toUpperCase().trim() });
  }

  sendSignal(payload) {
    this._send({ type: 'signal', payload });
  }

  /** Intentional close — suppresses all reconnection logic */
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

      // After reconnect, restore lobby state
      if (this.phase === 'lobby' && this.role === 'creator' && this.roomCode) {
        // Try to reclaim the existing room within its 90s grace window.
        // Server responds with 'rejoined' (success) or 'rejoin-failed' (expired).
        // app.js handles both cases.
        this._send({ type: 'rejoin', code: this.roomCode });
      }
    };

    this.ws.onerror = () => {
      onError?.(new Error('Could not reach signaling server'));
    };

    this.ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    };

    this.ws.onclose = () => {
      if (this._intentionalClose) return;

      if (this.phase === 'call') {
        this._scheduleReconnect({ silent: true });
      } else if (this.phase === 'lobby') {
        this._scheduleReconnect({ silent: false });
      } else {
        this.dispatchEvent(new CustomEvent('disconnected'));
      }
    };
  }

  _scheduleReconnect({ silent }) {
    if (this._reconnecting) return;
    if (this._attempts >= this._maxAttempts) {
      if (!silent) this.dispatchEvent(new CustomEvent('reconnect-failed'));
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
