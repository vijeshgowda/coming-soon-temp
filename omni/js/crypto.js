/**
 * Project A — Crypto Module
 *
 * Two-layer encryption:
 *   Layer 1: WebRTC DTLS (automatic, transport-level)
 *   Layer 2: AES-GCM with ECDH-derived keys (application-level, this file)
 *
 * The server never has access to encryption keys or plaintext.
 * All primitives use the browser-native Web Crypto API (no libraries needed).
 */

const ECDH_PARAMS   = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS    = { name: 'AES-GCM', length: 256 };

// ─── Key Generation ───────────────────────────────────────────────────────────

/** Generate a fresh ECDH keypair for this session */
export async function generateKeyPair() {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
}

/** Export public key as base64 string (safe to transmit) */
export async function exportPublicKey(keyPair) {
  const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return uint8ToBase64(new Uint8Array(raw));
}

/** Import peer's base64 public key */
export async function importPublicKey(b64) {
  const raw = base64ToUint8(b64);
  return crypto.subtle.importKey('raw', raw, ECDH_PARAMS, true, []);
}

// ─── Key Derivation ───────────────────────────────────────────────────────────

/**
 * Derive a shared AES-GCM key from our private key and their public key.
 * Both peers independently derive the same key — server never sees it.
 *
 * An optional `passphrase` (room password) is folded into the HKDF `info`
 * parameter. Both peers must supply the same passphrase to derive the same key,
 * so a stranger who only has the room code cannot read or inject messages.
 * When no passphrase is given the derivation is identical to before.
 */
export async function deriveSharedKey(privateKey, peerPublicKey, passphrase = '') {
  // Step 1: ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  );

  // Step 2: HKDF to stretch shared secret into a proper AES key
  const keyMaterial = await crypto.subtle.importKey(
    'raw', sharedBits, 'HKDF', false, ['deriveKey']
  );

  const info = new TextEncoder().encode(
    'project-a-v1' + (passphrase ? '\x00' + passphrase : '')
  );
  const params = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info };

  return crypto.subtle.deriveKey(params, keyMaterial, AES_PARAMS, false, ['encrypt', 'decrypt']);
}

// ─── Safety number (out-of-band MITM verification) ────────────────────────────

// 64 visually distinct emoji — index = 6 bits from the fingerprint hash.
const SAS_EMOJI = [
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔',
  '🐧','🐦','🦆','🦉','🦄','🐝','🦋','🐢','🐙','🐳','🐬','🐟','🌵','🌲','🍀','🌻',
  '🌙','⭐','🔥','🌈','🍎','🍋','🍓','🍒','🍕','🍔','🍪','🎂','⚽','🏀','🎸','🎺',
  '🚀','✈️','🚗','⛵','🏠','🔑','💡','📷','🎈','🎁','💎','🔔','⚓','⚡','❄️','🍩',
];

/**
 * Derive a Short Authentication String from both peers' public keys.
 * Both sides sort the keys identically, so they compute the same value.
 * Users compare it out loud / on screen to detect a man-in-the-middle on the
 * signaling channel (the server could otherwise swap keys). Returns:
 *   { emoji: '🐶 🌙 🚀 🍎 ⚽', code: 'A1B2 C3D4' }
 */
export async function safetyString(pubA, pubB) {
  const [x, y] = [pubA, pubB].sort();
  const hex = await sha256(`${x}|${y}`);
  const bytes = [];
  for (let i = 0; i < 10; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const emoji = bytes.map(b => SAS_EMOJI[b & 63]).join(' ');
  const code = hex.slice(0, 8).toUpperCase().replace(/(.{4})(.{4})/, '$1 $2');
  return { emoji, code };
}

// ─── Encryption / Decryption ──────────────────────────────────────────────────

/**
 * Encrypt data with AES-GCM.
 * Returns Uint8Array: [12-byte IV | ciphertext | 16-byte auth tag]
 */
export async function encrypt(aesKey, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // Fresh IV every message
  const encoded = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

  // Prepend IV so receiver can decrypt
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

/**
 * Decrypt AES-GCM ciphertext.
 * Returns raw ArrayBuffer — caller decodes as needed.
 */
export async function decrypt(aesKey, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const iv         = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
}

// ─── Integrity ────────────────────────────────────────────────────────────────

/** SHA-256 hash of data — returns hex string */
export async function sha256(data) {
  const buffer = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function uint8ToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToUint8(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ─── Incremental SHA-256 ──────────────────────────────────────────────────────
/**
 * Streaming SHA-256 (pure JS, no dependencies).
 *
 * Web Crypto's `crypto.subtle.digest()` needs the whole input in memory at once.
 * For large file transfers we want to hash chunks as they arrive and write them
 * straight to disk, keeping RAM usage O(1) instead of O(file size).
 *
 * Usage:
 *   const h = new IncrementalSHA256();
 *   h.update(chunk1); h.update(chunk2);
 *   const hex = h.digest();   // lowercase hex, matches sha256()
 */
const _SHA256_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class IncrementalSHA256 {
  constructor() {
    this._h = new Int32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this._block = new Uint8Array(64);
    this._blockLen = 0;
    this._len = 0; // total bytes ingested
    this._w = new Int32Array(64);
  }

  update(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this._len += bytes.length;
    let i = 0;
    if (this._blockLen > 0) {
      const take = Math.min(64 - this._blockLen, bytes.length);
      this._block.set(bytes.subarray(0, take), this._blockLen);
      this._blockLen += take;
      i = take;
      if (this._blockLen === 64) { this._process(this._block, 0); this._blockLen = 0; }
    }
    for (; i + 64 <= bytes.length; i += 64) this._process(bytes, i);
    if (i < bytes.length) {
      this._block.set(bytes.subarray(i), 0);
      this._blockLen = bytes.length - i;
    }
    return this;
  }

  digest() {
    const block = this._block;
    let blockLen = this._blockLen;
    block[blockLen++] = 0x80;
    if (blockLen > 56) {
      while (blockLen < 64) block[blockLen++] = 0;
      this._process(block, 0);
      blockLen = 0;
    }
    while (blockLen < 56) block[blockLen++] = 0;
    const dv = new DataView(block.buffer, block.byteOffset, 64);
    dv.setUint32(56, Math.floor(this._len / 0x20000000), false); // high 32 bits of bit length
    dv.setUint32(60, (this._len * 8) >>> 0, false);              // low 32 bits of bit length
    this._process(block, 0);

    let hex = '';
    for (let i = 0; i < 8; i++) hex += (this._h[i] >>> 0).toString(16).padStart(8, '0');
    return hex;
  }

  _process(p, off) {
    const w = this._w, h = this._h;
    for (let i = 0; i < 16; i++) {
      w[i] = (p[off + i * 4] << 24) | (p[off + i * 4 + 1] << 16) | (p[off + i * 4 + 2] << 8) | p[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + _SHA256_K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
}
