import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Authenticated symmetric encryption for private keys at rest.
 *
 * Each record carries its own random salt (for scrypt key derivation) and IV,
 * plus the GCM auth tag, so a single passphrase can protect many records
 * without key/IV reuse. The passphrase comes from WALLET_ENCRYPTION_KEY.
 */
export interface EncryptedBlob {
  v: 1;
  salt: string; // hex, scrypt salt
  iv: string; // hex, GCM nonce
  tag: string; // hex, GCM auth tag
  data: string; // hex, ciphertext
}

const KEY_LEN = 32; // AES-256

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN);
}

export function encrypt(plaintext: string, passphrase: string): EncryptedBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: data.toString('hex'),
  };
}

export function decrypt(blob: EncryptedBlob, passphrase: string): string {
  const key = deriveKey(passphrase, Buffer.from(blob.salt, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
  const out = Buffer.concat([decipher.update(Buffer.from(blob.data, 'hex')), decipher.final()]);
  return out.toString('utf8');
}
