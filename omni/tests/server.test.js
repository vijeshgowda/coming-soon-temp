/**
 * Omni — Signaling Server Tests
 *
 * Uses Node.js built-in test runner (node:test).
 * Spawns the signaling server on a random port and tests all message flows.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'server', 'index.js');

let serverProcess = null;
let serverPort = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const port = 9000 + Math.floor(Math.random() * 1000);
    serverPort = port;
    serverProcess = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('listening')) resolve(port);
    });

    serverProcess.stderr.on('data', (data) => {
      // Ignore stderr unless it's a crash
      if (data.toString().includes('Error')) {
        reject(new Error(data.toString()));
      }
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

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function waitForMessage(ws, type, timeout = 3000) {
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

describe('Signaling Server', () => {
  beforeEach(async () => {
    await startServer();
  });

  afterEach(() => {
    stopServer();
  });

  // ── Room Creation ─────────────────────────────────────────────────────────

  test('creates a room with random code', async () => {
    const ws = await connect();
    send(ws, { type: 'create', code: '' });
    const msg = await waitForMessage(ws, 'created');

    assert.equal(msg.type, 'created');
    assert.equal(typeof msg.code, 'string');
    assert.ok(msg.code.length === 6, 'Random code should be 6 chars');
    assert.equal(msg.custom, false);

    await close(ws);
  });

  test('creates a room with custom code', async () => {
    const ws = await connect();
    send(ws, { type: 'create', code: 'MYROOM' });
    const msg = await waitForMessage(ws, 'created');

    assert.equal(msg.code, 'MYROOM');
    assert.equal(msg.custom, true);

    await close(ws);
  });

  test('rejects custom code shorter than 4 chars', async () => {
    const ws = await connect();
    send(ws, { type: 'create', code: 'AB' });
    const msg = await waitForMessage(ws, 'error');

    assert.ok(msg.message.includes('at least 4'));

    await close(ws);
  });

  test('rejects duplicate custom code (active room)', async () => {
    const ws1 = await connect();
    send(ws1, { type: 'create', code: 'TAKEN' });
    await waitForMessage(ws1, 'created');

    const ws2 = await connect();
    send(ws2, { type: 'create', code: 'TAKEN' });
    const msg = await waitForMessage(ws2, 'error');

    assert.ok(msg.message.includes('already in use'));

    await close(ws1);
    await close(ws2);
  });

  test('allows reclaiming custom code in grace period', async () => {
    const ws1 = await connect();
    send(ws1, { type: 'create', code: 'RECLAIM' });
    await waitForMessage(ws1, 'created');

    // Creator disconnects — room enters grace period
    await close(ws1);
    await new Promise(r => setTimeout(r, 100)); // Let server process the close

    // Same code should be reclaimable
    const ws2 = await connect();
    send(ws2, { type: 'create', code: 'RECLAIM' });
    const msg = await waitForMessage(ws2, 'created');

    assert.equal(msg.code, 'RECLAIM');
    assert.equal(msg.custom, true);

    await close(ws2);
  });

  // ── Room Joining ──────────────────────────────────────────────────────────

  test('joins an existing room', async () => {
    const creator = await connect();
    send(creator, { type: 'create', code: '' });
    const created = await waitForMessage(creator, 'created');

    const joiner = await connect();
    send(joiner, { type: 'join', code: created.code });
    const joined = await waitForMessage(joiner, 'joined');
    const peerJoined = await waitForMessage(creator, 'peer-joined');

    assert.equal(joined.type, 'joined');
    assert.equal(peerJoined.type, 'peer-joined');

    await close(creator);
    await close(joiner);
  });

  test('rejects joining non-existent room', async () => {
    const ws = await connect();
    send(ws, { type: 'join', code: 'NOSUCH' });
    const msg = await waitForMessage(ws, 'error');

    assert.ok(msg.message.includes('not found'));

    await close(ws);
  });

  test('rejects joining a full room', async () => {
    const creator = await connect();
    send(creator, { type: 'create', code: 'FULL' });
    await waitForMessage(creator, 'created');

    const joiner1 = await connect();
    send(joiner1, { type: 'join', code: 'FULL' });
    await waitForMessage(joiner1, 'joined');

    const joiner2 = await connect();
    send(joiner2, { type: 'join', code: 'FULL' });
    const msg = await waitForMessage(joiner2, 'error');

    assert.ok(msg.message.includes('full'));

    await close(creator);
    await close(joiner1);
    await close(joiner2);
  });

  // ── Signal Relay ──────────────────────────────────────────────────────────

  test('relays signals between peers', async () => {
    const creator = await connect();
    send(creator, { type: 'create', code: '' });
    const created = await waitForMessage(creator, 'created');

    const joiner = await connect();
    send(joiner, { type: 'join', code: created.code });
    await waitForMessage(joiner, 'joined');
    await waitForMessage(creator, 'peer-joined');

    // Creator sends offer
    send(creator, { type: 'signal', payload: { type: 'offer', sdp: 'fake-offer' } });
    const relayed = await waitForMessage(joiner, 'signal');

    assert.deepEqual(relayed.payload, { type: 'offer', sdp: 'fake-offer' });

    // Joiner sends answer
    send(joiner, { type: 'signal', payload: { type: 'answer', sdp: 'fake-answer' } });
    const relayed2 = await waitForMessage(creator, 'signal');

    assert.deepEqual(relayed2.payload, { type: 'answer', sdp: 'fake-answer' });

    await close(creator);
    await close(joiner);
  });

  // ── Peer Disconnection ────────────────────────────────────────────────────

  test('notifies peer-left when other peer disconnects', async () => {
    const creator = await connect();
    send(creator, { type: 'create', code: '' });
    const created = await waitForMessage(creator, 'created');

    const joiner = await connect();
    send(joiner, { type: 'join', code: created.code });
    await waitForMessage(joiner, 'joined');
    await waitForMessage(creator, 'peer-joined');

    // Joiner disconnects
    await close(joiner);
    const msg = await waitForMessage(creator, 'peer-left');

    assert.equal(msg.type, 'peer-left');

    await close(creator);
  });

  // ── Rejoin ────────────────────────────────────────────────────────────────

  test('handles rejoin within grace period', async () => {
    const ws1 = await connect();
    send(ws1, { type: 'create', code: 'GRACE' });
    await waitForMessage(ws1, 'created');

    // Simulate disconnect (server enters grace period)
    await close(ws1);
    await new Promise(r => setTimeout(r, 100));

    // Reconnect and rejoin
    const ws2 = await connect();
    send(ws2, { type: 'rejoin', code: 'GRACE' });
    const msg = await waitForMessage(ws2, 'rejoined');

    assert.equal(msg.type, 'rejoined');
    assert.equal(msg.code, 'GRACE');

    await close(ws2);
  });

  test('returns rejoin-failed after room is deleted', async () => {
    const ws = await connect();
    send(ws, { type: 'rejoin', code: 'NONEXIST' });
    const msg = await waitForMessage(ws, 'rejoin-failed');

    assert.equal(msg.type, 'rejoin-failed');

    await close(ws);
  });

  // ── Custom Code Normalization ─────────────────────────────────────────────

  test('normalizes custom code to uppercase', async () => {
    const ws = await connect();
    send(ws, { type: 'create', code: 'mycode' });
    const msg = await waitForMessage(ws, 'created');

    assert.equal(msg.code, 'MYCODE');

    await close(ws);
  });

  test('strips special characters from code', async () => {
    const ws = await connect();
    send(ws, { type: 'create', code: 'MY-CODE!' });
    const msg = await waitForMessage(ws, 'created');

    assert.equal(msg.code, 'MYCODE');

    await close(ws);
  });

  test('join is case-insensitive', async () => {
    const creator = await connect();
    send(creator, { type: 'create', code: 'UPPER' });
    await waitForMessage(creator, 'created');

    const joiner = await connect();
    send(joiner, { type: 'join', code: 'upper' });
    const msg = await waitForMessage(joiner, 'joined');

    assert.equal(msg.type, 'joined');

    await close(creator);
    await close(joiner);
  });

  // ── Health Check ──────────────────────────────────────────────────────────

  test('health endpoint returns 200', async () => {
    const res = await fetch(`http://localhost:${serverPort}/health`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'OK');
  });

  test('non-health endpoint returns 404', async () => {
    const res = await fetch(`http://localhost:${serverPort}/foo`);
    assert.equal(res.status, 404);
  });
});
