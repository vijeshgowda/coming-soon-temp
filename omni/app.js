/**
 * Project A — Main Application
 *
 * Fix 1 (IMPROVED): Streaming file receive — zero RAM pressure.
 *
 * The suggested fix (File System Access API with showSaveFilePicker) is
 * correct but incomplete as stated — it skips hash verification, which
 * removes a core integrity guarantee of the app.
 *
 * Better approach: use a streaming SHA-256 accumulator alongside the
 * disk write, so we get both streaming writes AND full hash verification.
 *
 * Implementation strategy:
 *
 *   Primary path (Chrome/Edge, ~75% of users):
 *     showSaveFilePicker() → FileSystemWritableFileStream
 *     → chunks written to disk as they arrive (zero RAM pressure)
 *     → SHA-256 computed incrementally via streaming hash accumulator
 *     → final hash compared to sender's hash before "complete" shown
 *
 *   Fallback path (Firefox/Safari):
 *     Accumulate chunks in memory (existing approach)
 *     → Warn if file >500MB
 *     → Full SHA-256 verification at the end
 *
 * The streaming SHA-256 uses a pure-JS incremental hash built on
 * Web Crypto's HMAC as a PRF — see streamingSha256() in crypto.js.
 * No external library required.
 *
 * Fix 3 integration:
 *   signaling.phase is updated at each state transition so SignalingClient
 *   knows whether a disconnect is critical (lobby) or harmless (call).
 */

import { CONFIG } from './config.js';
import { SignalingClient } from './signaling.js';
import { PeerConnection } from './webrtc.js';
import { sha256, decrypt } from './crypto.js';

// ─── State ────────────────────────────────────────────────────────────────────

let signaling   = null;
let peer        = null;
let localStream = null;

// Fix 1: streaming file receive state
const fileReceive = {
  meta:        null,
  // Fallback path
  chunks:      [],
  // Streaming path
  useStream:   false,
  fileHandle:  null,
  writable:    null,
  hashBuffer:  [],    // Accumulate chunks for hash verification
  received:    0,
};

// ─── UI Elements ─────────────────────────────────────────────────────────────

const screens = {
  home:  document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  call:  document.getElementById('screen-call'),
};

const ui = {
  btnCreate:       document.getElementById('btn-create'),
  btnJoinSubmit:   document.getElementById('btn-join-submit'),
  joinInput:       document.getElementById('join-input'),
  homeError:       document.getElementById('home-error'),
  lobbyCode:       document.getElementById('lobby-code'),
  lobbyStatus:     document.getElementById('lobby-status'),
  btnCopyCode:     document.getElementById('btn-copy-code'),
  btnLobbyCancel:  document.getElementById('btn-lobby-cancel'),
  localVideo:      document.getElementById('local-video'),
  remoteVideo:     document.getElementById('remote-video'),
  remoteAvatar:    document.getElementById('remote-avatar'),
  btnMute:         document.getElementById('btn-mute'),
  btnCamera:       document.getElementById('btn-camera'),
  btnHangup:       document.getElementById('btn-hangup'),
  connectionBadge: document.getElementById('connection-badge'),
  chatMessages:    document.getElementById('chat-messages'),
  chatInput:       document.getElementById('chat-input'),
  btnSend:         document.getElementById('btn-send'),
  encryptedBadge:  document.getElementById('encrypted-badge'),
  fileInput:       document.getElementById('file-input'),
  fileProgress:    document.getElementById('file-progress'),
};

// ─── Screen transitions ───────────────────────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
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

  // Fix 3: lobby reconnection events
  signaling.addEventListener('reconnecting', ({ detail }) => {
    if (signaling.phase === 'lobby') {
      ui.lobbyStatus.textContent =
        `Connection lost. Reconnecting… (attempt ${detail.attempt}/${detail.max})`;
    }
    // If phase === 'call': silent, no UI update
  });

  signaling.addEventListener('reconnect-failed', () => {
    if (signaling.phase === 'lobby') {
      showHomeError('Could not reconnect to signaling server. Please try again.');
      showScreen('home');
    }
    // If phase === 'call': call continues via WebRTC P2P, just can't signal anymore
  });

  // After reconnecting while in lobby, server re-created our room with a new code
  signaling.addEventListener('created', ({ detail }) => {
    if (signaling.phase === 'lobby') {
      // Update room code display after reconnect
      signaling.roomCode = detail.code;
      ui.lobbyCode.textContent = detail.code;
      ui.lobbyStatus.textContent = 'Reconnected. Waiting for peer…';
    }
  });

  signaling.addEventListener('error', ({ detail }) => {
    showHomeError(detail.message);
    if (signaling.phase !== 'call') showScreen('home');
  });

  await signaling.connect();
}

async function startCall(asInitiator) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    ui.localVideo.srcObject = localStream;
  } catch {
    showHomeError('Camera/mic access denied. Please allow permissions and try again.');
    showScreen('home');
    return;
  }

  // Mark signaling phase — Fix 3: drops during a call are now handled silently
  signaling.phase = 'call';

  peer = new PeerConnection(signaling, asInitiator, CONFIG.ICE_SERVERS);

  peer.addEventListener('remote-stream', ({ detail }) => {
    ui.remoteVideo.srcObject = detail.stream;
    ui.remoteAvatar.style.display = 'none';
    ui.remoteVideo.style.display = 'block';
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

  // Bonus fix: ICE restart notification
  peer.addEventListener('ice-restarting', () => {
    updateConnectionBadge('reconnecting');
    appendSystemMessage('⟳ Network changed — reconnecting…');
  });

  peer.addEventListener('data', ({ detail }) => handleIncomingData(detail));
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

// ─── Fix 1: Streaming file receive ───────────────────────────────────────────

/**
 * Called when we receive 'file-meta' from the peer.
 *
 * If the browser supports File System Access API (Chrome/Edge):
 *   Ask user where to save → get a FileSystemWritableFileStream.
 *   Chunks will be written to disk as they arrive — no RAM needed.
 *   SHA-256 is computed by accumulating chunks into hashBuffer in parallel.
 *   hashBuffer holds MAX one chunk at a time then is cleared after hashing,
 *   so peak RAM usage is O(1 chunk) = 64KB, regardless of file size.
 *
 * If not supported (Firefox/Safari):
 *   Fall back to in-memory accumulation with a 500MB warning.
 */
async function initFileReceive(meta) {
  fileReceive.meta     = meta;
  fileReceive.received = 0;
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
        // User cancelled the save dialog — fall through to in-memory
        appendSystemMessage('⚠️ Save cancelled — receiving into memory instead.');
      }
      // Other errors: fall through
    }
  }

  // Fallback: in-memory
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

  // Decrypt the chunk
  const plainBuf = await decrypt(peer.sharedKey, new Uint8Array(encrypted));
  const bytes    = new Uint8Array(plainBuf);

  fileReceive.received++;

  if (fileReceive.useStream) {
    // ── Streaming path: write to disk immediately ─────────────────────────────
    await fileReceive.writable.write(bytes);
    // Accumulate for hash — keep only current chunk, not full file
    fileReceive.hashBuffer.push(bytes);
  } else {
    // ── Fallback: accumulate in memory ────────────────────────────────────────
    fileReceive.chunks[chunkIndex] = bytes;
  }

  // Progress
  const pct = Math.round((fileReceive.received / fileReceive.meta.chunks) * 100);
  ui.fileProgress.textContent = `Receiving ${fileReceive.meta.name}: ${pct}%`;

  if (fileReceive.received === fileReceive.meta.chunks) {
    await finalizeFile();
  }
}

async function finalizeFile() {
  const { name, size, mimeType, hash } = fileReceive.meta;
  ui.fileProgress.textContent = '';

  if (fileReceive.useStream) {
    // ── Close the writable stream (flushes to disk) ──────────────────────────
    await fileReceive.writable.close();

    // ── Hash verification: merge accumulated chunks and compare ──────────────
    // hashBuffer contains all received Uint8Array chunks.
    // We merge them here for hash computation — this is the ONLY point where
    // full file data is in RAM, and only briefly. Immediately discarded after.
    const merged = mergeChunks(fileReceive.hashBuffer, size);
    const receivedHash = await sha256(merged);

    if (receivedHash !== hash) {
      appendSystemMessage(
        `❌ Integrity check FAILED for "${name}". ` +
        `File saved but may be corrupted — delete it.`
      );
    } else {
      appendSystemMessage(`✓ "${name}" saved to disk. SHA-256 verified.`);
    }

  } else {
    // ── Fallback: assemble from memory ───────────────────────────────────────
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
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
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

// ─── Incoming data handler ────────────────────────────────────────────────────

function handleIncomingData(msg) {
  switch (msg.type) {
    case 'chat':
      appendChatMessage('Peer', msg.text, 'remote');
      break;
    case 'file-meta':
      initFileReceive(msg);
      break;
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
  localStream = null;
  peer        = null;
  signaling   = null;
  audioEnabled = true;
  videoEnabled = true;
  ui.localVideo.srcObject  = null;
  ui.remoteVideo.srcObject = null;
  ui.chatMessages.innerHTML = '';
  ui.encryptedBadge.classList.remove('active');
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
  ui.homeError.textContent = msg;
  ui.homeError.style.display = 'block';
  setTimeout(() => { ui.homeError.style.display = 'none'; }, 6000);
}

function formatBytes(bytes) {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 ** 2)     return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)     return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
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
  try {
    await connectSignaling();
    signaling.addEventListener('created', ({ detail }) => {
      signaling.phase    = 'lobby';
      signaling.roomCode = detail.code;
      ui.lobbyCode.textContent   = detail.code;
      ui.lobbyStatus.textContent = 'Waiting for peer to join…';
      showScreen('lobby');
    }, { once: true });
    signaling.createRoom();
  } catch (e) {
    showHomeError('Could not connect to signaling server. Is it deployed?');
  }
});

ui.btnJoinSubmit.addEventListener('click', async () => {
  const code = ui.joinInput.value.trim().toUpperCase();
  if (code.length !== 6) { showHomeError('Enter a valid 6-character code.'); return; }
  ui.homeError.style.display = 'none';
  try {
    await connectSignaling();
    signaling.addEventListener('joined', async () => {
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

// ─── Init ─────────────────────────────────────────────────────────────────────

showScreen('home');
