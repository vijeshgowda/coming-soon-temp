/**
 * Project A — Signaling Client
 *
 * Fix 3 (IMPROVED): Context-aware reconnection with exponential backoff.
 *
 * Two distinct failure modes:
 *
 *   Mode A — Drop during LOBBY:
 *     → Try to REJOIN the existing room first (preserves code).
 *     → If grace window expired, server sends 'rejoin-failed' and
 *       app.js falls back to creating a fresh room.
 *     → UI shows subtle reconnecting state.
 *
 *   Mode B — Drop during CALL (WebRTC already connected):
 *     → Silent background reconnect.
 *     → UI not disrupted — call continues over WebRTC P2P.
 *
 * ICE restart (webrtc.js) handles the actual P2P connection drop
 * independently of this signaling reconnect.
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

    // Context state — set by app.js
    this.phase       = 'idle';  // 'idle' | 'lobby' | 'call'
    this.roomCode    = null;
    this.role        = null;    // 'creator' | 'joiner'
    this._customCode = '';      // stored to re-use if rejoin fails and we create fresh
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      this._intentionalClose = false;
      const timeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('Connection timed out'));
      }, 30_000);
      this._openSocket(
        () => { clearTimeout(timeout); resolve(); },
        (err) => { clearTimeout(timeout); reject(err); }
      );
    });
  }

  /**
   * @param {string} [customCode] - Optional. Empty = server generates one.
   */
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
      this._attempts     = 0;
      this._reconnecting = false;
      onOpen?.();

      // After reconnect, try to reclaim the existing room within its grace window.
      // The server responds with 'rejoined' (success) or 'rejoin-failed' (expired).
      // app.js handles both — on 'rejoin-failed' it calls createRoom() as fallback.
      if (this.phase === 'lobby' && this.role === 'creator' && this.roomCode) {
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

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
