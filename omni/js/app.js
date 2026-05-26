/**
 * Omni — Main Application
 */

import { CONFIG } from './config.js';
import { SignalingClient } from './signaling.js';
import { PeerConnection } from './webrtc.js';
import { sha256, decrypt } from './crypto.js';

// ─── State ────────────────────────────────────────────────────────────────────

let signaling   = null;
let peer        = null;
let localStream = null;

const fileReceive = {
  meta:       null,
  chunks:     [],
  useStream:  false,
  fileHandle: null,
  writable:   null,
  hashBuffer: [],
  received:   0,
};

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
  // Progress bar
  connectingState:  document.getElementById('connecting-state'),
  connectingText:   document.getElementById('connecting-text'),
};

// ─── Screen transitions ───────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function showConnecting(text = 'Connecting to server…') {
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
    peer?.handleSignal(detail.payload);
  });

  signaling.addEventListener('peer-joined', async () => {
    ui.lobbyStatus.textContent = 'Peer found. Establishing encrypted connection…';
    await startCall(true);
  });

  signaling.addEventListener('peer-left', () => {
    appendSystemMessage('Peer disconnected.');
    setTimeout(resetToHome, 3000);
  });

  signaling.addEventListener('reconnecting', ({ detail }) => {
    if (signaling.phase === 'lobby') {
      ui.lobbyStatus.textContent =
        `Connection lost. Reconnecting… (attempt ${detail.attempt}/${detail.max})`;
    }
  });

  signaling.addEventListener('reconnect-failed', () => {
    if (signaling.phase === 'lobby') {
      showHomeError('Could not reconnect to signaling server. Please try again.');
      showScreen('home');
    }
  });

  // Persistent 'created' listener — handles two cases:
  //   1. rejoin-failed fallback: we called createRoom() and got a new code
  //   2. (legacy) reconnect created a fresh room
  signaling.addEventListener('created', ({ detail }) => {
    if (signaling.phase === 'lobby') {
      signaling.roomCode = detail.code;
      ui.lobbyCode.textContent   = detail.code;
      ui.lobbyStatus.textContent = 'New room created. Share the updated code…';
      ui.lobbyCode.classList.toggle('custom-code', !!detail.custom);
      hideConnecting();
    }
  });

  // Rejoin succeeded — same code, no disruption
  signaling.addEventListener('rejoined', ({ detail }) => {
    signaling.phase    = 'lobby';
    signaling.roomCode = detail.code;
    ui.lobbyCode.textContent   = detail.code;
    ui.lobbyStatus.textContent = 'Reconnected. Still waiting for peer…';
    ui.lobbyCode.classList.toggle('custom-code', !!detail.custom);
    hideConnecting();
    showScreen('lobby');
  });

  // Rejoin failed (grace window expired) — transparently create a fresh room
  signaling.addEventListener('rejoin-failed', () => {
    ui.lobbyStatus && (ui.lobbyStatus.textContent = 'Session expired. Creating new room…');
    signaling.createRoom(signaling._customCode || '');
  });

  signaling.addEventListener('error', ({ detail }) => {
    showHomeError(detail.message);
    hideConnecting();
    if (signaling.phase !== 'call') showScreen('home');
  });

  await signaling.connect();
}

async function startCall(asInitiator) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    ui.localVideo.srcObject = localStream;
  } catch {
    signaling?.disconnect();
    showHomeError('Camera/mic access denied. Please allow permissions and try again.');
    showScreen('home');
    return;
  }

  signaling.phase = 'call';

  peer = new PeerConnection(signaling, asInitiator, CONFIG.ICE_SERVERS);

  peer.addEventListener('remote-stream', ({ detail }) => {
    ui.remoteVideo.srcObject = detail.stream;
    ui.remoteAvatar.style.display = 'none';
    ui.remoteVideo.style.display  = 'block';
  });

  peer.addEventListener('secure-channel-ready', () => {
    ui.encryptedBadge.classList.add('active');
    appendSystemMessage('🔒 Encrypted channel established.');
  });

  peer.addEventListener('connection-state', ({ detail }) => {
    updateConnectionBadge(detail.state);
  });

  peer.addEventListener('ice-state', ({ detail }) => {
    if (detail.state === 'connected' || detail.state === 'completed') {
      updateConnectionBadge('connected');
    }
  });

  peer.addEventListener('ice-restarting', () => {
    updateConnectionBadge('reconnecting');
    appendSystemMessage('⟳ Network changed — reconnecting…');
  });

  peer.addEventListener('data',       ({ detail }) => handleIncomingData(detail));
  peer.addEventListener('file-chunk', ({ detail }) => handleFileChunk(detail.data));

  peer.addEventListener('file-send-progress', ({ detail }) => {
    const pct = Math.round((detail.sent / detail.total) * 100);
    ui.fileProgress.textContent = `Sending ${detail.name}: ${pct}%`;
    if (pct === 100) setTimeout(() => { ui.fileProgress.textContent = ''; }, 2000);
  });

  peer.addEventListener('error', ({ detail }) => {
    appendSystemMessage(`⚠️ ${detail.message}`);
  });

  await peer.initialize(localStream);
  showScreen('call');
}

// ─── File receive ─────────────────────────────────────────────────────────────

async function initFileReceive(meta) {
  fileReceive.meta       = meta;
  fileReceive.received   = 0;
  fileReceive.hashBuffer = [];

  if ('showSaveFilePicker' in window) {
    try {
      const ext = meta.name.includes('.') ? meta.name.split('.').pop() : undefined;
      fileReceive.fileHandle = await window.showSaveFilePicker({
        suggestedName: meta.name,
        types: ext ? [{ accept: { [meta.mimeType || 'application/octet-stream']: [`.${ext}`] } }] : undefined,
      });
      fileReceive.writable  = await fileReceive.fileHandle.createWritable();
      fileReceive.useStream = true;
      fileReceive.chunks    = [];
      appendSystemMessage(`📎 Receiving "${meta.name}" (${formatBytes(meta.size)}) — streaming to disk…`);
      return;
    } catch (e) {
      if (e.name === 'AbortError') {
        appendSystemMessage('⚠️ Save cancelled — receiving into memory instead.');
      }
    }
  }

  fileReceive.useStream = false;
  fileReceive.chunks    = new Array(meta.chunks);
  if (meta.size > 500 * 1024 * 1024) {
    appendSystemMessage(
      `⚠️ File is ${formatBytes(meta.size)}. ` +
      `Use Chrome or Edge for large files to avoid running out of memory.`
    );
  } else {
    appendSystemMessage(`📎 Receiving "${meta.name}" (${formatBytes(meta.size)})…`);
  }
}

async function handleFileChunk(buffer) {
  if (!fileReceive.meta) return;

  const view       = new DataView(buffer);
  const chunkIndex = view.getUint32(0, true);
  const encrypted  = buffer.slice(4);
  const plainBuf   = await decrypt(peer.sharedKey, new Uint8Array(encrypted));
  const bytes      = new Uint8Array(plainBuf);

  fileReceive.received++;

  if (fileReceive.useStream) {
    await fileReceive.writable.write(bytes);
    fileReceive.hashBuffer.push(bytes);
  } else {
    fileReceive.chunks[chunkIndex] = bytes;
  }

  const pct = Math.round((fileReceive.received / fileReceive.meta.chunks) * 100);
  ui.fileProgress.textContent = `Receiving ${fileReceive.meta.name}: ${pct}%`;

  if (fileReceive.received === fileReceive.meta.chunks) await finalizeFile();
}

async function finalizeFile() {
  const { name, size, mimeType, hash } = fileReceive.meta;
  ui.fileProgress.textContent = '';

  if (fileReceive.useStream) {
    await fileReceive.writable.close();
    const merged       = mergeChunks(fileReceive.hashBuffer, size);
    const receivedHash = await sha256(merged);
    if (receivedHash !== hash) {
      appendSystemMessage(`❌ Integrity check FAILED for "${name}". File saved but may be corrupted.`);
    } else {
      appendSystemMessage(`✓ "${name}" saved to disk. SHA-256 verified.`);
    }
  } else {
    const merged       = mergeChunks(fileReceive.chunks, size);
    const receivedHash = await sha256(merged);
    if (receivedHash !== hash) {
      appendSystemMessage(`❌ Integrity check FAILED for "${name}". File may be corrupted.`);
      resetFileReceiveState();
      return;
    }
    const blob = new Blob([merged], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    appendFileDownload(name, url, size);
  }

  resetFileReceiveState();
}

function mergeChunks(chunks, totalSize) {
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
}

function resetFileReceiveState() {
  fileReceive.meta       = null;
  fileReceive.chunks     = [];
  fileReceive.hashBuffer = [];
  fileReceive.useStream  = false;
  fileReceive.fileHandle = null;
  fileReceive.writable   = null;
  fileReceive.received   = 0;
}

// ─── Incoming data ────────────────────────────────────────────────────────────

function handleIncomingData(msg) {
  switch (msg.type) {
    case 'chat':      appendChatMessage('Peer', msg.text, 'remote'); break;
    case 'file-meta': initFileReceive(msg); break;
  }
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

function appendFileDownload(name, url, size) {
  const div = document.createElement('div');
  div.className = 'message remote';
  div.innerHTML = `
    <span class="sender">File received ✓</span>
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
    appendChatMessage('You', text, 'local');
    ui.chatInput.value = '';
  } catch {
    appendSystemMessage('⚠️ Send failed — channel not ready yet.');
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────

let audioEnabled = true;
let videoEnabled = true;

function toggleMute() {
  audioEnabled = !audioEnabled;
  peer?.toggleAudio(audioEnabled);
  ui.btnMute.classList.toggle('active', !audioEnabled);
  ui.btnMute.querySelector('.icon').textContent = audioEnabled ? '🎙️' : '🔇';
}

function toggleCamera() {
  videoEnabled = !videoEnabled;
  peer?.toggleVideo(videoEnabled);
  ui.btnCamera.classList.toggle('active', !videoEnabled);
  ui.btnCamera.querySelector('.icon').textContent = videoEnabled ? '📷' : '🚫';
  ui.localVideo.style.opacity = videoEnabled ? '1' : '0.3';
}

function hangup() {
  peer?.hangup();
  signaling?.disconnect();
  resetToHome();
}

function resetToHome() {
  peer?.hangup();
  signaling?.disconnect();
  localStream = null;
  peer        = null;
  signaling   = null;
  audioEnabled = true;
  videoEnabled = true;
  ui.localVideo.srcObject  = null;
  ui.remoteVideo.srcObject = null;
  ui.chatMessages.innerHTML = '';
  ui.encryptedBadge.classList.remove('active');
  hideConnecting();
  resetFileReceiveState();
  showScreen('home');
}

function updateConnectionBadge(state) {
  const badge = ui.connectionBadge;
  badge.className = `badge connection-badge ${state}`;
  const labels = {
    connected:    '● Connected',
    reconnecting: '◌ Reconnecting…',
    connecting:   '○ Connecting…',
    disconnected: '○ Disconnected',
    failed:       '✕ Failed',
    new:          '○ Setting up…',
  };
  badge.textContent = labels[state] ?? state;
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
  return str.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ─── Event listeners ──────────────────────────────────────────────────────────

ui.btnCreate.addEventListener('click', async () => {
  ui.homeError.style.display = 'none';

  const customCode = ui.customCodeInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (customCode.length > 0 && (customCode.length < 4 || customCode.length > 10)) {
    showHomeError('Custom codes must be between 4 and 10 characters.');
    ui.customCodeInput.focus();
    return;
  }

  showConnecting('Connecting to server…');

  try {
    await connectSignaling();

    signaling.addEventListener('created', ({ detail }) => {
      signaling.phase    = 'lobby';
      signaling.roomCode = detail.code;
      ui.lobbyCode.textContent   = detail.code;
      ui.lobbyStatus.textContent = detail.custom
        ? `Your custom code is ready. Share it with your peer…`
        : 'Waiting for peer to join…';
      ui.lobbyCode.classList.toggle('custom-code', !!detail.custom);
      hideConnecting();
      showScreen('lobby');
    }, { once: true });

    signaling.createRoom(customCode);
  } catch {
    showHomeError('Could not connect to signaling server. Is it deployed?');
  }
});

ui.btnJoinSubmit.addEventListener('click', async () => {
  const code = ui.joinInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (code.length < 4 || code.length > 10) {
    showHomeError('Enter a valid code (4–10 characters).');
    return;
  }
  ui.homeError.style.display = 'none';
  showConnecting('Joining room…');
  try {
    await connectSignaling();
    signaling.addEventListener('joined', async () => {
      hideConnecting();
      await startCall(false);
    }, { once: true });
    signaling.addEventListener('error', ({ detail }) => {
      showHomeError(detail.message);
    }, { once: true });
    signaling.joinRoom(code);
  } catch {
    showHomeError('Could not connect to signaling server. Is it deployed?');
  }
});

ui.joinInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') ui.btnJoinSubmit.click();
});

ui.btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(ui.lobbyCode.textContent);
  ui.btnCopyCode.textContent = 'Copied!';
  setTimeout(() => { ui.btnCopyCode.textContent = 'Copy Code'; }, 2000);
});

ui.btnLobbyCancel.addEventListener('click', () => {
  signaling?.disconnect();
  showScreen('home');
});

ui.btnMute.addEventListener('click', toggleMute);
ui.btnCamera.addEventListener('click', toggleCamera);
ui.btnHangup.addEventListener('click', hangup);
ui.btnSend.addEventListener('click', sendChat);

ui.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

ui.fileInput.addEventListener('change', async () => {
  const file = ui.fileInput.files[0];
  if (!file || !peer) return;
  ui.fileInput.value = '';
  appendSystemMessage(`📤 Sending "${file.name}" (${formatBytes(file.size)})…`);
  try {
    await peer.sendFile(file);
    appendSystemMessage(`✓ Sent "${file.name}".`);
  } catch (err) {
    appendSystemMessage(`❌ Send failed: ${err.message}`);
  }
});

// ─── Custom code toggle ───────────────────────────────────────────────────────

ui.btnCustomToggle.addEventListener('click', () => {
  const isOpen = ui.customCodeWrap.classList.toggle('open');
  ui.customCodeWrap.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  document.getElementById('custom-toggle-icon').textContent = isOpen ? '▾' : '▸';
  if (!isOpen) ui.customCodeInput.value = '';
});

// ─── Picture in Picture ───────────────────────────────────────────────────────

async function enterPiP() {
  const video = ui.remoteVideo;
  if (!video.srcObject || !peer) return;
  try {
    if (document.pictureInPictureEnabled && !document.pictureInPictureElement) {
      await video.requestPictureInPicture();
    } else if (video.webkitSupportsPresentationMode?.('picture-in-picture')) {
      video.webkitSetPresentationMode('picture-in-picture');
    }
  } catch { /* PiP denied or not supported — silent */ }
}

async function exitPiP() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    if (ui.remoteVideo.webkitPresentationMode === 'picture-in-picture') {
      ui.remoteVideo.webkitSetPresentationMode('inline');
    }
  } catch { /* silent */ }
}

document.addEventListener('visibilitychange', () => {
  if (!peer) return;
  document.hidden ? enterPiP() : exitPiP();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

showScreen('home');
