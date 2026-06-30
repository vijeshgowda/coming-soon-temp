/**
 * Omni — Main Application
 */

import { CONFIG } from './config.js';
import { SignalingClient } from './signaling.js';
import { PeerConnection } from './webrtc.js';
import { sha256, decrypt, IncrementalSHA256 } from './crypto.js';
import { ensureAudioContext, playJoinTone, playMessageTone, playHangupTone, getQualityLevel } from './sounds.js';
import { CallRecorder } from './recorder.js';
import { makeQrSvg } from './qrcode.js';
import { t, applyTranslations, setLanguage, getLanguage, LANGUAGES } from './i18n.js';

// ─── State ────────────────────────────────────────────────────────────────────

let signaling   = null;
let peer        = null;
let localStream = null;
let remoteStream = null;

// Room password — folded into key derivation so both peers must share it
let roomPassword = '';
// __verify handshake: ensures both sides derived the same key (matching password)
let verifyTimeout = null;
let channelVerified = false;

// Local recording
let recorder = null;

// Adaptive bitrate — remember last applied level (hysteresis)
let lastQualityLevel = 'good';

// Mic level meter / muted-while-talking nudge
let micAudioCtx   = null;
let micAnalyser   = null;
let micRafId      = null;
let mutedNudgeShownAt = 0;

// Focus to restore when the safety-number dialog closes (a11y)
let sasPrevFocus = null;

// Call timer state
let callTimerInterval = null;
let callStartTime     = null;

// Screen sharing state
let screenStream  = null;
let screenSharing = false;

// Typing indicator state
let typingTimeout    = null;
let typingSendTimer  = null;

// Signal buffer — queues offers/answers/ICE that arrive before peer is ready
let pendingSignals = [];

// Connection quality stats
let statsInterval = null;
let prevBytesReceived = 0;
let prevTimestamp = 0;

// File send queue
let fileQueue = [];
let fileSending = false;

// Incoming file transfers, keyed by fileId so several can be multiplexed over
// the single ordered DataChannel at once.
const fileReceives = new Map();

function newFileReceiveState() {
  return {
    meta:       null,
    chunks:     [],
    useStream:  false,
    fileHandle: null,
    writable:   null,
    hasher:     null,
    received:   0,
  };
}

// ─── UI Elements ─────────────────────────────────────────────────────────────

const screens = {
  home:  document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  call:  document.getElementById('screen-call'),
};

const ui = {
  btnCreate:        document.getElementById('btn-create'),
  btnJoinSubmit:    document.getElementById('btn-join-submit'),
  joinInput:        document.getElementById('join-input'),
  homeError:        document.getElementById('home-error'),
  lobbyCode:        document.getElementById('lobby-code'),
  lobbyStatus:      document.getElementById('lobby-status'),
  btnCopyCode:      document.getElementById('btn-copy-code'),
  btnLobbyCancel:   document.getElementById('btn-lobby-cancel'),
  localVideo:       document.getElementById('local-video'),
  remoteVideo:      document.getElementById('remote-video'),
  remoteAvatar:     document.getElementById('remote-avatar'),
  btnMute:          document.getElementById('btn-mute'),
  btnCamera:        document.getElementById('btn-camera'),
  btnHangup:        document.getElementById('btn-hangup'),
  connectionBadge:  document.getElementById('connection-badge'),
  chatMessages:     document.getElementById('chat-messages'),
  chatInput:        document.getElementById('chat-input'),
  btnSend:          document.getElementById('btn-send'),
  encryptedBadge:   document.getElementById('encrypted-badge'),
  fileInput:        document.getElementById('file-input'),
  fileProgress:     document.getElementById('file-progress'),
  btnCustomToggle:  document.getElementById('btn-custom-toggle'),
  customCodeWrap:   document.getElementById('custom-code-wrap'),
  customCodeInput:  document.getElementById('custom-code-input'),
  btnScreen:        document.getElementById('btn-screen'),
  btnFlip:          document.getElementById('btn-flip'),
  btnPiP:           document.getElementById('btn-pip'),
  callTimer:        document.getElementById('call-timer'),
  qualityBadge:     document.getElementById('quality-badge'),
  typingIndicator:  document.getElementById('typing-indicator'),
  // Progress bar
  connectingState:  document.getElementById('connecting-state'),
  connectingText:   document.getElementById('connecting-text'),
  // Password
  roomPassword:     document.getElementById('room-password'),
  // Safety number (SAS) panel
  sasPanel:         document.getElementById('sas-panel'),
  sasEmoji:         document.getElementById('sas-emoji'),
  sasCode:          document.getElementById('sas-code'),
  btnSasOk:         document.getElementById('btn-sas-ok'),
  btnSasBad:        document.getElementById('btn-sas-bad'),
  // Recording
  btnRecord:        document.getElementById('btn-record'),
  // Clear chat
  btnClearChat:     document.getElementById('btn-clear-chat'),
  // Mic meter + muted nudge
  micMeter:         document.getElementById('mic-meter'),
  micMeterFill:     document.getElementById('mic-meter-fill'),
  mutedNudge:       document.getElementById('muted-nudge'),
  // Drop overlay
  dropOverlay:      document.getElementById('drop-overlay'),
  // Lobby share
  lobbyLink:        document.getElementById('lobby-link'),
  btnShareLink:     document.getElementById('btn-share-link'),
  qrContainer:      document.getElementById('qr-container'),
};

// ─── Screen transitions ───────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// Screen-reader announcement for events without their own visible live region.
function announce(msg) {
  const el = document.getElementById('sr-announcer');
  if (!el) return;
  el.textContent = '';
  // Reset then set on the next frame so identical consecutive messages re-announce.
  requestAnimationFrame(() => { el.textContent = msg; });
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function showConnecting(text = 'Connecting to server…') {
  // Reset animation so it starts fresh on every attempt
  const fill = document.querySelector('.progress-fill');
  fill.style.animation = 'none';
  fill.offsetHeight; // force reflow — without this the reset won't take
  fill.style.animation = '';

  ui.connectingText.textContent  = text;
  ui.connectingState.style.display = 'flex';
  ui.btnCreate.disabled          = true;
  ui.btnJoinSubmit.disabled      = true;
  ui.btnCreate.style.opacity     = '0.5';
  ui.btnJoinSubmit.style.opacity = '0.5';
}

function hideConnecting() {
  ui.connectingState.style.display = 'none';
  ui.btnCreate.disabled            = false;
  ui.btnJoinSubmit.disabled        = false;
  ui.btnCreate.style.opacity       = '';
  ui.btnJoinSubmit.style.opacity   = '';
}

// ─── Connection setup ─────────────────────────────────────────────────────────

async function connectSignaling() {
  signaling = new SignalingClient(CONFIG.SIGNALING_URL);
  signaling.phase = 'idle';

  signaling.addEventListener('signal', ({ detail }) => {
    if (peer?.pc) {
      peer.handleSignal(detail.payload);
    } else {
      pendingSignals.push(detail.payload);
    }
  });

  signaling.addEventListener('peer-joined', async () => {
    ui.lobbyStatus.textContent = t('lobby.peer_found');
    playJoinTone();
    await startCall(true);
  });

  signaling.addEventListener('peer-left', () => {
    appendSystemMessage(t('sys.peer_disconnected'));
    playHangupTone();
    setTimeout(resetToHome, 3000);
  });

  signaling.addEventListener('reconnecting', ({ detail }) => {
    if (signaling.phase === 'lobby') {
      ui.lobbyStatus.textContent =
        t('lobby.reconnecting', { attempt: detail.attempt, max: detail.max });
    }
  });

  signaling.addEventListener('reconnect-failed', () => {
    if (signaling.phase === 'lobby') {
      showHomeError(t('err.reconnect_failed'));
      showScreen('home');
    }
  });

  // Persistent 'created' listener — handles every room creation:
  //   1. Initial create (phase 'idle' → 'lobby', show lobby screen)
  //   2. rejoin-failed fallback: createRoom() produced a fresh code while in lobby
  signaling.addEventListener('created', ({ detail }) => {
    const wasInLobby = signaling.phase === 'lobby';
    signaling.phase    = 'lobby';
    signaling.roomCode = detail.code;
    ui.lobbyCode.textContent = detail.code;
    ui.lobbyCode.classList.toggle('custom-code', !!detail.custom);
    updateLobbyShare(detail.code);
    if (wasInLobby) {
      ui.lobbyStatus.textContent = t('lobby.new_room');
    } else {
      ui.lobbyStatus.textContent = detail.custom
        ? t('lobby.custom_ready')
        : t('lobby.waiting');
    }
    hideConnecting();
    showScreen('lobby');
  });

  // Rejoin succeeded — same code, no disruption
  signaling.addEventListener('rejoined', ({ detail }) => {
    signaling.phase    = 'lobby';
    signaling.roomCode = detail.code;
    ui.lobbyCode.textContent   = detail.code;
    ui.lobbyStatus.textContent = t('lobby.reconnected');
    ui.lobbyCode.classList.toggle('custom-code', !!detail.custom);
    updateLobbyShare(detail.code);
    hideConnecting();
    showScreen('lobby');
  });

  // Rejoin failed (grace window expired) — transparently create a fresh room
  signaling.addEventListener('rejoin-failed', () => {
    ui.lobbyStatus && (ui.lobbyStatus.textContent = t('lobby.session_expired'));
    signaling.createRoom(signaling._customCode || '');
  });

  signaling.addEventListener('error', ({ detail }) => {
    showHomeError(detail.message);
    hideConnecting();
    if (signaling.phase !== 'call') showScreen('home');
  });

  signaling.addEventListener('disconnected', () => {
    hideConnecting();
  });

  await signaling.connect();
}

// Reveals the call controls and re-arms the auto-hide timer. Assigned by the
// controls auto-hide module below; a no-op until then.
let revealControls = () => {};

async function startCall(asInitiator) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch {
    // Fall back to audio-only (no camera, or camera busy) before giving up.
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      appendSystemMessage(t('sys.audio_only'));
    } catch {
      signaling?.disconnect();
      showHomeError(t('err.permissions'));
      showScreen('home');
      return;
    }
  }
  ui.localVideo.srcObject = localStream;

  // Guard: signaling may have been torn down while getUserMedia dialog was open
  if (!signaling) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    return;
  }

  signaling.phase = 'call';

  peer = new PeerConnection(signaling, asInitiator, CONFIG.ICE_SERVERS, roomPassword);

  peer.addEventListener('remote-stream', ({ detail }) => {
    remoteStream = detail.stream;
    ui.remoteVideo.srcObject = detail.stream;
    ui.remoteAvatar.style.display = 'none';
    ui.remoteVideo.style.display  = 'block';
  });


  peer.addEventListener('secure-channel-ready', ({ detail }) => {
    ui.encryptedBadge.classList.add('active');
    appendSystemMessage(t('sys.channel_ready'));
    showSafetyNumber(detail?.safety);
    startVerifyHandshake();
    startCallTimer();
    startStatsPolling();
    startMicMeter();
  });

  peer.addEventListener('connection-state', ({ detail }) => {
    updateConnectionBadge(detail.state);
  });

  peer.addEventListener('ice-state', ({ detail }) => {
    if (detail.state === 'connected' || detail.state === 'completed') {
      updateConnectionBadge('connected');
      // Fallback: start timer on ICE connected if secure-channel-ready hasn't fired yet
      startCallTimer();
      startStatsPolling();
    }
  });

  peer.addEventListener('ice-restarting', () => {
    updateConnectionBadge('reconnecting');
    appendSystemMessage(t('sys.network_changed'));
  });

  peer.addEventListener('data',       ({ detail }) => handleIncomingData(detail));
  peer.addEventListener('file-chunk', ({ detail }) => handleFileChunk(detail.data));

  peer.addEventListener('file-send-progress', ({ detail }) => {
    const pct = Math.round((detail.sent / detail.total) * 100);
    ui.fileProgress.textContent = t('file.sending', { name: detail.name, pct });
    if (pct === 100) setTimeout(() => { ui.fileProgress.textContent = ''; }, 2000);
  });

  peer.addEventListener('error', ({ detail }) => {
    appendSystemMessage(`⚠️ ${detail.message}`);
  });

  try {
    await peer.initialize(localStream);
  } catch (e) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    peer = null;
    signaling?.disconnect();
    showHomeError(t('err.connect_failed'));
    showScreen('home');
    return;
  }

  // Flush any signals (offer/answer/ICE) that arrived while getUserMedia dialog was open
  for (const payload of pendingSignals) {
    await peer.handleSignal(payload);
  }
  pendingSignals = [];

  showScreen('call');
  revealControls();
}

// ─── File receive ─────────────────────────────────────────────────────────────

async function initFileReceive(meta) {
  const fileId = meta.fileId ?? 0;
  const rx = newFileReceiveState();
  rx.meta = meta;
  fileReceives.set(fileId, rx);

  if ('showSaveFilePicker' in window) {
    try {
      const ext = meta.name.includes('.') ? meta.name.split('.').pop() : undefined;
      rx.fileHandle = await window.showSaveFilePicker({
        suggestedName: meta.name,
        types: ext ? [{ accept: { [meta.mimeType || 'application/octet-stream']: [`.${ext}`] } }] : undefined,
      });
      rx.writable  = await rx.fileHandle.createWritable();
      rx.useStream = true;
      rx.chunks    = [];
      rx.hasher    = new IncrementalSHA256();
      appendSystemMessage(t('sys.rx_streaming', { name: meta.name, size: formatBytes(meta.size) }));
      return;
    } catch (e) {
      if (e.name === 'AbortError') {
        appendSystemMessage(t('sys.save_cancelled'));
      }
    }
  }

  rx.useStream = false;
  rx.chunks    = new Array(meta.chunks);
  if (meta.size > 500 * 1024 * 1024) {
    appendSystemMessage(t('sys.rx_large_warn', { size: formatBytes(meta.size) }));
  } else {
    appendSystemMessage(t('sys.rx_receiving', { name: meta.name, size: formatBytes(meta.size) }));
  }
}

async function handleFileChunk(buffer) {
  // Frame layout: [4B fileId LE][4B chunkIndex LE][encrypted chunk]
  const view       = new DataView(buffer);
  const fileId     = view.getUint32(0, true);
  const chunkIndex = view.getUint32(4, true);
  const rx         = fileReceives.get(fileId);
  if (!rx || !rx.meta) return; // chunk for an unknown/finished transfer

  const encrypted  = buffer.slice(8);
  const plainBuf   = await decrypt(peer.sharedKey, new Uint8Array(encrypted));
  const bytes      = new Uint8Array(plainBuf);

  rx.received++;

  if (rx.useStream) {
    await rx.writable.write(bytes);
    rx.hasher.update(bytes);
  } else {
    rx.chunks[chunkIndex] = bytes;
  }

  const pct = Math.round((rx.received / rx.meta.chunks) * 100);
  ui.fileProgress.textContent = t('file.receiving', { name: rx.meta.name, pct });

  if (rx.received === rx.meta.chunks) await finalizeFile(fileId);
}

async function finalizeFile(fileId) {
  const rx = fileReceives.get(fileId);
  if (!rx) return;
  const { name, size, mimeType, hash } = rx.meta;
  ui.fileProgress.textContent = '';

  if (rx.useStream) {
    await rx.writable.close();
    const receivedHash = rx.hasher.digest();
    if (receivedHash !== hash) {
      appendSystemMessage(t('sys.integrity_fail_saved', { name }));
    } else {
      appendSystemMessage(t('sys.saved_verified', { name }));
    }
  } else {
    const merged       = mergeChunks(rx.chunks, size);
    const receivedHash = await sha256(merged);
    if (receivedHash !== hash) {
      appendSystemMessage(t('sys.integrity_fail', { name }));
      fileReceives.delete(fileId);
      return;
    }
    const blob = new Blob([merged], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    appendFileDownload(name, url, size, mimeType);
  }

  fileReceives.delete(fileId);
}

function mergeChunks(chunks, totalSize) {
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
}

async function resetFileReceiveState() {
  for (const rx of fileReceives.values()) {
    if (rx.writable) { try { await rx.writable.abort(); } catch { /* ignore */ } }
  }
  fileReceives.clear();
}

// ─── Incoming data ────────────────────────────────────────────────────────────

function handleIncomingData(msg) {
  switch (msg.type) {
    case 'chat':
      appendChatMessage(t('chat.peer'), String(msg.text ?? '').slice(0, 4000), 'remote');
      playMessageTone();
      break;
    case 'file-meta': initFileReceive(msg); break;
    case 'typing':    showTypingIndicator(); break;
    // Password verification handshake — see startVerifyHandshake().
    case '__verify':   peer?.send({ type: '__verified' }).catch(() => {}); break;
    case '__verified': markChannelVerified(); break;
  }
}

// ─── Password verification handshake ───────────────────────────────────────────
//
// Both peers exchange ECDH public keys regardless of password, so the secure
// channel "establishes" even when passwords differ — only the AES layer silently
// fails. To surface a wrong password quickly, each side sends an encrypted
// {__verify} ping; if the keys match, the peer can decrypt it and replies
// {__verified}. No reply within the timeout ⇒ password mismatch.

function startVerifyHandshake() {
  if (!roomPassword) { channelVerified = true; return; } // nothing to verify
  channelVerified = false;
  clearTimeout(verifyTimeout);
  peer?.send({ type: '__verify' }).catch(() => {});
  verifyTimeout = setTimeout(() => {
    if (!channelVerified) {
      appendSystemMessage(t('sys.wrong_password'));
      setTimeout(resetToHome, 2500);
    }
  }, 7000);
}

function markChannelVerified() {
  if (channelVerified) return;
  channelVerified = true;
  clearTimeout(verifyTimeout);
  verifyTimeout = null;
}

// ─── Safety number (SAS) ───────────────────────────────────────────────────────

function showSafetyNumber(safety) {
  if (!safety || !ui.sasPanel) return;
  ui.sasEmoji.textContent = safety.emoji;
  ui.sasCode.textContent  = safety.code;
  ui.sasPanel.classList.add('visible');
  // a11y: remember where focus was, move it into the dialog.
  sasPrevFocus = document.activeElement;
  ui.btnSasOk?.focus();
}

function hideSafetyNumber() {
  ui.sasPanel?.classList.remove('visible');
  if (sasPrevFocus && typeof sasPrevFocus.focus === 'function') {
    try { sasPrevFocus.focus(); } catch { /* element gone */ }
  }
  sasPrevFocus = null;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function appendChatMessage(sender, text, side) {
  const div = document.createElement('div');
  div.className = `message ${side}`;
  div.innerHTML = `<span class="sender">${sender}</span><p>${escapeHtml(text)}</p>`;
  ui.chatMessages.appendChild(div);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'message system';
  div.textContent = text;
  ui.chatMessages.appendChild(div);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

function appendFileDownload(name, url, size, mimeType) {
  const div = document.createElement('div');
  div.className = 'message remote';

  let previewHtml = '';
  if (mimeType && mimeType.startsWith('image/')) {
    previewHtml = `<img class="chat-preview" src="${url}" alt="${escapeHtml(name)}" />`;
  } else if (mimeType && mimeType.startsWith('video/')) {
    previewHtml = `<video class="chat-preview" src="${url}" controls playsinline></video>`;
  }

  div.innerHTML = `
    <span class="sender">File received ✓</span>
    ${previewHtml}
    <a class="file-download" href="${url}" download="${escapeHtml(name)}">
      <span class="file-icon">📄</span>
      <span>${escapeHtml(name)}</span>
      <span class="file-size">${formatBytes(size)}</span>
    </a>`;
  ui.chatMessages.appendChild(div);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

async function sendChat() {
  const text = ui.chatInput.value.trim();
  if (!text || !peer) return;
  try {
    await peer.send({ type: 'chat', text });
    appendChatMessage(t('chat.you'), text, 'local');
    ui.chatInput.value = '';
  } catch {
    appendSystemMessage(t('sys.send_failed_notready'));
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────

let audioEnabled = true;
let videoEnabled = true;

function toggleMute() {
  audioEnabled = !audioEnabled;
  peer?.toggleAudio(audioEnabled);
  ui.btnMute.classList.toggle('active', !audioEnabled);
  if (audioEnabled) hideMutedNudge();
}

// ─── Mic level meter + "you're muted" nudge ──────────────────────────────────────

function startMicMeter() {
  const track = localStream?.getAudioTracks?.()[0];
  if (!track || micAnalyser) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    micAudioCtx = new AudioCtx();
    const source = micAudioCtx.createMediaStreamSource(new MediaStream([track]));
    micAnalyser = micAudioCtx.createAnalyser();
    micAnalyser.fftSize = 512;
    source.connect(micAnalyser);
    const buf = new Uint8Array(micAnalyser.fftSize);
    const tick = () => {
      micAnalyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);     // 0..~1
      const level = Math.min(1, rms * 3);          // visual gain
      if (ui.micMeterFill) ui.micMeterFill.style.width = `${Math.round(level * 100)}%`;
      // Speaking while muted? Nudge (throttled to once per ~4s).
      if (!audioEnabled && rms > 0.06) {
        if (Date.now() - mutedNudgeShownAt > 4000) showMutedNudge();
      }
      micRafId = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* meter unavailable — non-fatal */ }
}

function stopMicMeter() {
  if (micRafId) cancelAnimationFrame(micRafId);
  micRafId = null;
  try { micAudioCtx?.close(); } catch { /* ignore */ }
  micAudioCtx = null;
  micAnalyser = null;
  if (ui.micMeterFill) ui.micMeterFill.style.width = '0%';
}

function showMutedNudge() {
  mutedNudgeShownAt = Date.now();
  if (!ui.mutedNudge) return;
  ui.mutedNudge.classList.add('visible');
  clearTimeout(showMutedNudge._t);
  showMutedNudge._t = setTimeout(hideMutedNudge, 3000);
}

function hideMutedNudge() {
  ui.mutedNudge?.classList.remove('visible');
}

function toggleCamera() {
  videoEnabled = !videoEnabled;
  peer?.toggleVideo(videoEnabled);
  ui.btnCamera.classList.toggle('active', !videoEnabled);
  ui.localVideo.style.opacity = videoEnabled ? '1' : '0.3';
}

async function toggleScreenShare() {
  if (screenSharing) {
    stopScreenShare();
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    appendSystemMessage(t('sys.screen_unsupported'));
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    await peer.replaceVideoTrack(screenTrack);
    ui.localVideo.srcObject = screenStream;
    screenSharing = true;
    ui.btnScreen.classList.add('active');
    ui.btnScreen.querySelector('.ctrl-label').textContent = t('ctrl.stop');
    screenTrack.onended = () => stopScreenShare();
  } catch {
    // User cancelled the picker — do nothing
  }
}

function stopScreenShare() {
  if (!screenSharing) return;
  screenStream?.getTracks().forEach(t => t.stop());
  screenStream = null;
  screenSharing = false;
  const camTrack = localStream?.getVideoTracks()[0];
  if (camTrack) peer?.replaceVideoTrack(camTrack);
  ui.localVideo.srcObject = localStream;
  ui.btnScreen.classList.remove('active');
  ui.btnScreen.querySelector('.ctrl-label').textContent = t('ctrl.screen');
}

// ─── Flip Camera ──────────────────────────────────────────────────────────────

let facingMode = 'user';

async function flipCamera() {
  if (screenSharing) return; // don't flip while screen sharing
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: false,
    });
    const newTrack = newStream.getVideoTracks()[0];
    // Stop old video track
    const oldTrack = localStream.getVideoTracks()[0];
    if (oldTrack) oldTrack.stop();
    // Replace in localStream
    localStream.removeTrack(oldTrack);
    localStream.addTrack(newTrack);
    // Replace in peer connection
    await peer?.replaceVideoTrack(newTrack);
    // Update local preview
    ui.localVideo.srcObject = localStream;
    // Mirror only front camera
    ui.localVideo.classList.toggle('no-mirror', facingMode === 'environment');
  } catch {
    // Camera not available — revert
    facingMode = facingMode === 'user' ? 'environment' : 'user';
  }
}

// ─── Call Timer ───────────────────────────────────────────────────────────────

function startCallTimer() {
  if (callTimerInterval) return; // already running
  callStartTime = Date.now();
  ui.callTimer.textContent = '00:00';
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    ui.callTimer.textContent = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

function stopCallTimer() {
  clearInterval(callTimerInterval);
  callTimerInterval = null;
  callStartTime = null;
  ui.callTimer.textContent = '00:00';
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function sendTypingIndicator() {
  if (!peer || !peer.sharedKey) return;
  if (typingSendTimer) return; // already sent recently — debounce
  peer.send({ type: 'typing' }).catch(() => {});
  typingSendTimer = setTimeout(() => { typingSendTimer = null; }, 2000);
}

function showTypingIndicator() {
  ui.typingIndicator.style.display = 'flex';
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    ui.typingIndicator.style.display = 'none';
  }, 3000);
}

function hangup() {
  playHangupTone();
  peer?.hangup();
  signaling?.disconnect();
  resetToHome();
}

function resetToHome() {
  peer?.hangup();
  signaling?.disconnect();
  stopScreenShare();
  stopRecordingIfActive();
  stopCallTimer();
  stopStatsPolling();
  stopMicMeter();
  clearTimeout(verifyTimeout);
  verifyTimeout = null;
  channelVerified = false;
  pendingSignals = [];
  fileQueue = [];
  fileSending = false;
  localStream = null;
  remoteStream = null;
  peer        = null;
  signaling   = null;
  audioEnabled = true;
  videoEnabled = true;
  lastQualityLevel = 'good';
  ui.localVideo.srcObject  = null;
  ui.remoteVideo.srcObject = null;
  ui.chatMessages.innerHTML = '';
  ui.encryptedBadge.classList.remove('active');
  ui.typingIndicator.style.display = 'none';
  ui.sasPanel?.classList.remove('visible');
  hideMutedNudge();
  hideConnecting();
  resetFileReceiveState();
  showScreen('home');
}

function updateConnectionBadge(state) {
  const badge = ui.connectionBadge;
  badge.className = `badge connection-badge ${state}`;
  const symbols = {
    connected:    '●',
    reconnecting: '◌',
    connecting:   '○',
    disconnected: '○',
    failed:       '✕',
    new:          '○',
  };
  badge.textContent = symbols[state]
    ? `${symbols[state]} ${t('conn.' + state)}`
    : state;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function showHomeError(msg) {
  ui.homeError.textContent    = msg;
  ui.homeError.style.display  = 'block';
  hideConnecting();
  setTimeout(() => { ui.homeError.style.display = 'none'; }, 6000);
}

function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ─── Local recording ──────────────────────────────────────────────────────────

async function toggleRecording() {
  if (recorder?.recording) {
    await stopRecordingIfActive();
    return;
  }
  if (!CallRecorder.isSupported()) {
    appendSystemMessage(t('sys.record_unsupported'));
    return;
  }
  try {
    recorder = new CallRecorder();
    recorder.start({
      remoteVideo: ui.remoteVideo,
      localVideo:  ui.localVideo,
      remoteStream,
      localStream,
    });
    ui.btnRecord.classList.add('active');
    ui.btnRecord.querySelector('.ctrl-label').textContent = t('ctrl.stop');
    appendSystemMessage(t('sys.record_started'));
  } catch (e) {
    appendSystemMessage(t('sys.record_error', { error: e.message }));
    recorder = null;
  }
}

async function stopRecordingIfActive() {
  if (!recorder?.recording) return;
  const blob = await recorder.stop();
  recorder = null;
  ui.btnRecord.classList.remove('active');
  const label = ui.btnRecord.querySelector('.ctrl-label');
  if (label) label.textContent = t('ctrl.record');
  if (!blob) { appendSystemMessage(t('sys.record_nodata')); return; }
  const name = `omni-call-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
  await saveBlob(blob, name);
  appendSystemMessage(t('sys.record_saved', { size: formatBytes(blob.size) }));
}

async function saveBlob(blob, suggestedName) {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ accept: { 'video/webm': ['.webm'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ─── Chat housekeeping ─────────────────────────────────────────────────────────

function clearChat() {
  ui.chatMessages.innerHTML = '';
  appendSystemMessage(t('sys.chat_cleared'));
}

// ─── Share link + QR ───────────────────────────────────────────────────────────

function buildShareUrl(code) {
  return `${location.origin}${location.pathname}#${encodeURIComponent(code)}`;
}

function updateLobbyShare(code) {
  if (!code || code === '——————') return;
  const url = buildShareUrl(code);
  if (ui.lobbyLink) ui.lobbyLink.textContent = url;
  if (ui.qrContainer) {
    try { ui.qrContainer.innerHTML = makeQrSvg(url, { ecc: 'MEDIUM', border: 2 }); }
    catch { ui.qrContainer.innerHTML = ''; }
  }
}

async function shareLink() {
  const code = ui.lobbyCode.textContent;
  const url = buildShareUrl(code);
  if (navigator.share) {
    try { await navigator.share({ title: t('lobby.share_title'), text: t('lobby.share_text'), url }); return; }
    catch { /* user cancelled or unsupported — fall through to copy */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    ui.btnShareLink.textContent = t('lobby.link_copied');
    setTimeout(() => { ui.btnShareLink.textContent = t('lobby.share_link'); }, 2000);
  } catch { /* clipboard blocked */ }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

ui.btnCreate.addEventListener('click', async () => {
  ui.homeError.style.display = 'none';

  const customCode = ui.customCodeInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (customCode.length > 0 && (customCode.length < 4 || customCode.length > 10)) {
    showHomeError(t('err.custom_length'));
    ui.customCodeInput.focus();
    return;
  }

  roomPassword = ui.roomPassword?.value || '';

  showConnecting(t('home.connecting_cold'));

  try {
    await connectSignaling();
    signaling.createRoom(customCode);
  } catch {
    showHomeError(t('err.no_server'));
  }
});

ui.btnJoinSubmit.addEventListener('click', async () => {
  const code = ui.joinInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (code.length < 4 || code.length > 10) {
    showHomeError(t('err.invalid_code'));
    return;
  }
  ui.homeError.style.display = 'none';
  roomPassword = ui.roomPassword?.value || '';
  showConnecting(t('home.connecting_join'));
  try {
    await connectSignaling();
    signaling.addEventListener('joined', async () => {
      hideConnecting();
      await startCall(false);
    }, { once: true });
    signaling.joinRoom(code);
  } catch {
    showHomeError(t('err.no_server'));
  }
});

ui.joinInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') ui.btnJoinSubmit.click();
});

ui.btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(ui.lobbyCode.textContent);
  ui.btnCopyCode.textContent = t('lobby.copied');
  setTimeout(() => { ui.btnCopyCode.textContent = t('lobby.copy'); }, 2000);
});

ui.btnLobbyCancel.addEventListener('click', () => {
  signaling?.disconnect();
  signaling = null;
  showScreen('home');
});

ui.btnMute.addEventListener('click', toggleMute);
ui.btnCamera.addEventListener('click', toggleCamera);
ui.btnScreen.addEventListener('click', toggleScreenShare);
ui.btnFlip.addEventListener('click', flipCamera);
ui.btnHangup.addEventListener('click', hangup);
ui.btnSend.addEventListener('click', sendChat);
ui.btnRecord?.addEventListener('click', toggleRecording);
ui.btnClearChat?.addEventListener('click', clearChat);
ui.btnShareLink?.addEventListener('click', shareLink);
ui.btnSasOk?.addEventListener('click', () => hideSafetyNumber());
ui.btnSasBad?.addEventListener('click', () => {
  appendSystemMessage(t('sys.sas_mismatch'));
  setTimeout(resetToHome, 800);
});
ui.sasPanel?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); hideSafetyNumber(); }
});

ui.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

ui.chatInput.addEventListener('input', () => {
  if (ui.chatInput.value.trim()) sendTypingIndicator();
});

ui.fileInput.addEventListener('change', () => {
  const files = Array.from(ui.fileInput.files);
  if (!files.length || !peer) return;
  ui.fileInput.value = '';
  for (const file of files) fileQueue.push(file);
  processFileQueue();
});

// ─── Custom code toggle ───────────────────────────────────────────────────────

ui.btnCustomToggle.addEventListener('click', () => {
  const isOpen = ui.customCodeWrap.classList.toggle('open');
  ui.customCodeWrap.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  document.getElementById('custom-toggle-icon').textContent = isOpen ? '▾' : '▸';
  if (!isOpen) ui.customCodeInput.value = '';
});

// ─── File Queue ───────────────────────────────────────────────────────────────

async function processFileQueue() {
  // Each file gets its own fileId and is sent concurrently — the 8-byte frame
  // header lets the receiver demultiplex interleaved chunks. DataChannel
  // backpressure inside sendFile keeps the shared buffer from overflowing.
  while (fileQueue.length > 0) {
    const file = fileQueue.shift();
    const fileId = (Math.random() * 0xffffffff) >>> 0;
    appendSystemMessage(`📤 Sending "${file.name}" (${formatBytes(file.size)})…`);
    peer.sendFile(file, { fileId })
      .then(() => appendSystemMessage(`✓ Sent "${file.name}".`))
      .catch(err => appendSystemMessage(`❌ Send failed: ${err.message}`));
  }
}

// ─── Connection Quality ───────────────────────────────────────────────────────

function startStatsPolling() {
  if (statsInterval) return; // already running
  prevBytesReceived = 0;
  prevTimestamp = 0;
  statsInterval = setInterval(async () => {
    if (!peer?.pc) return;
    try {
      const stats = await peer.pc.getStats();
      let bytesReceived = 0;
      let packetsLost = 0;
      let packetsReceived = 0;
      let rtt = 0;
      let rttFound = false;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          bytesReceived = report.bytesReceived || 0;
          packetsLost = report.packetsLost || 0;
          packetsReceived = report.packetsReceived || 0;
        }
        if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          if (report.roundTripTime != null) {
            rtt = report.roundTripTime;
            rttFound = true;
          }
        }
        // Fallback: candidate-pair for RTT
        if (!rttFound && report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = (report.currentRoundTripTime || 0);
        }
      });

      const now = performance.now();
      let bitrate = 0;
      if (prevTimestamp > 0) {
        const elapsed = (now - prevTimestamp) / 1000;
        bitrate = ((bytesReceived - prevBytesReceived) * 8) / elapsed;
      }
      prevBytesReceived = bytesReceived;
      prevTimestamp = now;

      const packetLoss = packetsReceived > 0
        ? (packetsLost / (packetsReceived + packetsLost)) * 100
        : 0;

      const { level, label } = getQualityLevel({ bitrate, packetLoss, rtt });
      ui.qualityBadge.className = `badge quality-badge quality-${level}`;
      ui.qualityBadge.textContent = level === 'good' ? '●' : level === 'fair' ? '◐' : '○';
      ui.qualityBadge.title = label;

      // Adaptive bitrate — only nudge the encoder when the level actually changes
      // (avoids thrashing setParameters every poll).
      if (level !== lastQualityLevel) {
        lastQualityLevel = level;
        peer.setSendQuality(level).catch(() => {});
      }
    } catch { /* stats unavailable */ }
  }, 2000);
}

function stopStatsPolling() {
  clearInterval(statsInterval);
  statsInterval = null;
  prevBytesReceived = 0;
  prevTimestamp = 0;
  lastQualityLevel = 'good';
  ui.qualityBadge.className = 'badge quality-badge';
  ui.qualityBadge.textContent = '●';
  ui.qualityBadge.title = '';
}

// ─── Picture in Picture ───────────────────────────────────────────────────────

async function enterPiP() {
  const video = ui.remoteVideo;
  if (!video.srcObject || !peer) return;
  if (video.readyState < 2) return;
  try {
    if (document.pictureInPictureEnabled && !document.pictureInPictureElement) {
      await video.requestPictureInPicture();
    } else if (video.webkitSupportsPresentationMode?.('picture-in-picture')) {
      video.webkitSetPresentationMode('picture-in-picture');
    } else {
      appendSystemMessage(t('sys.pip_unsupported'));
    }
  } catch {
    appendSystemMessage(t('sys.pip_error'));
  }
}

async function exitPiP() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    if (ui.remoteVideo.webkitPresentationMode === 'picture-in-picture') {
      ui.remoteVideo.webkitSetPresentationMode('inline');
    }
  } catch { /* silent */ }
}

ui.btnPiP.addEventListener('click', () => {
  if (document.pictureInPictureElement) {
    exitPiP();
  } else {
    enterPiP();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!peer) return;
  document.hidden ? enterPiP() : exitPiP();
});

// ─── Draggable + tap-to-swap video windows ───────────────────────────────────
//
// Either feed can be the "stage" (full-bleed) or the "PiP" (small floating
// window). Tapping the PiP promotes it to the stage and demotes the other feed;
// dragging repositions it. The PiP is clamped to a safe area so it can never
// slide behind the controls bar or the status badges.

(function initVideoStage() {
  const area       = document.querySelector('.video-area');
  const localWrap  = document.querySelector('.local-video-wrap');
  const remoteWrap = document.querySelector('.remote-video-wrap');
  if (!area || !localWrap || !remoteWrap) return;

  let localIsStage = false;
  const currentPip = () => (localIsStage ? remoteWrap : localWrap);

  function setLocalStage(on) {
    if (on === localIsStage) return;
    localIsStage = on;
    area.classList.toggle('swapped', on);
    // Clear inline drag positioning so the CSS role rules take over cleanly.
    for (const el of [localWrap, remoteWrap]) {
      el.style.top = el.style.left = el.style.right = el.style.bottom = '';
      el.style.transition = '';
    }
  }

  // Reserve space for the controls bar (bottom) and badge row (top-right) so a
  // parked PiP never overlaps them.
  const PAD_X = 16;
  const TOP_PAD_LEFT = 16;
  const TOP_PAD_RIGHT = 56; // clears the badge row
  const bottomReserve = () => {
    const bar = document.querySelector('.controls-bar');
    return (bar ? bar.getBoundingClientRect().height : 80) + 14;
  };

  let dragging = false, moved = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  function onPointerDown(e) {
    const pip = currentPip();
    if (e.currentTarget !== pip) return;          // only the small window reacts
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    moved = false;
    pip.setPointerCapture?.(e.pointerId);
    const rect = pip.getBoundingClientRect();
    const parent = area.getBoundingClientRect();
    origLeft = rect.left - parent.left;
    origTop  = rect.top  - parent.top;
    pip.style.top    = `${origTop}px`;
    pip.style.left   = `${origLeft}px`;
    pip.style.right  = 'auto';
    pip.style.bottom = 'auto';
    pip.style.transition = 'none';
    startX = e.clientX;
    startY = e.clientY;
  }

  function onPointerMove(e) {
    if (!dragging || e.currentTarget !== currentPip()) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 6) moved = true;
    const pip = currentPip();
    const parent = area.getBoundingClientRect();
    const maxLeft = parent.width  - pip.offsetWidth  - PAD_X;
    const maxTop  = parent.height - pip.offsetHeight - bottomReserve();
    pip.style.left = `${Math.max(PAD_X, Math.min(maxLeft, origLeft + dx))}px`;
    pip.style.top  = `${Math.max(TOP_PAD_LEFT, Math.min(maxTop, origTop + dy))}px`;
  }

  function onPointerUp(e) {
    if (!dragging || e.currentTarget !== currentPip()) return;
    dragging = false;
    const pip = currentPip();
    pip.releasePointerCapture?.(e.pointerId);

    if (!moved) { setLocalStage(!localIsStage); return; } // tap → swap roles

    // Snap to the nearest corner within the safe area.
    const parent = area.getBoundingClientRect();
    const rect = pip.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const cx = rect.left + w / 2 - parent.left;
    const cy = rect.top  + h / 2 - parent.top;
    const reserve = bottomReserve();
    const snapLeft = cx < parent.width / 2;
    const snapTop  = cy < (parent.height - reserve) / 2;
    pip.style.transition = 'top 0.25s ease, left 0.25s ease';
    pip.style.left = snapLeft ? `${PAD_X}px` : `${parent.width - w - PAD_X}px`;
    pip.style.top  = snapTop
      ? `${snapLeft ? TOP_PAD_LEFT : TOP_PAD_RIGHT}px`
      : `${parent.height - h - reserve}px`;
  }

  for (const el of [localWrap, remoteWrap]) {
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', () => { dragging = false; });
    el.addEventListener('dragstart', (ev) => ev.preventDefault());
  }
})();

// ─── "More" controls dropdown ─────────────────────────────────────────────────

(function initMoreMenu() {
  const moreBtn = document.getElementById('btn-more');
  const menu    = document.getElementById('more-menu');
  const bar     = document.querySelector('.controls-bar');
  if (!moreBtn || !menu || !bar) return;

  const isOpen = () => menu.classList.contains('open');

  function open() {
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    moreBtn.setAttribute('aria-expanded', 'true');
    bar.classList.add('menu-open');
  }
  function close() {
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    moreBtn.setAttribute('aria-expanded', 'false');
    bar.classList.remove('menu-open');
  }

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen() ? close() : open();
  });

  // Close after picking an item (its own handler runs first via bubbling).
  menu.addEventListener('click', () => { if (isOpen()) setTimeout(close, 0); });

  // Dismiss on outside click or Escape.
  document.addEventListener('click', (e) => {
    if (isOpen() && !menu.contains(e.target) && !moreBtn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { close(); moreBtn.focus(); }
  });
})();

// ─── Auto-hide call controls ──────────────────────────────────────────────────
//
// The controls bar slides away after a few seconds of inactivity for an
// immersive view. Tapping the video stage toggles it; tapping a control,
// opening the menu, or moving a mouse keeps it visible.

(function initControlsAutohide() {
  const area       = document.querySelector('.video-area');
  const bar        = document.querySelector('.controls-bar');
  const menu       = document.getElementById('more-menu');
  const localWrap  = document.querySelector('.local-video-wrap');
  const remoteWrap = document.querySelector('.remote-video-wrap');
  if (!area || !bar) return;

  const HIDE_MS = 4000;
  let hideTimer = null;

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // Stay visible while the More menu is open; re-check shortly after.
      if (menu?.classList.contains('open')) { scheduleHide(); return; }
      area.classList.add('controls-hidden');
    }, HIDE_MS);
  }
  function show() {
    area.classList.remove('controls-hidden');
    scheduleHide();
  }
  function hide() {
    clearTimeout(hideTimer);
    area.classList.add('controls-hidden');
  }

  // Let the rest of the app reveal controls (e.g. when the call screen opens).
  revealControls = show;

  area.addEventListener('pointerdown', (e) => {
    // Touching the controls bar (incl. the More menu) just keeps them alive.
    if (e.target.closest('.controls-bar')) { show(); return; }
    // While the menu is open, an outside tap closes it (menu module) — don't
    // also collapse the controls.
    if (menu?.classList.contains('open')) { show(); return; }
    // Tapping the floating PiP swaps feeds (handled elsewhere); reveal controls.
    const pip = area.classList.contains('swapped') ? remoteWrap : localWrap;
    if (pip && pip.contains(e.target)) { show(); return; }
    // A tap on the main stage toggles the controls.
    area.classList.contains('controls-hidden') ? show() : hide();
  });

  // Desktop: keep controls up while the mouse moves over the video or hovers
  // the bar itself.
  area.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') show(); });
  bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  bar.addEventListener('mouseleave', scheduleHide);
})();

// ─── Drag-and-drop & paste to send files ──────────────────────────────────────

function enqueueFiles(files) {
  const list = Array.from(files);
  if (!list.length || !peer) return;
  for (const f of list) fileQueue.push(f);
  processFileQueue();
}

(function initFileDropAndPaste() {
  const callScreen = screens.call;
  if (!callScreen) return;
  let dragDepth = 0;

  const showOverlay = () => ui.dropOverlay?.classList.add('visible');
  const hideOverlay = () => ui.dropOverlay?.classList.remove('visible');

  callScreen.addEventListener('dragenter', (e) => {
    if (!peer || !e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    showOverlay();
  });
  callScreen.addEventListener('dragover', (e) => {
    if (!peer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  callScreen.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideOverlay();
  });
  callScreen.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    hideOverlay();
    if (e.dataTransfer?.files?.length) enqueueFiles(e.dataTransfer.files);
  });

  // Paste an image/file from the clipboard while on the call screen.
  document.addEventListener('paste', (e) => {
    if (!peer || !screens.call.classList.contains('active')) return;
    // Don't hijack pasting text into the chat box.
    if (document.activeElement === ui.chatInput) return;
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); enqueueFiles(files); }
  });
})();

// ─── Share-link join code auto-fill ────────────────────────────────────────────

(function initShareLinkAutofill() {
  const code = decodeURIComponent((location.hash || '').replace(/^#/, '')).trim();
  if (!code) return;
  const clean = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length >= 4 && clean.length <= 10 && ui.joinInput) {
    ui.joinInput.value = clean;
    ui.joinInput.focus();
  }
})();

// ─── Ensure AudioContext on first interaction ─────────────────────────────────
document.addEventListener('click', ensureAudioContext, { once: true });
document.addEventListener('touchstart', ensureAudioContext, { once: true });

// ─── Internationalization ─────────────────────────────────────────────────────

(function initI18n() {
  setLanguage(getLanguage());           // ensure <html lang> + storage are in sync
  applyTranslations(document);          // translate all static markup
  updateConnectionBadge('connecting');  // initial badge text (symbol + translated label)
  const sel = document.getElementById('lang-select');
  if (sel) {
    sel.value = getLanguage();
    sel.addEventListener('change', () => {
      setLanguage(sel.value);
      applyTranslations(document);
      const label = LANGUAGES.find(l => l.code === sel.value)?.label || sel.value;
      announce(t('a11y.lang_changed', { lang: label }));
    });
  }
})();

// ─── Init ─────────────────────────────────────────────────────────────────────

showScreen('home');
