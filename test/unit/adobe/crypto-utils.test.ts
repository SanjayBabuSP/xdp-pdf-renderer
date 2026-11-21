import {
  md5,
  PASSWORD_PADDING,
  padPassword,
  concatBytes,
  le32,
  le24,
  le16,
  xorKey,
  bytesToHex,
  hexToBytes,
  stringToBytes,
  bytesToBinaryString,
} from '../../../src/adobe/crypto-utils';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('G9 — crypto utilities', () => {
  it('computes MD5 digests matching known test vectors', () => {
    expect(bytesToHex(md5(utf8('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(bytesToHex(md5(utf8('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(bytesToHex(md5(utf8('message digest')))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  it('pads passwords to 32 bytes and truncates longer ones', () => {
    expect(padPassword('')).toEqual(PASSWORD_PADDING);
    expect(padPassword('secret')).toEqual(
      concatBytes(utf8('secret'), PASSWORD_PADDING.subarray(0, 26))
    );
    expect(padPassword('x'.repeat(40))).toEqual(utf8('x'.repeat(32)));
  });

  it('concatenates byte arrays in order', () => {
    expect(concatBytes(bytes(1, 2), bytes(), bytes(3))).toEqual(bytes(1, 2, 3));
    expect(concatBytes().length).toBe(0);
  });

  it('encodes little-endian integers of fixed widths', () => {
    expect(le32(0x12345678)).toEqual(bytes(0x78, 0x56, 0x34, 0x12));
    expect(le24(0x123456)).toEqual(bytes(0x56, 0x34, 0x12));
    expect(le16(0x1234)).toEqual(bytes(0x34, 0x12));
  });

  it('xors every byte of a key with the same value', () => {
    expect(xorKey(bytes(0x0f, 0xf0, 0x55), 0xaa)).toEqual(bytes(0xa5, 0x5a, 0xff));
  });

  it('round-trips hex, character-code strings and binary strings', () => {
    expect(bytesToHex(bytes(0x00, 0x0f, 0xab, 0xff))).toBe('000fabff');
    expect(hexToBytes('abc')).toEqual(bytes(0x0a, 0xbc));
    expect(stringToBytes('A\xff')).toEqual(bytes(0x41, 0xff));
    expect(bytesToBinaryString(bytes(65, 66, 67))).toBe('ABC');
  });
});
