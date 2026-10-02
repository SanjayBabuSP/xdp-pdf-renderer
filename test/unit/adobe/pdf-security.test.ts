import {
  rc4,
  aesCbcEncrypt,
  aesCbcDecrypt,
  objectKey,
  authenticateUserPassword,
  computeEncryptionKey,
  computeOwnerEntry,
  computeUserEntry,
} from '../../../src/adobe/crypto-utils';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('G9 — crypto primitives', () => {
  it('RC4 is symmetric and deterministic', () => {
    const key = bytes(1, 2, 3, 4, 5);
    const data = new TextEncoder().encode('The quick brown fox');
    const once = rc4(key, data);
    expect(Array.from(rc4(key, once))).toEqual(Array.from(data));
    expect(Array.from(rc4(key, data))).toEqual(Array.from(once));
  });

  it('AES-128-CBC round-trips (IV is prepended)', () => {
    const key = new Uint8Array(16).fill(7);
    const data = new TextEncoder().encode('stream contents');
    const encrypted = aesCbcEncrypt(key, data);
    expect(encrypted.length).toBeGreaterThan(data.length);
    expect(Array.from(aesCbcDecrypt(key, encrypted))).toEqual(Array.from(data));
  });

  it('derives a per-object key of the spec length', () => {
    const key = new Uint8Array(16).fill(3);
    expect(objectKey(key, 12, 0, false).length).toBe(16);
    expect(objectKey(new Uint8Array(5).fill(3), 12, 0, false).length).toBe(10);
    expect(objectKey(key, 12, 0, true).length).toBe(16);
    // AES salt makes the key differ from the RC4 key for the same object.
    expect(Array.from(objectKey(key, 12, 0, true))).not.toEqual(
      Array.from(objectKey(key, 12, 0, false))
    );
  });
});

describe('G9 — standard security handler key entries', () => {
  for (const [revision, keyLength] of [
    [2, 5],
    [3, 16],
    [4, 16],
  ] as const) {
    it(`authenticates the user password for R${revision}`, () => {
      const permissions = -4;
      const id0 = new Uint8Array(16).fill(9);

      const o = computeOwnerEntry('owner-secret', 'user-secret', revision, keyLength);
      const key = computeEncryptionKey('user-secret', o, permissions, id0, revision, keyLength);
      const u = computeUserEntry(key, id0, revision);

      expect(
        authenticateUserPassword('user-secret', o, u, permissions, id0, revision, keyLength)
      ).not.toBeNull();
      expect(
        authenticateUserPassword('nope', o, u, permissions, id0, revision, keyLength)
      ).toBeNull();
    });
  }

  it('produces a 32-byte /U entry for revision 3+', () => {
    const key = new Uint8Array(16).fill(1);
    expect(computeUserEntry(key, new Uint8Array(16), 3).length).toBe(32);
    expect(computeUserEntry(key, new Uint8Array(16), 2).length).toBe(32);
  });
});
