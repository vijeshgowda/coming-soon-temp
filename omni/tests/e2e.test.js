/**
 * Omni — End-to-End Tests
 *
 * Exercises the code paths added/changed in the latest pass, wiring real
 * modules together rather than re-implementing their logic:
 *
 *   • IncrementalSHA256 (crypto.js)          — streaming file hashing
 *   • PeerConnection.sendFile (webrtc.js)    — real chunked encrypted send
 *   • PeerConnection.handleSignal (webrtc.js)— perfect-negotiation glare logic
 *   • Server origin allowlist + maxPayload   — hardening (server/index.js)
 *   • Unified 'description' signal relay      — full two-client lifecycle
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'server', 'index.js');

const {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  decrypt,
  sha256,
  base64ToUint8,
  IncrementalSHA256,
} = await import(join(__dirname, '..', 'js', 'crypto.js'));

const { PeerConnection } = await import(join(__dirname, '..', 'js', 'webrtc.js'));

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Derive a matching pair of AES keys for two simulated peers. */
async function deriveBothKeys() {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const ka = await deriveSharedKey(a.privateKey, await importPublicKey(await exportPublicKey(b)));
  const kb = await deriveSharedKey(b.privateKey, await importPublicKey(await exportPublicKey(a)));
  return { ka, kb };
}

/** Spawn the signaling server with optional extra env. Resolves to { port, proc }. */
function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const port = 11000 + Math.floor(Math.random() * 2000);
    const proc = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(port), ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => { if (d.toString().includes('listening')) resolve({ port, proc }); });
    proc.stderr.on('data', (d) => { if (/Error/.test(d.toString())) reject(new Error(d.toString())); });
    setTimeout(() => reject(new Error('Server start timeout')), 5000);
  });
}

function stopServer(proc) {
  if (proc) proc.kill('SIGTERM');
}

function connectWS(port, opts) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, opts);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

const send = (ws, msg) => ws.send(JSON.stringify(msg));

function waitFor(ws, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}"`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) { clearTimeout(timer); ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
  });
}

function closeWS(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on('close', resolve);
    ws.close();
  });
}

// ─── IncrementalSHA256 ────────────────────────────────────────────────────────

describe('E2E: IncrementalSHA256', () => {
  test('known-answer vectors', () => {
    const hashOf = (s) => { const h = new IncrementalSHA256(); h.update(new TextEncoder().encode(s)); return h.digest(); };
    assert.equal(hashOf(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hashOf('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(hashOf('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('matches Web Crypto sha256 regardless of chunk boundaries', async () => {
    const data = new Uint8Array(200_003);
    for (let i = 0; i < data.length; i++) data[i] = (i * 131 + 7) & 0xff;
    const reference = await sha256(data);

    for (const step of [1, 7, 63, 64, 65, 1000, 65_536]) {
      const h = new IncrementalSHA256();
      for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
      assert.equal(h.digest(), reference, `mismatch at chunk size ${step}`);
    }
  });

  test('handles block-boundary lengths (55/56/64 bytes)', async () => {
    for (const len of [55, 56, 57, 63, 64, 65, 119, 120]) {
      const data = new Uint8Array(len).map((_, i) => i & 0xff);
      const h = new IncrementalSHA256();
      h.update(data);
      assert.equal(h.digest(), await sha256(data), `mismatch at length ${len}`);
    }
  });
});

// ─── Full encrypted file transfer (send path + streaming receive) ─────────────

describe('E2E: Encrypted file transfer', () => {
  const CHUNK_SIZE = 64 * 1024;

  /** A fake DataChannel that records every frame the sender pushes. */
  function makeFakeDataChannel() {
    return {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      frames: [],
      send(data) { this.frames.push(data); },
      addEventListener() {},
    };
  }

  /** Mirror app.js's receive path: decrypt frames + verify integrity incrementally. */
  async function receiveFrames(frames, key) {
    let meta = null;
    const hasher = new IncrementalSHA256();
    const collected = [];
    let received = 0;

    for (const frame of frames) {
      if (typeof frame === 'string') {
        const wrapper = JSON.parse(frame);
        const plain = await decrypt(key, base64ToUint8(wrapper.data));
        const inner = JSON.parse(new TextDecoder().decode(plain));
        if (inner.type === 'file-meta') meta = inner;
      } else {
        const view = new DataView(frame);
        // Frame layout: [4B fileId LE][4B chunkIndex LE][ciphertext]
        const idx = view.getUint32(4, true);
        assert.equal(idx, received, 'chunk index must be sequential');
        const plainBuf = await decrypt(key, new Uint8Array(frame.slice(8)));
        const bytes = new Uint8Array(plainBuf);
        hasher.update(bytes);
        collected.push(bytes);
        received++;
      }
    }
    return { meta, received, digest: hasher.digest(), collected };
  }

  function reassemble(chunks, size) {
    const out = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return out;
  }

  test('multi-chunk file: meta + chunks decrypt and hash verifies', async () => {
    const { ka, kb } = await deriveBothKeys();

    // 150KB → 3 chunks (64K, 64K, 22K)
    const original = new Uint8Array(150 * 1024).map((_, i) => (i * 7 + 3) & 0xff);
    const file = new File([original], 'photo.bin', { type: 'application/octet-stream' });

    const peer = new PeerConnection({ sendSignal() {} }, true, []);
    peer.sharedKey = ka;
    const dc = makeFakeDataChannel();
    peer.dataChannel = dc;

    const progress = [];
    peer.addEventListener('file-send-progress', ({ detail }) => progress.push(detail));

    await peer.sendFile(file);

    const { meta, received, digest, collected } = await receiveFrames(dc.frames, kb);

    assert.ok(meta, 'file-meta should be received');
    assert.equal(meta.name, 'photo.bin');
    assert.equal(meta.size, original.length);
    assert.equal(meta.chunks, Math.ceil(original.length / CHUNK_SIZE));
    assert.equal(received, meta.chunks, 'all chunks received');
    assert.equal(digest, meta.hash, 'streaming SHA-256 matches sender hash');

    // Reassembled bytes are identical to the original file
    assert.deepEqual(reassemble(collected, meta.size), original);

    // Sender emitted progress up to 100%
    assert.equal(progress.at(-1).sent, meta.chunks);
    assert.equal(progress.at(-1).total, meta.chunks);
  });

  test('exact chunk-boundary file (128KB → 2 chunks) verifies', async () => {
    const { ka, kb } = await deriveBothKeys();
    const original = new Uint8Array(128 * 1024).map((_, i) => i & 0xff);
    const file = new File([original], 'aligned.bin', { type: 'application/octet-stream' });

    const peer = new PeerConnection({ sendSignal() {} }, true, []);
    peer.sharedKey = ka;
    peer.dataChannel = makeFakeDataChannel();

    await peer.sendFile(file);
    const { meta, received, digest, collected } = await receiveFrames(peer.dataChannel.frames, kb);

    assert.equal(meta.chunks, 2);
    assert.equal(received, 2);
    assert.equal(digest, meta.hash);
    assert.deepEqual(reassemble(collected, meta.size), original);
  });

  test('tampered chunk fails AES-GCM authentication', async () => {
    const { ka, kb } = await deriveBothKeys();
    const original = new Uint8Array(70 * 1024).map((_, i) => (i * 5) & 0xff);
    const file = new File([original], 'tamper.bin', { type: 'application/octet-stream' });

    const peer = new PeerConnection({ sendSignal() {} }, true, []);
    peer.sharedKey = ka;
    peer.dataChannel = makeFakeDataChannel();
    await peer.sendFile(file);

    // Flip a byte inside the first binary chunk's ciphertext (skip 8B header + 12B IV)
    const binaryFrame = peer.dataChannel.frames.find(f => typeof f !== 'string');
    const view = new Uint8Array(binaryFrame);
    view[24] ^= 0xff;

    await assert.rejects(
      () => decrypt(kb, new Uint8Array(binaryFrame.slice(8))),
      /operation/i
    );
  });

  test('send rejects when secure channel is not ready', async () => {
    const peer = new PeerConnection({ sendSignal() {} }, true, []);
    peer.sharedKey = null; // no key derived yet
    peer.dataChannel = makeFakeDataChannel();
    await assert.rejects(() => peer.send({ type: 'chat', text: 'hi' }), /not ready/i);
  });
});

// ─── Perfect negotiation (real handleSignal glare logic) ──────────────────────

describe('E2E: Perfect negotiation', () => {
  function makeFakePC(signalingState = 'stable') {
    return {
      signalingState,
      localDescription: { type: 'answer', sdp: 'local' },
      remoteCalls: [],
      localCalls: 0,
      iceCalls: [],
      async setRemoteDescription(d) { this.remoteCalls.push(d); this.signalingState = 'stable'; },
      async setLocalDescription() { this.localCalls++; this.signalingState = 'stable'; },
      async addIceCandidate(c) { this.iceCalls.push(c); },
    };
  }

  function makePeer(isInitiator, pcState) {
    const signaling = { sent: [], sendSignal(p) { this.sent.push(p); } };
    const peer = new PeerConnection(signaling, isInitiator, []);
    peer.pc = makeFakePC(pcState);
    return { peer, signaling };
  }

  test('clean offer when stable: sets remote + answers', async () => {
    const { peer, signaling } = makePeer(false, 'stable'); // polite joiner
    await peer.handleSignal({ type: 'description', sdp: { type: 'offer', sdp: 'x' } });

    assert.equal(peer.pc.remoteCalls.length, 1);
    assert.equal(peer.pc.localCalls, 1, 'should create an answer');
    assert.equal(signaling.sent.length, 1);
    assert.equal(signaling.sent[0].type, 'description');
    assert.equal(peer.remoteSet, true);
    assert.equal(peer._ignoreOffer, false);
  });

  test('impolite peer ignores a colliding offer', async () => {
    const { peer, signaling } = makePeer(true, 'have-local-offer'); // impolite initiator
    peer._makingOffer = true;
    await peer.handleSignal({ type: 'description', sdp: { type: 'offer', sdp: 'x' } });

    assert.equal(peer.pc.remoteCalls.length, 0, 'must not apply the offer');
    assert.equal(signaling.sent.length, 0, 'must not answer');
    assert.equal(peer._ignoreOffer, true);
  });

  test('polite peer rolls back and accepts a colliding offer', async () => {
    const { peer, signaling } = makePeer(false, 'have-local-offer'); // polite joiner
    peer._makingOffer = true;
    await peer.handleSignal({ type: 'description', sdp: { type: 'offer', sdp: 'x' } });

    assert.equal(peer.pc.remoteCalls.length, 1, 'applies remote offer (implicit rollback)');
    assert.equal(peer.pc.localCalls, 1, 'creates an answer');
    assert.equal(signaling.sent.length, 1);
    assert.equal(peer._ignoreOffer, false);
  });

  test('answer is applied without producing another answer', async () => {
    const { peer, signaling } = makePeer(true, 'have-local-offer');
    await peer.handleSignal({ type: 'description', sdp: { type: 'answer', sdp: 'x' } });

    assert.equal(peer.pc.remoteCalls.length, 1);
    assert.equal(peer.pc.localCalls, 0, 'answers do not trigger a local description');
    assert.equal(signaling.sent.length, 0);
    assert.equal(peer.remoteSet, true);
    assert.equal(peer._isSettingRemoteAnswerPending, false);
  });

  test('ICE candidates are buffered until remote description is set', async () => {
    const { peer } = makePeer(false, 'stable');

    await peer.handleSignal({ type: 'ice-candidate', candidate: { candidate: 'a' } });
    assert.equal(peer.pc.iceCalls.length, 0, 'buffered before remote set');
    assert.equal(peer.pendingIce.length, 1);

    await peer.handleSignal({ type: 'description', sdp: { type: 'offer', sdp: 'x' } });
    assert.equal(peer.pc.iceCalls.length, 1, 'flushed after remote set');
    assert.equal(peer.pendingIce.length, 0);

    await peer.handleSignal({ type: 'ice-candidate', candidate: { candidate: 'b' } });
    assert.equal(peer.pc.iceCalls.length, 2, 'added directly once remote is set');
  });
});

// ─── Server hardening: origin allowlist + maxPayload ──────────────────────────

describe('E2E: Server origin allowlist', () => {
  let proc, port;
  beforeEach(async () => { ({ proc, port } = await startServer({ ALLOWED_ORIGINS: 'https://omni.example' })); });
  afterEach(() => stopServer(proc));

  test('accepts a connection from an allowed origin', async () => {
    const ws = await connectWS(port, { origin: 'https://omni.example' });
    send(ws, { type: 'create', code: '' });
    const created = await waitFor(ws, 'created');
    assert.ok(created.code);
    await closeWS(ws);
  });

  test('rejects a connection from a disallowed origin', async () => {
    await assert.rejects(() => connectWS(port, { origin: 'https://evil.example' }), /403/);
  });

  test('rejects a connection with no origin when allowlist is set', async () => {
    await assert.rejects(() => connectWS(port), /403/);
  });
});

describe('E2E: Server defaults (no allowlist)', () => {
  let proc, port;
  beforeEach(async () => { ({ proc, port } = await startServer()); });
  afterEach(() => stopServer(proc));

  test('allows any origin when ALLOWED_ORIGINS is unset', async () => {
    const ws = await connectWS(port, { origin: 'https://anything.example' });
    send(ws, { type: 'create', code: '' });
    assert.ok(await waitFor(ws, 'created'));
    await closeWS(ws);
  });

  test('closes the connection on oversized payload (maxPayload)', async () => {
    const ws = await connectWS(port);
    const closeCode = new Promise((res) => ws.on('close', (code) => res(code)));
    // 300KB payload exceeds the 256KB maxPayload cap
    send(ws, { type: 'signal', payload: { blob: 'x'.repeat(300 * 1024) } });
    assert.equal(await closeCode, 1009, 'server closes with 1009 Message Too Big');
  });

  test('normal-sized signals still relay fine', async () => {
    const creator = await connectWS(port);
    send(creator, { type: 'create', code: '' });
    const { code } = await waitFor(creator, 'created');

    const joiner = await connectWS(port);
    send(joiner, { type: 'join', code });
    await Promise.all([waitFor(joiner, 'joined'), waitFor(creator, 'peer-joined')]);

    send(creator, { type: 'signal', payload: { type: 'description', sdp: { type: 'offer', sdp: 'v=0' } } });
    const relayed = await waitFor(joiner, 'signal');
    assert.equal(relayed.payload.sdp.type, 'offer');

    await closeWS(creator);
    await closeWS(joiner);
  });
});

// ─── Full two-client lifecycle with unified 'description' signalling ──────────

describe('E2E: Two-client lifecycle', () => {
  let proc, port;
  beforeEach(async () => { ({ proc, port } = await startServer()); });
  afterEach(() => stopServer(proc));

  test('create → join → description offer/answer → ICE → peer-left', async () => {
    const creator = await connectWS(port);
    send(creator, { type: 'create', code: 'LIFECYCLE' });
    const created = await waitFor(creator, 'created');
    assert.equal(created.code, 'LIFECYCLE');

    const joiner = await connectWS(port);
    send(joiner, { type: 'join', code: 'lifecycle' });
    await Promise.all([waitFor(joiner, 'joined'), waitFor(creator, 'peer-joined')]);

    // Unified description messages (perfect negotiation) relay end to end
    send(creator, { type: 'signal', payload: { type: 'description', sdp: { type: 'offer', sdp: 'o' } } });
    const offer = await waitFor(joiner, 'signal');
    assert.equal(offer.payload.sdp.type, 'offer');

    send(joiner, { type: 'signal', payload: { type: 'description', sdp: { type: 'answer', sdp: 'a' } } });
    const answer = await waitFor(creator, 'signal');
    assert.equal(answer.payload.sdp.type, 'answer');

    send(creator, { type: 'signal', payload: { type: 'ice-candidate', candidate: { candidate: 'c' } } });
    const ice = await waitFor(joiner, 'signal');
    assert.equal(ice.payload.type, 'ice-candidate');

    // One peer leaves → the other is notified
    const left = waitFor(creator, 'peer-left');
    await closeWS(joiner);
    assert.ok(await left);

    await closeWS(creator);
  });
});
