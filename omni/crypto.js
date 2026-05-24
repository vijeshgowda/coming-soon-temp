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
const HKDF_PARAMS   = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('project-a-v1') };
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
 */
export async function deriveSharedKey(privateKey, peerPublicKey) {
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

  return crypto.subtle.deriveKey(HKDF_PARAMS, keyMaterial, AES_PARAMS, false, ['encrypt', 'decrypt']);
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
