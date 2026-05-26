/**
 * Omni — Crypto Module Tests
 *
 * Tests key generation, key derivation, encrypt/decrypt roundtrip,
 * and SHA-256 hashing using Node.js built-in crypto.subtle.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Polyfill for Node.js (crypto.subtle available via webcrypto)
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// Import the crypto module
const CRYPTO_PATH = new URL('../js/crypto.js', import.meta.url).pathname;
const {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
  sha256,
  uint8ToBase64,
  base64ToUint8,
} = await import(CRYPTO_PATH);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Crypto Module', () => {

  // ── Key Generation ──────────────────────────────────────────────────────────

  test('generates an ECDH key pair', async () => {
    const keyPair = await generateKeyPair();
    assert.ok(keyPair.publicKey, 'Should have a public key');
    assert.ok(keyPair.privateKey, 'Should have a private key');
    assert.equal(keyPair.publicKey.type, 'public');
    assert.equal(keyPair.privateKey.type, 'private');
  });

  test('generates unique key pairs each time', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const pub1 = await exportPublicKey(kp1);
    const pub2 = await exportPublicKey(kp2);
    assert.notEqual(pub1, pub2);
  });

  // ── Public Key Export/Import ────────────────────────────────────────────────

  test('exports public key as base64 string', async () => {
    const keyPair = await generateKeyPair();
    const exported = await exportPublicKey(keyPair);
    assert.equal(typeof exported, 'string');
    assert.ok(exported.length > 0);
    // P-256 public key raw export is 65 bytes → ~88 chars base64
    assert.ok(exported.length > 50);
  });

  test('imports a public key from base64', async () => {
    const keyPair = await generateKeyPair();
    const exported = await exportPublicKey(keyPair);
    const imported = await importPublicKey(exported);
    assert.equal(imported.type, 'public');
    assert.equal(imported.algorithm.name, 'ECDH');
  });

  test('export → import roundtrip produces equivalent key', async () => {
    const keyPair = await generateKeyPair();
    const exported = await exportPublicKey(keyPair);
    const imported = await importPublicKey(exported);

    // Re-export the imported key and compare
    const raw1 = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const raw2 = await crypto.subtle.exportKey('raw', imported);
    assert.deepEqual(new Uint8Array(raw1), new Uint8Array(raw2));
  });

  // ── Key Derivation ──────────────────────────────────────────────────────────

  test('derives a shared key from two key pairs', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const alicePub = await exportPublicKey(alice);
    const bobPub = await exportPublicKey(bob);

    const aliceImportedBob = await importPublicKey(bobPub);
    const bobImportedAlice = await importPublicKey(alicePub);

    const sharedA = await deriveSharedKey(alice.privateKey, aliceImportedBob);
    const sharedB = await deriveSharedKey(bob.privateKey, bobImportedAlice);

    assert.ok(sharedA, 'Alice should derive a key');
    assert.ok(sharedB, 'Bob should derive a key');
    assert.equal(sharedA.type, 'secret');
    assert.equal(sharedB.type, 'secret');
  });

  test('both peers derive the same shared key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const alicePub = await exportPublicKey(alice);
    const bobPub = await exportPublicKey(bob);

    const sharedA = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(bobPub)
    );
    const sharedB = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(alicePub)
    );

    // Encrypt with Alice's key, decrypt with Bob's key
    const plaintext = 'Hello, secure world!';
    const ciphertext = await encrypt(sharedA, plaintext);
    const decrypted = await decrypt(sharedB, ciphertext);
    const result = new TextDecoder().decode(decrypted);

    assert.equal(result, plaintext);
  });

  // ── Encryption / Decryption ─────────────────────────────────────────────────

  test('encrypts and decrypts a string', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const shared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );

    // Use same key for both since it's symmetric AES
    const sharedB = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(await exportPublicKey(alice))
    );

    const message = 'Secret message 🔒';
    const encrypted = await encrypt(shared, message);

    assert.ok(encrypted instanceof Uint8Array);
    assert.ok(encrypted.length > 12); // At least IV + some ciphertext

    const decrypted = await decrypt(sharedB, encrypted);
    const result = new TextDecoder().decode(decrypted);
    assert.equal(result, message);
  });

  test('encrypts binary data', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const shared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );
    const sharedB = await deriveSharedKey(
      bob.privateKey,
      await importPublicKey(await exportPublicKey(alice))
    );

    const binary = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const encrypted = await encrypt(shared, binary);
    const decrypted = await decrypt(sharedB, encrypted);

    assert.deepEqual(new Uint8Array(decrypted), binary);
  });

  test('each encryption produces different ciphertext (random IV)', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const shared = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );

    const message = 'Same plaintext';
    const enc1 = await encrypt(shared, message);
    const enc2 = await encrypt(shared, message);

    // IVs should differ → ciphertext differs
    assert.notDeepEqual(enc1, enc2);
  });

  test('decrypt fails with wrong key', async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const eve = await generateKeyPair();

    const sharedAB = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(bob))
    );
    const sharedAE = await deriveSharedKey(
      alice.privateKey,
      await importPublicKey(await exportPublicKey(eve))
    );

    const encrypted = await encrypt(sharedAB, 'secret');

    await assert.rejects(
      async () => decrypt(sharedAE, encrypted),
      /operation/i // OperationError from AES-GCM auth failure
    );
  });

  // ── SHA-256 ─────────────────────────────────────────────────────────────────

  test('sha256 produces correct hash for string', async () => {
    const hash = await sha256('hello');
    // Known SHA-256 of "hello"
    assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  test('sha256 produces correct hash for binary', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const hash = await sha256(data);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 64); // 32 bytes = 64 hex chars
  });

  test('sha256 is deterministic', async () => {
    const h1 = await sha256('test');
    const h2 = await sha256('test');
    assert.equal(h1, h2);
  });

  test('sha256 different inputs produce different hashes', async () => {
    const h1 = await sha256('abc');
    const h2 = await sha256('def');
    assert.notEqual(h1, h2);
  });

  // ── Base64 Helpers ──────────────────────────────────────────────────────────

  test('uint8ToBase64 → base64ToUint8 roundtrip', () => {
    const original = new Uint8Array([0, 127, 255, 1, 200, 50]);
    const b64 = uint8ToBase64(original);
    const decoded = base64ToUint8(b64);
    assert.deepEqual(decoded, original);
  });

  test('base64ToUint8 handles empty input', () => {
    const result = base64ToUint8(uint8ToBase64(new Uint8Array(0)));
    assert.equal(result.length, 0);
  });

  test('uint8ToBase64 produces valid base64', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const b64 = uint8ToBase64(data);
    assert.equal(b64, btoa('Hello'));
  });
});
