/**
 * Omni — Integration Tests
 *
 * End-to-end flow tests: two clients connect via the signaling server,
 * exchange keys, and communicate over the encrypted channel.
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
  encrypt,
  decrypt,
  uint8ToBase64,
  base64ToUint8,
} = await import(join(__dirname, '..', 'js', 'crypto.js'));

let serverProcess = null;
let serverPort = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const port = 10000 + Math.floor(Math.random() * 1000);
    serverPort = port;
    serverProcess = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('listening')) resolve(port);
    });
    serverProcess.stderr.on('data', (data) => {
      if (data.toString().includes('Error')) reject(new Error(data.toString()));
    });
    setTimeout(() => reject(new Error('Server start timeout')), 5000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function connectWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function waitFor(ws, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${type}"`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function close(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.on('close', resolve);
    ws.close();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration: Full Call Flow', () => {
  beforeEach(async () => {
    await startServer();
  });

  afterEach(() => {
    stopServer();
  });

  test('full signaling negotiation: create → join → offer → answer', async () => {
    // 1. Creator creates room
    const creator = await connectWS();
    send(creator, { type: 'create', code: '' });
    const created = await waitFor(creator, 'created');

    // 2. Joiner joins
    const joiner = await connectWS();
    send(joiner, { type: 'join', code: created.code });
    const [joined, peerJoined] = await Promise.all([
      waitFor(joiner, 'joined'),
      waitFor(creator, 'peer-joined'),
    ]);
    assert.ok(joined);
    assert.ok(peerJoined);

    // 3. Creator sends offer
    const fakeOffer = { type: 'offer', sdp: { type: 'offer', sdp: 'v=0\r\n...' } };
    send(creator, { type: 'signal', payload: fakeOffer });
    const relayedOffer = await waitFor(joiner, 'signal');
    assert.deepEqual(relayedOffer.payload, fakeOffer);

    // 4. Joiner sends answer
    const fakeAnswer = { type: 'answer', sdp: { type: 'answer', sdp: 'v=0\r\n...' } };
    send(joiner, { type: 'signal', payload: fakeAnswer });
    const relayedAnswer = await waitFor(creator, 'signal');
    assert.deepEqual(relayedAnswer.payload, fakeAnswer);

    // 5. ICE candidates
    const iceCandidate = { type: 'ice-candidate', candidate: { candidate: 'a=...' } };
    send(creator, { type: 'signal', payload: iceCandidate });
    const relayedICE = await waitFor(joiner, 'signal');
    assert.deepEqual(relayedICE.payload, iceCandidate);

    await close(creator);
    await close(joiner);
  });

  test('ECDH key exchange and encrypted message roundtrip', async () => {
    // Simulate the key exchange that happens over the DataChannel
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    // Exchange public keys (normally via DataChannel)
    const alicePubB64 = await exportPublicKey(alice);
    const bobPubB64 = await exportPublicKey(bob);

    // Each side imports the other's public key and derives shared secret
    const aliceShared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(bobPubB64)
    );
    const bobShared = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(alicePubB64)
    );

    // Simulate sending an encrypted chat message
    const chatMsg = JSON.stringify({ type: 'chat', text: 'Hello from Alice!' });
    const encrypted = await encrypt(aliceShared, chatMsg);
    const b64 = uint8ToBase64(encrypted);

    // Simulate receiving and decrypting
    const received = base64ToUint8(b64);
    const decryptedBuf = await decrypt(bobShared, received);
    const decrypted = JSON.parse(new TextDecoder().decode(decryptedBuf));

    assert.equal(decrypted.type, 'chat');
    assert.equal(decrypted.text, 'Hello from Alice!');
  });

  test('encrypted file metadata roundtrip', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const aliceShared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );
    const bobShared = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(await exportPublicKey(alice))
    );

    const fileMeta = {
      type: 'file-meta',
      name: 'document.pdf',
      size: 1048576,
      mimeType: 'application/pdf',
      hash: 'abc123',
      chunks: 16,
    };

    const encrypted = await encrypt(aliceShared, JSON.stringify(fileMeta));
    const decryptedBuf = await decrypt(bobShared, encrypted);
    const result = JSON.parse(new TextDecoder().decode(decryptedBuf));

    assert.deepEqual(result, fileMeta);
  });

  test('encrypted file chunk roundtrip', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const aliceShared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );
    const bobShared = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(await exportPublicKey(alice))
    );

    // Simulate a 64KB file chunk
    const chunkData = new Uint8Array(65536);
    crypto.getRandomValues(chunkData);

    const encrypted = await encrypt(aliceShared, chunkData);

    // Simulate binary frame: [4 bytes chunk index][encrypted data]
    const chunkIndex = 0;
    const frame = new Uint8Array(4 + encrypted.byteLength);
    new DataView(frame.buffer).setUint32(0, chunkIndex, true);
    frame.set(encrypted, 4);

    // Receiver extracts
    const receivedIndex = new DataView(frame.buffer).getUint32(0, true);
    const receivedEncrypted = frame.slice(4);
    const decrypted = await decrypt(bobShared, new Uint8Array(receivedEncrypted));

    assert.equal(receivedIndex, 0);
    assert.deepEqual(new Uint8Array(decrypted), chunkData);
  });

  test('custom code room: create → join → negotiate', async () => {
    const creator = await connectWS();
    send(creator, { type: 'create', code: 'TESTROOM' });
    const created = await waitFor(creator, 'created');
    assert.equal(created.code, 'TESTROOM');
    assert.equal(created.custom, true);

    const joiner = await connectWS();
    send(joiner, { type: 'join', code: 'testroom' }); // Case insensitive
    const joined = await waitFor(joiner, 'joined');
    const peerJoined = await waitFor(creator, 'peer-joined');

    assert.ok(joined);
    assert.ok(peerJoined);

    // Signal relay works
    send(creator, { type: 'signal', payload: { type: 'offer', sdp: 'test' } });
    const sig = await waitFor(joiner, 'signal');
    assert.equal(sig.payload.sdp, 'test');

    await close(creator);
    await close(joiner);
  });

  test('reconnection: rejoin preserves room for joiner', async () => {
    // Creator creates a room
    const creator1 = await connectWS();
    send(creator1, { type: 'create', code: 'RECONNECT' });
    await waitFor(creator1, 'created');

    // Creator disconnects (grace period starts)
    await close(creator1);
    await new Promise(r => setTimeout(r, 100));

    // Joiner connects during grace period
    const joiner = await connectWS();
    send(joiner, { type: 'join', code: 'RECONNECT' });
    await waitFor(joiner, 'joined');

    // Creator reconnects and rejoins
    const creator2 = await connectWS();
    // Set up both listeners before sending to avoid race (both messages arrive in same tick)
    const rejoinedP = waitFor(creator2, 'rejoined');
    const peerJoinedP = waitFor(creator2, 'peer-joined');
    send(creator2, { type: 'rejoin', code: 'RECONNECT' });
    const rejoined = await rejoinedP;
    assert.equal(rejoined.code, 'RECONNECT');

    // Creator should be notified that joiner is already there
    const peerJoined = await peerJoinedP;
    assert.ok(peerJoined);

    await close(creator2);
    await close(joiner);
  });

  test('typing indicator message flow', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const aliceShared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );
    const bobShared = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(await exportPublicKey(alice))
    );

    // Typing indicator is a simple encrypted message
    const typingMsg = JSON.stringify({ type: 'typing' });
    const encrypted = await encrypt(aliceShared, typingMsg);
    const decrypted = await decrypt(bobShared, encrypted);
    const result = JSON.parse(new TextDecoder().decode(decrypted));

    assert.equal(result.type, 'typing');
  });
});
