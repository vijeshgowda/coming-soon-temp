/**
* Project A — WebRTC Peer Connection
*
* Fix 2: Backpressure-aware file sending.
*   DataChannel has an internal buffer. If we encrypt faster than the
*   network can drain it, bufferedAmount bloats until the browser kills
*   the connection. The fix: respect the backpressure signal.
*
*   BUFFER_HIGH (16MB) — stop sending, wait for drain event
*   BUFFER_LOW  (4MB)  — resume sending (bufferedamountlow fires here)
*
* Bonus fix: ICE restart on temporary network drop.
*   When iceConnectionState → 'disconnected', WebRTC has lost the path
*   but hasn't given up. We proactively trigger ICE restart (only the
*   initiator does this to avoid a restart race). This lets the call
*   survive a user switching from WiFi to cellular and back.
*/
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
  sha256,
  safetyString,
  uint8ToBase64,
  base64ToUint8,
} from './crypto.js';
// Backpressure thresholds
const BUFFER_HIGH = 16 * 1024 * 1024;  // 16MB — pause sending
const BUFFER_LOW = 4 * 1024 * 1024;  //  4MB — resume sending
const CHUNK_SIZE = 64 * 1024;          // 64KB per chunk
export class PeerConnection extends EventTarget {
  /**
   * @param {import('./signaling.js').SignalingClient} signalingClient
   * @param {boolean} isInitiator
   * @param {RTCIceServer[]} iceServers
   * @param {string} [passphrase] optional room password folded into key derivation
   */
  constructor(signalingClient, isInitiator, iceServers, passphrase = '') {
    super();
    this.signaling = signalingClient;
    this.isInitiator = isInitiator;
    this.iceServers = iceServers;
    this.passphrase = passphrase;
    this.pc = null;
    this.dataChannel = null;
    this.localStream = null;
    this.keyPair = null;
    this.sharedKey = null;
    this._localPub = null;
    this._peerPub = null;
    this.pendingIce = [];
    this.remoteSet = false;
    // ICE restart state — prevent concurrent restarts
    this._iceRestartInProgress = false;
    // Perfect negotiation state
    this._polite = !isInitiator;          // joiner yields on glare, initiator wins
    this._makingOffer = false;
    this._ignoreOffer = false;
    this._isSettingRemoteAnswerPending = false;
  }
  // ─── Initialization ─────────────────────────────────────────────────────────
  async initialize(localStream) {
    this.localStream = localStream;
    this.keyPair = await generateKeyPair();
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // Media tracks
    for (const track of localStream.getTracks()) {
      this.pc.addTrack(track, localStream);
    }
    this.pc.ontrack = ({ streams }) => {
      this._emit('remote-stream', { stream: streams[0] });
    };
    // ICE candidates
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signaling.sendSignal({ type: 'ice-candidate', candidate });
    };
    // ICE connection state — handle temporary drops with ICE restart
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      this._emit('ice-state', { state });
      if (state === 'disconnected') {
        // Don't give up yet — attempt ICE restart to survive network hiccup
        this._attemptIceRestart();
      }
      if (state === 'failed') {
        // ICE restart didn't help — hard failure
        this._iceRestartInProgress = false;
        this._emit('error', { message: 'Connection lost. Check your network or TURN config.' });
      }
      if (state === 'connected' || state === 'completed') {
        this._iceRestartInProgress = false;
      }
    };
    this.pc.onconnectionstatechange = () => {
      this._emit('connection-state', { state: this.pc.connectionState });
    };
    // Perfect negotiation: a single handler drives every (re)negotiation,
    // including the initial offer and ICE restarts. Glare is resolved by the
    // polite/impolite roles in handleSignal().
    this.pc.onnegotiationneeded = async () => {
      if (!this.pc || this.pc.signalingState === 'closed') return;
      try {
        this._makingOffer = true;
        await this.pc.setLocalDescription();
        this.signaling.sendSignal({ type: 'description', sdp: this.pc.localDescription });
      } catch (e) {
        console.warn('[omni] negotiation failed:', e.message);
      } finally {
        this._makingOffer = false;
      }
    };
    // DataChannel — only the initiator creates it (this triggers the first
    // negotiationneeded). The joiner receives it via ondatachannel.
    if (this.isInitiator) {
      this.dataChannel = this.pc.createDataChannel('project-a', { ordered: true });
      this._setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = ({ channel }) => {
        this.dataChannel = channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }
  // ─── ICE restart (bonus fix) ─────────────────────────────────────────────────
  _attemptIceRestart() {
    // Only initiator drives ICE restart to avoid both peers restarting simultaneously.
    // restartIce() triggers onnegotiationneeded, which sends the new offer.
    if (!this.isInitiator || this._iceRestartInProgress) return;
    if (!this.pc || this.pc.signalingState === 'closed') return;
    this._iceRestartInProgress = true;
    this._emit('ice-restarting');
    try {
      this.pc.restartIce();
    } catch (e) {
      console.warn('[omni] ICE restart failed to initiate:', e.message);
      this._iceRestartInProgress = false;
    }
  }
  // ─── DataChannel setup ──────────────────────────────────────────────────────
  _setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';
    // Set low watermark so bufferedamountlow fires at the right level
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    let pubKeySent = false;
    const sendPubKey = async () => {
      if (pubKeySent) return;
      pubKeySent = true;
      const pubKey = await exportPublicKey(this.keyPair);
      this._localPub = pubKey;
      channel.send(JSON.stringify({ type: 'pubkey', key: pubKey }));
    };
    // Use addEventListener (not onopen) to avoid being overwritten
    channel.addEventListener('open', sendPubKey);
    // Some browsers deliver ondatachannel with readyState already 'open'
    if (channel.readyState === 'open') {
      sendPubKey();
    }
    channel.onmessage = async ({ data }) => {
      if (data instanceof ArrayBuffer) {
        this._emit('file-chunk', { data });
        return;
      }
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      switch (msg.type) {
        case 'pubkey': {
          this._peerPub = msg.key;
          const peerPubKey = await importPublicKey(msg.key);
          this.sharedKey = await deriveSharedKey(this.keyPair.privateKey, peerPubKey, this.passphrase);
          const localPub = this._localPub || await exportPublicKey(this.keyPair);
          const safety = await safetyString(localPub, this._peerPub);
          this._emit('secure-channel-ready', { safety });
          break;
        }
        case 'encrypted': {
          try {
            const bytes = base64ToUint8(msg.data);
            const plainBuf = await decrypt(this.sharedKey, bytes);
            const inner = JSON.parse(new TextDecoder().decode(plainBuf));
            this._emit('data', inner);
          } catch {
            console.warn('[project-a] Decrypt failed — key mismatch?');
          }
          break;
        }
      }
    };
    channel.onclose = () => this._emit('channel-closed');
    channel.onerror = (e) => this._emit('error', { message: String(e) });
  }
  // ─── Signaling handler (perfect negotiation) ─────────────────────────────────
  async handleSignal(payload) {
    if (!this.pc) return;
    try {
      if (payload.type === 'description') {
        const description = payload.sdp;
        const readyForOffer =
          !this._makingOffer &&
          (this.pc.signalingState === 'stable' || this._isSettingRemoteAnswerPending);
        const offerCollision = description.type === 'offer' && !readyForOffer;

        // Impolite peer ignores the colliding offer; polite peer rolls back.
        this._ignoreOffer = !this._polite && offerCollision;
        if (this._ignoreOffer) return;

        this._isSettingRemoteAnswerPending = description.type === 'answer';
        await this.pc.setRemoteDescription(description);
        this._isSettingRemoteAnswerPending = false;
        this.remoteSet = true;
        await this._flushPendingIce();

        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.signaling.sendSignal({ type: 'description', sdp: this.pc.localDescription });
        }
      } else if (payload.type === 'ice-candidate') {
        if (!this.remoteSet) {
          this.pendingIce.push(payload.candidate);
          return;
        }
        try {
          await this.pc.addIceCandidate(payload.candidate);
        } catch (e) {
          if (!this._ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('[omni] signaling error:', e.message);
    }
  }
  async _flushPendingIce() {
    for (const c of this.pendingIce) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (e) {
        if (!this._ignoreOffer) console.warn('[omni] addIceCandidate failed:', e.message);
      }
    }
    this.pendingIce = [];
  }
  // ─── Messaging ──────────────────────────────────────────────────────────────
  async send(data) {
    if (!this.sharedKey || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Secure channel not ready');
    }
    const encrypted = await encrypt(this.sharedKey, JSON.stringify(data));
    this.dataChannel.send(JSON.stringify({ type: 'encrypted', data: uint8ToBase64(encrypted) }));
  }
  // ─── File sending (Fix 2: backpressure) ──────────────────────────────────────
  /**
   * Send a file in 64KB AES-GCM encrypted chunks.
   *
   * BACKPRESSURE: Before sending each chunk, we check bufferedAmount.
   * If the DataChannel's internal buffer exceeds BUFFER_HIGH (16MB),
   * we pause and wait for the 'bufferedamountlow' event (fires at 4MB).
   * This prevents the buffer from bloating and the browser from killing
   * the connection when upload speed << encryption speed.
   */
  async sendFile(file, { fileId = (Math.random() * 0xffffffff) >>> 0, startIndex = 0 } = {}) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    // file-meta carries the SHA-256 of the whole file plus a fileId so multiple
    // transfers can be multiplexed over the one ordered DataChannel. The meta is
    // only (re)sent at the start of a transfer, not when resuming.
    if (startIndex === 0) {
      const hash = await sha256(await file.arrayBuffer());
      await this.send({
        type: 'file-meta',
        fileId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        hash,
        chunks: totalChunks,
      });
    }
    let chunkIndex = startIndex;
    let offset = startIndex * CHUNK_SIZE;
    while (offset < file.size) {
      // ── Backpressure check ──────────────────────────────────────────────────
      if (this.dataChannel.bufferedAmount > BUFFER_HIGH) {
        await new Promise(resolve => {
          // bufferedamountlow fires when buffer drains to BUFFER_LOW (4MB)
          this.dataChannel.addEventListener('bufferedamountlow', resolve, { once: true });
        });
      }
      // ── Encrypt and send chunk ───────────────────────────────────────────────
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      const encrypted = await encrypt(this.sharedKey, new Uint8Array(buffer));
      // Binary frame layout: [4B fileId LE][4B chunkIndex LE][encrypted chunk]
      const frame = new Uint8Array(8 + encrypted.byteLength);
      const dv = new DataView(frame.buffer);
      dv.setUint32(0, fileId, true);
      dv.setUint32(4, chunkIndex, true);
      frame.set(encrypted, 8);
      this.dataChannel.send(frame.buffer);
      offset += CHUNK_SIZE;
      chunkIndex += 1;
      this._emit('file-send-progress', { fileId, name: file.name, sent: chunkIndex, total: totalChunks });
    }
  }
  // ─── Media controls ─────────────────────────────────────────────────────────
  toggleAudio(enabled) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = enabled; });
  }
  toggleVideo(enabled) {
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = enabled; });
  }
  async replaceVideoTrack(newTrack) {
    const sender = this.pc?.getSenders().find(s => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
  }
  /**
   * Adapt outgoing video encoding to the measured connection quality.
   * level: 'good' | 'fair' | 'poor'. Lower levels cap bitrate and scale the
   * resolution down so the call stays fluid on weak links.
   */
  async setSendQuality(level) {
    const sender = this.pc?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    const map = {
      good: { maxBitrate: undefined, scaleResolutionDownBy: 1 },
      fair: { maxBitrate: 600_000,  scaleResolutionDownBy: 1.5 },
      poor: { maxBitrate: 200_000,  scaleResolutionDownBy: 3 },
    };
    const cfg = map[level] || map.good;
    params.encodings[0].maxBitrate = cfg.maxBitrate;
    params.encodings[0].scaleResolutionDownBy = cfg.scaleResolutionDownBy;
    try { await sender.setParameters(params); } catch { /* unsupported — ignore */ }
  }
  // ─── Cleanup ─────────────────────────────────────────────────────────────────
  hangup() {
    this.localStream?.getTracks().forEach(t => t.stop());
    this.dataChannel?.close();
    this.pc?.close();
    this.sharedKey = null;
    this.localStream = null;
  }
  // ─── Internal ───────────────────────────────────────────────────────────────
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}