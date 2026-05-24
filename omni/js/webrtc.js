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
   */
  constructor(signalingClient, isInitiator, iceServers) {
    super();
    this.signaling = signalingClient;
    this.isInitiator = isInitiator;
    this.iceServers = iceServers;
    this.pc = null;
    this.dataChannel = null;
    this.localStream = null;
    this.keyPair = null;
    this.sharedKey = null;
    this.pendingIce = [];
    this.remoteSet = false;
    // ICE restart state — prevent concurrent restarts
    this._iceRestartInProgress = false;
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
    // DataChannel
    if (this.isInitiator) {
      this.dataChannel = this.pc.createDataChannel('project-a', { ordered: true });
      this._setupDataChannel(this.dataChannel);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signaling.sendSignal({ type: 'offer', sdp: offer });
    } else {
      this.pc.ondatachannel = ({ channel }) => {
        this.dataChannel = channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }
  // ─── ICE restart (bonus fix) ─────────────────────────────────────────────────
  async _attemptIceRestart() {
    // Only initiator drives ICE restart to avoid both peers restarting simultaneously
    if (!this.isInitiator || this._iceRestartInProgress) return;
    if (!this.pc || this.pc.signalingState === 'closed') return;
    this._iceRestartInProgress = true;
    this._emit('ice-restarting');
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      this.signaling.sendSignal({ type: 'offer', sdp: offer });
    } catch (e) {
      console.warn('[project-a] ICE restart failed to initiate:', e.message);
      this._iceRestartInProgress = false;
    }
  }
  // ─── DataChannel setup ──────────────────────────────────────────────────────
  _setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';
    // Set low watermark so bufferedamountlow fires at the right level
    channel.bufferedAmountLowThreshold = BUFFER_LOW;
    channel.onopen = async () => {
      const pubKey = await exportPublicKey(this.keyPair);
      channel.send(JSON.stringify({ type: 'pubkey', key: pubKey }));
    };
    channel.onmessage = async ({ data }) => {
      if (data instanceof ArrayBuffer) {
        this._emit('file-chunk', { data });
        return;
      }
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      switch (msg.type) {
        case 'pubkey': {
          const peerPubKey = await importPublicKey(msg.key);
          this.sharedKey = await deriveSharedKey(this.keyPair.privateKey, peerPubKey);
          this._emit('secure-channel-ready');
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
  // ─── Signaling handler ──────────────────────────────────────────────────────
  async handleSignal(payload) {
    switch (payload.type) {
      case 'offer': {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        this.remoteSet = true;
        await this._flushPendingIce();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signaling.sendSignal({ type: 'answer', sdp: answer });
        break;
      }
      case 'answer': {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        this.remoteSet = true;
        await this._flushPendingIce();
        break;
      }
      case 'ice-candidate': {
        if (this.remoteSet) {
          await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          this.pendingIce.push(payload.candidate);
        }
        break;
      }
    }
  }
  async _flushPendingIce() {
    for (const c of this.pendingIce) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c));
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
  async sendFile(file) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    // Compute SHA-256 of the full file upfront.
    // NOTE: file.arrayBuffer() loads the entire file into RAM here.
    // This is acceptable on the sender side (they picked the file deliberately).
    // The receiver-side RAM issue is what Fix 1 addresses.
    const hash = await sha256(await file.arrayBuffer());
    await this.send({
      type: 'file-meta',
      name: file.name,
      size: file.size,
      mimeType: file.type,
      hash,
      chunks: totalChunks,
    });
    let offset = 0;
    let chunkIndex = 0;
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
      // Binary frame layout: [4 bytes: chunk index (LE uint32)][encrypted chunk]
      const frame = new Uint8Array(4 + encrypted.byteLength);
      new DataView(frame.buffer).setUint32(0, chunkIndex, true);
      frame.set(encrypted, 4);
      this.dataChannel.send(frame.buffer);
      offset += CHUNK_SIZE;
      chunkIndex += 1;
      this._emit('file-send-progress', { name: file.name, sent: chunkIndex, total: totalChunks });
    }
  }
  // ─── Media controls ─────────────────────────────────────────────────────────
  toggleAudio(enabled) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = enabled; });
  }
  toggleVideo(enabled) {
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = enabled; });
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