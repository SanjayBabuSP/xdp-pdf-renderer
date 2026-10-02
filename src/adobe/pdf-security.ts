// ────────────────────────────────────────────────────────────────────────────
// PDF Security — Standard Security Handler (Revision 2/3/4, RC4 + AESV2)
//
// Implements the PDF 1.7 standard security handler end-to-end:
//   • Algorithm 2/3/4/5 key entries (`/O`, `/U`) and the file encryption key
//   • Algorithm 1 per-object keys
//   • RC4 (V1/V2) and AES-128-CBC (V4, AESV2) stream/string encryption
//   • Encrypt dictionary placed in the TRAILER, plus a random `/ID`
//
// Note: object streams must be disabled when saving (`useObjectStreams:false`)
// because pdf-lib generates them during serialization, after this pass.
// ────────────────────────────────────────────────────────────────────────────

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFStream,
  PDFString,
} from 'pdf-lib';
import type { PDFContext } from 'pdf-lib';
import {
  authenticateUserPassword,
  bytesToHex,
  computeEncryptionKey,
  computeOwnerEntry,
  computeUserEntry,
  hexToBytes,
  objectKey,
  rc4,
  aesCbcEncrypt,
  stringToBytes,
} from './crypto-utils';
import { randomBytes } from 'crypto';

/** Permission flags (PDF Standard, Table 3.20) */
export interface PDFPermissions {
  /** Allow printing (low resolution) */
  print?: boolean;
  /** Allow modifying content */
  modify?: boolean;
  /** Allow copying/extracting text */
  copy?: boolean;
  /** Allow adding/modifying annotations */
  annotate?: boolean;
  /** Allow form field filling */
  fillForms?: boolean;
  /** Allow text extraction for accessibility */
  extract?: boolean;
  /** Allow assembling (insert/delete/rotate pages) */
  assemble?: boolean;
  /** Allow high-quality printing */
  printHighQuality?: boolean;
  /** Alias for `printHighQuality`. */
  highPrint?: boolean;
}

export interface PDFSecurityOptions {
  /** User password (required to open the PDF) */
  userPassword?: string;
  /** Owner password (required to change permissions) */
  ownerPassword?: string;
  /** Permission flags */
  permissions?: PDFPermissions;
  /** Encryption method: 'rc4_40' (40-bit), 'rc4_128' (128-bit), 'aes_128' */
  encryptionMethod?: 'rc4_40' | 'rc4_128' | 'aes_128';
}

const DEFAULT_PERMISSIONS: PDFPermissions = {
  print: true,
  highPrint: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  extract: true,
  assemble: true,
  printHighQuality: true,
};

/** Convert permissions to the signed 32-bit `/P` value (Table 3.20). */
function permissionsToInt(perms: PDFPermissions): number {
  let p = 0;
  if (perms.print) p |= 1 << 2; // bit 3
  if (perms.modify) p |= 1 << 3; // bit 4
  if (perms.copy) p |= 1 << 4; // bit 5
  if (perms.annotate) p |= 1 << 5; // bit 6
  p |= 1 << 6; // bit 7 reserved = 1
  p |= 1 << 7; // bit 8 reserved = 1
  if (perms.fillForms) p |= 1 << 8; // bit 9
  if (perms.extract) p |= 1 << 9; // bit 10
  if (perms.assemble) p |= 1 << 10; // bit 11
  if (perms.printHighQuality || perms.highPrint) p |= 1 << 11; // bit 12
  return p | 0; // to signed
}

interface MethodParams {
  v: number;
  r: number;
  keyLength: number;
  useAES: boolean;
}

function methodParams(method: PDFSecurityOptions['encryptionMethod']): MethodParams {
  switch (method) {
    case 'rc4_40':
      return { v: 1, r: 2, keyLength: 5, useAES: false };
    case 'aes_128':
      return { v: 4, r: 4, keyLength: 16, useAES: true };
    case 'rc4_128':
    default:
      return { v: 2, r: 3, keyLength: 16, useAES: false };
  }
}

/**
 * Apply security settings to a PDFDocument.
 */
export function applyPdfSecurity(doc: PDFDocument, options: PDFSecurityOptions): void {
  const context = doc.context;
  const { v, r, keyLength, useAES } = methodParams(options.encryptionMethod);

  const userPwd = options.userPassword ?? '';
  const ownerPwd = options.ownerPassword ?? options.userPassword ?? '';
  const perms = { ...DEFAULT_PERMISSIONS, ...options.permissions };
  const permissionBits = permissionsToInt(perms);

  // Random document identifier: ID[0] seeds the encryption key, ID[1] is opaque.
  const id0 = new Uint8Array(randomBytes(16));
  const id1 = new Uint8Array(randomBytes(16));

  const o = computeOwnerEntry(ownerPwd, userPwd, r, keyLength);
  const encryptionKey = computeEncryptionKey(userPwd, o, permissionBits, id0, r, keyLength);
  const u = computeUserEntry(encryptionKey, id0, r);

  const encryptDict = PDFDict.withContext(context);
  encryptDict.set(PDFName.of('Filter'), PDFName.of('Standard'));
  encryptDict.set(PDFName.of('V'), PDFNumber.of(v));
  encryptDict.set(PDFName.of('R'), PDFNumber.of(r));
  if (v > 1) encryptDict.set(PDFName.of('Length'), PDFNumber.of(keyLength * 8));
  encryptDict.set(PDFName.of('O'), PDFHexString.of(bytesToHex(o)));
  encryptDict.set(PDFName.of('U'), PDFHexString.of(bytesToHex(u)));
  encryptDict.set(PDFName.of('P'), PDFNumber.of(permissionBits));

  if (useAES) {
    const stdcf = PDFDict.withContext(context);
    stdcf.set(PDFName.of('CFM'), PDFName.of('AESV2'));
    stdcf.set(PDFName.of('Length'), PDFNumber.of(16));
    stdcf.set(PDFName.of('AuthEvent'), PDFName.of('DocOpen'));
    const cf = PDFDict.withContext(context);
    cf.set(PDFName.of('StdCF'), stdcf);
    encryptDict.set(PDFName.of('CF'), cf);
    encryptDict.set(PDFName.of('StmF'), PDFName.of('StdCF'));
    encryptDict.set(PDFName.of('StrF'), PDFName.of('StdCF'));
  }

  const encryptRef = context.register(encryptDict);

  // Encrypt every other indirect object with its own key (Algorithm 1).
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (ref.objectNumber === encryptRef.objectNumber) continue;
    const key = objectKey(encryptionKey, ref.objectNumber, ref.generationNumber, useAES);
    const encrypted = encryptObject(object, key, useAES, context);
    if (encrypted !== object) context.assign(ref, encrypted);
  }

  // The Encrypt dict and /ID live in the trailer, never encrypted.
  context.trailerInfo.Encrypt = encryptRef;
  context.trailerInfo.ID = context.obj([
    PDFHexString.of(bytesToHex(id0)),
    PDFHexString.of(bytesToHex(id1)),
  ]);
}

function encryptObject(
  object: PDFObject,
  key: Uint8Array,
  useAES: boolean,
  context: PDFContext,
): PDFObject {
  if (object instanceof PDFStream) return encryptStream(object, key, useAES, context);
  if (object instanceof PDFDict) return encryptDict(object, key, useAES, context);
  if (object instanceof PDFArray) return encryptArray(object, key, useAES, context);
  if (object instanceof PDFString || object instanceof PDFHexString) {
    return encryptString(object, key, useAES);
  }
  return object;
}

function encryptStream(
  stream: PDFStream,
  key: Uint8Array,
  useAES: boolean,
  context: PDFContext,
): PDFObject {
  const dict = encryptDict(stream.dict, key, useAES, context) as PDFDict;
  const contents = stream.getContents();
  const encrypted = useAES ? aesCbcEncrypt(key, contents) : rc4(key, contents);
  return PDFRawStream.of(dict, encrypted);
}

function encryptDict(
  dict: PDFDict,
  key: Uint8Array,
  useAES: boolean,
  context: PDFContext,
): PDFDict {
  const out = PDFDict.withContext(context);
  for (const [name, value] of dict.entries()) {
    out.set(name, encryptObject(value, key, useAES, context));
  }
  return out;
}

function encryptArray(
  array: PDFArray,
  key: Uint8Array,
  useAES: boolean,
  context: PDFContext,
): PDFArray {
  const out = PDFArray.withContext(context);
  for (const value of array.asArray()) out.push(encryptObject(value, key, useAES, context));
  return out;
}

function encryptString(value: PDFString | PDFHexString, key: Uint8Array, useAES: boolean): PDFHexString {
  const raw =
    value instanceof PDFHexString
      ? hexToBytes((value as unknown as { value: string }).value)
      : stringToBytes((value as unknown as { value: string }).value);
  const encrypted = useAES ? aesCbcEncrypt(key, raw) : rc4(key, raw);
  return PDFHexString.of(bytesToHex(encrypted));
}

/**
 * Whether a document must be serialized without object streams (security is
 * applied before serialization, and pdf-lib builds object/xref streams during
 * serialization — after encryption — so they must be disabled).
 */
export function securityDisablesObjectStreams(
  security: PDFSecurityOptions | undefined,
): boolean {
  return security != null;
}

// Re-export so callers/tests can validate credentials without importing crypto-utils.
export { authenticateUserPassword };
