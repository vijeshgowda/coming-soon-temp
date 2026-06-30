/**
 * Omni — Feature Tests
 *
 * Covers the capabilities added in the feature pass:
 *   • safetyString (crypto.js)         — SAS symmetry + MITM detection (#1)
 *   • deriveSharedKey passphrase        — room password gates the AES key (#3)
 *   • sendFile multiplexed frames       — 8-byte header demuxes by fileId (#10)
 *   • makeQrMatrix (qrcode.js)          — structural QR correctness (#11)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
  safetyString,
} = await import(join(__dirname, '..', 'js', 'crypto.js'));

const { PeerConnection } = await import(join(__dirname, '..', 'js', 'webrtc.js'));
const { makeQrMatrix, makeQrSvg } = await import(join(__dirname, '..', 'js', 'qrcode.js'));

// ─── #1 Safety number (SAS) ────────────────────────────────────────────────────

describe('Feature: safety number (SAS)', () => {
  test('is symmetric — both peers compute the same value', async () => {
    const a = await exportPublicKey(await generateKeyPair());
    const b = await exportPublicKey(await generateKeyPair());
    const fromA = await safetyString(a, b);
    const fromB = await safetyString(b, a); // reversed order
    assert.equal(fromA.code, fromB.code);
    assert.equal(fromA.emoji, fromB.emoji);
  });

  test('has the documented shape', async () => {
    const a = await exportPublicKey(await generateKeyPair());
    const b = await exportPublicKey(await generateKeyPair());
    const { emoji, code } = await safetyString(a, b);
    assert.match(code, /^[0-9A-F]{4} [0-9A-F]{4}$/);
    assert.equal(emoji.split(' ').length, 5);
  });

  test('a swapped (MITM) key yields a different safety number', async () => {
    const a = await exportPublicKey(await generateKeyPair());
    const b = await exportPublicKey(await generateKeyPair());
    const mallory = await exportPublicKey(await generateKeyPair());
    const honest = await safetyString(a, b);
    const attacked = await safetyString(a, mallory);
    assert.notEqual(honest.code, attacked.code);
  });
});

// ─── #3 Room password folded into key derivation ───────────────────────────────

describe('Feature: room password', () => {
  async function deriveBoth(passA, passB) {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const ka = await deriveSharedKey(a.privateKey, await importPublicKey(await exportPublicKey(b)), passA);
    const kb = await deriveSharedKey(b.privateKey, await importPublicKey(await exportPublicKey(a)), passB);
    return { ka, kb };
  }

  test('matching passwords derive interoperable keys', async () => {
    const { ka, kb } = await deriveBoth('hunter2', 'hunter2');
    const msg = new TextEncoder().encode('secret payload');
    const ct = await encrypt(ka, msg);
    const pt = await decrypt(kb, ct);
    assert.deepEqual(new Uint8Array(pt), msg);
  });

  test('no password stays interoperable (backward compatible)', async () => {
    const { ka, kb } = await deriveBoth('', '');
    const msg = new TextEncoder().encode('hello');
    const pt = await decrypt(kb, await encrypt(ka, msg));
    assert.deepEqual(new Uint8Array(pt), msg);
  });

  test('mismatched passwords cannot decrypt each other', async () => {
    const { ka, kb } = await deriveBoth('correct', 'wrong');
    const ct = await encrypt(ka, new TextEncoder().encode('top secret'));
    await assert.rejects(() => decrypt(kb, ct), /operation|decrypt/i);
  });
});

// ─── #10 Multiplexed file frames ────────────────────────────────────────────────

describe('Feature: multiplexed file transfer', () => {
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

  async function deriveBothKeys() {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const ka = await deriveSharedKey(a.privateKey, await importPublicKey(await exportPublicKey(b)));
    const kb = await deriveSharedKey(b.privateKey, await importPublicKey(await exportPublicKey(a)));
    return { ka, kb };
  }

  test('two interleaved transfers demultiplex by fileId', async () => {
    const { ka, kb } = await deriveBothKeys();

    const dataA = new Uint8Array(150 * 1024).map((_, i) => (i * 3 + 1) & 0xff);
    const dataB = new Uint8Array(90 * 1024).map((_, i) => (i * 5 + 9) & 0xff);
    const fileA = new File([dataA], 'a.bin');
    const fileB = new File([dataB], 'b.bin');

    const peer = new PeerConnection({ sendSignal() {} }, true, []);
    peer.sharedKey = ka;
    peer.dataChannel = makeFakeDataChannel();

    // Distinct fileIds, sent concurrently to interleave their frames.
    await Promise.all([
      peer.sendFile(fileA, { fileId: 1001 }),
      peer.sendFile(fileB, { fileId: 2002 }),
    ]);

    // Receiver: demultiplex by fileId, just like app.js.
    const byId = new Map();
    let metaCount = 0;
    for (const frame of peer.dataChannel.frames) {
      if (typeof frame === 'string') {
        const wrapper = JSON.parse(frame);
        const plain = await decrypt(kb, new Uint8Array(Buffer.from(wrapper.data, 'base64')));
        const inner = JSON.parse(new TextDecoder().decode(plain));
        if (inner.type === 'file-meta') {
          metaCount++;
          byId.set(inner.fileId, { meta: inner, chunks: new Array(inner.chunks) });
        }
      } else {
        const view = new DataView(frame);
        const fileId = view.getUint32(0, true);
        const idx = view.getUint32(4, true);
        const plainBuf = await decrypt(kb, new Uint8Array(frame.slice(8)));
        byId.get(fileId).chunks[idx] = new Uint8Array(plainBuf);
      }
    }

    assert.equal(metaCount, 2, 'two file-meta messages, one per transfer');
    assert.ok(byId.has(1001) && byId.has(2002), 'both fileIds present');

    const reassemble = (rx) => {
      const out = new Uint8Array(rx.meta.size);
      let off = 0;
      for (const c of rx.chunks) { out.set(c, off); off += c.byteLength; }
      return out;
    };
    assert.deepEqual(reassemble(byId.get(1001)), dataA);
    assert.deepEqual(reassemble(byId.get(2002)), dataB);
  });

  test('frame header is 8 bytes: fileId then chunkIndex', async () => {
    const { ka } = await deriveBothKeys();
    const peer = new PeerConnection({ sendSignal() {} }, true, []);
    peer.sharedKey = ka;
    peer.dataChannel = makeFakeDataChannel();
    await peer.sendFile(new File([new Uint8Array(70 * 1024)], 'x.bin'), { fileId: 0xABCDEF01 >>> 0 });

    const bin = peer.dataChannel.frames.find(f => typeof f !== 'string');
    const view = new DataView(bin);
    assert.equal(view.getUint32(0, true), 0xABCDEF01 >>> 0, 'fileId at offset 0');
    assert.equal(view.getUint32(4, true), 0, 'first chunkIndex is 0 at offset 4');
  });
});

// ─── #11 QR code generator ───────────────────────────────────────────────────────

describe('Feature: QR code generator', () => {
  test('module matrix is square and odd-sized (17 + 4·version)', () => {
    const m = makeQrMatrix('https://example.com/omni/#ABCDEF');
    assert.ok(Array.isArray(m) && m.length > 0);
    const size = m.length;
    assert.ok(m.every(row => row.length === size), 'matrix is square');
    assert.equal((size - 17) % 4, 0, 'size is 17 + 4·version');
  });

  test('finder patterns present in all three corners', () => {
    const m = makeQrMatrix('hello world');
    const size = m.length;
    // Each finder is a 7×7 block whose outer ring is dark and center 3×3 is dark.
    const isFinder = (ox, oy) => {
      // corners of the 7x7 must be dark; the ring at radius 2 must be light at (ox+1,oy+1)
      return m[oy][ox] && m[oy + 6][ox] && m[oy][ox + 6] && m[oy + 6][ox + 6]
        && !m[oy + 1][ox + 1] && m[oy + 3][ox + 3];
    };
    assert.ok(isFinder(0, 0), 'top-left finder');
    assert.ok(isFinder(size - 7, 0), 'top-right finder');
    assert.ok(isFinder(0, size - 7), 'bottom-left finder');
  });

  test('timing patterns alternate on row/column 6', () => {
    const m = makeQrMatrix('timing pattern check 12345');
    const size = m.length;
    for (let i = 8; i < size - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, `row-6 timing at ${i}`);
      assert.equal(m[i][6], i % 2 === 0, `col-6 timing at ${i}`);
    }
  });

  test('higher ECC or longer text needs an equal-or-larger version', () => {
    const small = makeQrMatrix('hi', 'LOW').length;
    const big = makeQrMatrix('x'.repeat(300), 'HIGH').length;
    assert.ok(big >= small);
  });

  test('makeQrSvg emits a valid-looking SVG', () => {
    const svg = makeQrSvg('https://example.com/omni/#ROOM42');
    assert.match(svg, /^<svg /);
    assert.match(svg, /viewBox="0 0 \d+ \d+"/);
    assert.match(svg, /<path d="M/);
  });
});
