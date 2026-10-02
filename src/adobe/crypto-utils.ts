// ────────────────────────────────────────────────────────────────────────────
// Crypto utilities — MD5 hash for PDF security key computation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute MD5 hash of a Uint8Array.
 * Used for PDF Standard Security Handler key derivation.
 */
export function md5(input: Uint8Array): Uint8Array {
  // MD5 implementation per RFC 1321
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  // Pre-processing
  const msgLen = input.length;
  const bitLen = msgLen * 8;
  const padLen = ((56 - (msgLen + 1) % 64) + 64) % 64;

  const padded = new Uint8Array(msgLen + 1 + padLen + 8);
  padded.set(input);
  padded[msgLen] = 0x80;

  // Append length in bits as 64-bit little-endian
  const view = new DataView(padded.buffer);
  view.setUint32(msgLen + 1 + padLen, bitLen >>> 0, true);
  view.setUint32(msgLen + 1 + padLen + 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  // Initialize hash values
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Process each 64-byte block
  const M = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;

      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      const temp = D;
      D = C;
      C = B;
      B = (B + ((A + F + k[i] + M[g]) << (s[i] | 0) | (A + F + k[i] + M[g]) >>> (32 - s[i]))) >>> 0;
      A = temp;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Produce the 16-byte digest
  const digest = new Uint8Array(16);
  const dv = new DataView(digest.buffer);
  dv.setUint32(0, a0, true);
  dv.setUint32(4, b0, true);
  dv.setUint32(8, c0, true);
  dv.setUint32(12, d0, true);

  return digest;
}

// ─── PDF Standard Security Handler primitives ──────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** 32-byte password padding string from the PDF spec (Algorithm 2, step 1). */
export const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** Pad/truncate a password to 32 bytes per the PDF spec. */
export function padPassword(password: string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = new TextEncoder().encode(password);
  const len = Math.min(bytes.length, 32);
  out.set(bytes.subarray(0, len), 0);
  out.set(PASSWORD_PADDING.subarray(0, 32 - len), len);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Little-endian encoding helpers used by per-object key derivation. */
export function le32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

export function le24(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]);
}

export function le16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

export function xorKey(key: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) out[i] = key[i] ^ n;
  return out;
}

/** RC4 stream cipher (symmetric). */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/** AES-128-CBC encrypt with a random IV prepended (PDF 1.6 AESV2 objects). */
export function aesCbcEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  return concatBytes(new Uint8Array(iv), new Uint8Array(encrypted));
}

/** AES-128-CBC decrypt, stripping the prepended IV. Used by round-trip tests. */
export function aesCbcDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = data.subarray(0, 16);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  const out = Buffer.concat([decipher.update(Buffer.from(data.subarray(16))), decipher.final()]);
  return new Uint8Array(out);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function stringToBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

// ─── Standard Security Handler key algorithms ──────────────────────────────

/**
 * Algorithm 2 — compute the `/O` (owner) entry.
 */
export function computeOwnerEntry(
  ownerPassword: string,
  userPassword: string,
  revision: number,
  keyLength: number,
): Uint8Array {
  const paddedOwner = padPassword(ownerPassword || userPassword);
  const paddedUser = padPassword(userPassword);

  let digest = md5(paddedOwner);
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) digest = md5(digest);
  }
  const rc4Key = digest.subarray(0, keyLength);

  let o = rc4(rc4Key, paddedUser);
  if (revision >= 3) {
    for (let i = 1; i <= 19; i++) {
      o = rc4(xorKey(rc4Key, i), o);
    }
  }
  return o;
}

/**
 * Algorithm 3 — derive the file encryption key from the user password, `/O`,
 * `/P` and the first `/ID` string.
 */
export function computeEncryptionKey(
  userPassword: string,
  o: Uint8Array,
  permissions: number,
  id0: Uint8Array,
  revision: number,
  keyLength: number,
  encryptMetadata = true,
): Uint8Array {
  const parts = [padPassword(userPassword), o, le32(permissions), id0];
  if (revision >= 4 && !encryptMetadata) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));

  let digest = md5(concatBytes(...parts));
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) digest = md5(digest.subarray(0, keyLength));
  }
  return digest.subarray(0, keyLength);
}

/**
 * Algorithms 4 & 5 — compute the `/U` (user) entry.
 */
export function computeUserEntry(
  encryptionKey: Uint8Array,
  id0: Uint8Array,
  revision: number,
): Uint8Array {
  if (revision === 2) {
    return rc4(encryptionKey, PASSWORD_PADDING);
  }

  const digest = md5(concatBytes(PASSWORD_PADDING, id0));
  let u = rc4(encryptionKey, digest);
  for (let i = 1; i <= 19; i++) {
    u = rc4(xorKey(encryptionKey, i), u);
  }
  const out = new Uint8Array(32);
  out.set(u.subarray(0, 16), 0);
  out.set(randomBytes(16), 16);
  return out;
}

/**
 * Algorithm 1 — per-object key derived from the file key and the object's
 * number/generation (plus the AES salt for AESV2 objects).
 */
export function objectKey(
  encryptionKey: Uint8Array,
  objectNumber: number,
  generationNumber: number,
  useAES: boolean,
): Uint8Array {
  const parts = [encryptionKey, le24(objectNumber), le16(generationNumber)];
  if (useAES) parts.push(new Uint8Array([0x73, 0x41, 0x6c, 0x54])); // "sAlT"
  const digest = md5(concatBytes(...parts));
  return digest.subarray(0, Math.min(encryptionKey.length + 5, 16));
}

/**
 * Algorithm 6 — verify a user password against the stored `/U` entry
 * (used by tests and by tools that validate credentials).
 */
export function authenticateUserPassword(
  password: string,
  o: Uint8Array,
  u: Uint8Array,
  permissions: number,
  id0: Uint8Array,
  revision: number,
  keyLength: number,
  encryptMetadata = true,
): Uint8Array | null {
  const key = computeEncryptionKey(password, o, permissions, id0, revision, keyLength, encryptMetadata);
  if (revision === 2) {
    const expected = rc4(key, PASSWORD_PADDING);
    return bytesEqual(expected, u) ? key : null;
  }
  const digest = md5(concatBytes(PASSWORD_PADDING, id0));
  let test = rc4(key, digest);
  for (let i = 1; i <= 19; i++) test = rc4(xorKey(key, i), test);
  return bytesEqual(test.subarray(0, 16), u.subarray(0, 16)) ? key : null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
