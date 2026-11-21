import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFNumber, PDFRef } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import {
  rc4,
  aesCbcEncrypt,
  aesCbcDecrypt,
  objectKey,
  computeEncryptionKey,
  computeOwnerEntry,
  computeUserEntry,
} from '../../../src/adobe/crypto-utils';
import {
  applyPdfSecurity,
  securityDisablesObjectStreams,
  authenticateUserPassword,
} from '../../../src/adobe/pdf-security';

const bytes = (...b: number[]) => new Uint8Array(b);
const decoded = (value: PDFObject | undefined): string => (value as PDFName).decodeText();
const numbered = (value: PDFObject | undefined): number => (value as PDFNumber).asNumber();

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

describe('G9 — PDF security application', () => {
  const methods = {
    rc4_40: { v: 1, r: 2, keyLength: 5 },
    rc4_128: { v: 2, r: 3, keyLength: 16 },
    aes_128: { v: 4, r: 4, keyLength: 16 },
  } as const;

  it('reports that any security configuration disables object streams', () => {
    expect(securityDisablesObjectStreams(undefined)).toBe(false);
    expect(securityDisablesObjectStreams({})).toBe(true);
    expect(securityDisablesObjectStreams({ userPassword: 'user' })).toBe(true);
  });

  for (const name of Object.keys(methods) as Array<keyof typeof methods>) {
    it(`writes a standard encrypt dictionary for ${name}`, async () => {
      const params = methods[name];
      const doc = await PDFDocument.create();
      doc.addPage();
      doc.setTitle('protected');

      applyPdfSecurity(doc, {
        userPassword: 'user',
        ownerPassword: 'owner',
        encryptionMethod: name,
      });

      expect(doc.context.trailerInfo.Encrypt).toBeInstanceOf(PDFRef);
      const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict);
      expect(decoded(encrypt.get(PDFName.of('Filter')))).toBe('Standard');
      expect(numbered(encrypt.get(PDFName.of('V')))).toBe(params.v);
      expect(numbered(encrypt.get(PDFName.of('R')))).toBe(params.r);
      expect(numbered(encrypt.get(PDFName.of('P')))).toBe(4092);
      if (params.v > 1) {
        expect(numbered(encrypt.get(PDFName.of('Length')))).toBe(params.keyLength * 8);
      } else {
        expect(encrypt.get(PDFName.of('Length'))).toBeUndefined();
      }

      const o = encrypt.lookup(PDFName.of('O'), PDFHexString).asBytes();
      const u = encrypt.lookup(PDFName.of('U'), PDFHexString).asBytes();
      const id = doc.context.trailerInfo.ID as PDFArray;
      expect(id.size()).toBe(2);
      const id0 = id.lookup(0, PDFHexString).asBytes();

      expect(
        authenticateUserPassword('user', o, u, 4092, id0, params.r, params.keyLength)
      ).toBeInstanceOf(Uint8Array);
      expect(
        authenticateUserPassword('wrong', o, u, 4092, id0, params.r, params.keyLength)
      ).toBeNull();

      if (name === 'aes_128') {
        const cf = encrypt.lookup(PDFName.of('CF'), PDFDict);
        const stdcf = cf.lookup(PDFName.of('StdCF'), PDFDict);
        expect(decoded(stdcf.lookup(PDFName.of('CFM'), PDFName))).toBe('AESV2');
        expect(decoded(encrypt.lookup(PDFName.of('StmF'), PDFName))).toBe('StdCF');
        expect(decoded(encrypt.lookup(PDFName.of('StrF'), PDFName))).toBe('StdCF');
      } else {
        expect(encrypt.get(PDFName.of('CF'))).toBeUndefined();
      }
    });
  }

  it('defaults the owner password to the user password', async () => {
    const doc = await PDFDocument.create();

    applyPdfSecurity(doc, { userPassword: 'same', encryptionMethod: 'rc4_128' });

    const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict);
    const o = encrypt.lookup(PDFName.of('O'), PDFHexString).asBytes();
    expect(Array.from(o)).toEqual(Array.from(computeOwnerEntry('same', 'same', 3, 16)));
  });

  it('maps denied permissions to the remaining permission bits', async () => {
    const doc = await PDFDocument.create();

    applyPdfSecurity(doc, {
      userPassword: 'user',
      permissions: {
        print: false,
        modify: false,
        copy: false,
        annotate: false,
        fillForms: false,
        extract: false,
        assemble: false,
        printHighQuality: false,
        highPrint: false,
      },
    });

    const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt, PDFDict);
    expect(numbered(encrypt.get(PDFName.of('P')))).toBe((1 << 6) | (1 << 7));
  });
});
