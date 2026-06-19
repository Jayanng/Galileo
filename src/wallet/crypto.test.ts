import assert from 'node:assert/strict';
import { encrypt, decrypt } from './crypto';

// Round-trip: encrypt then decrypt returns the original secret.
const passphrase = 'a-long-enough-test-secret-123456';
const secret = '0x' + 'ab'.repeat(32); // looks like a private key

const blob = encrypt(secret, passphrase);
assert.notEqual(blob.data, secret, 'ciphertext must not equal plaintext');
assert.equal(decrypt(blob, passphrase), secret, 'decrypt must recover the secret');

// Same input encrypts to different ciphertext each time (random salt + IV).
const blob2 = encrypt(secret, passphrase);
assert.notEqual(blob.data, blob2.data, 'each encryption must be unique');

// Wrong passphrase must fail (GCM auth tag rejects it).
assert.throws(() => decrypt(blob, 'the-wrong-passphrase-000000000000'), 'wrong key must throw');

console.log('crypto: round-trip, uniqueness, and tamper checks passed ✓');
