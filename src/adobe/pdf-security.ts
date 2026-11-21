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

export interface PDFPermissions {
  print?: boolean;
  modify?: boolean;
  copy?: boolean;
  annotate?: boolean;
  fillForms?: boolean;
  extract?: boolean;
  assemble?: boolean;
  printHighQuality?: boolean;
  highPrint?: boolean;
}

export interface PDFSecurityOptions {
  userPassword?: string;
  ownerPassword?: string;
  permissions?: PDFPermissions;
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

function permissionsToInt(perms: PDFPermissions): number {
  let p = 0;
  if (perms.print) p |= 1 << 2;
  if (perms.modify) p |= 1 << 3;
  if (perms.copy) p |= 1 << 4;
  if (perms.annotate) p |= 1 << 5;
  p |= 1 << 6;
  p |= 1 << 7;
  if (perms.fillForms) p |= 1 << 8;
  if (perms.extract) p |= 1 << 9;
  if (perms.assemble) p |= 1 << 10;
  if (perms.printHighQuality || perms.highPrint) p |= 1 << 11;
  return p | 0;
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

export function applyPdfSecurity(doc: PDFDocument, options: PDFSecurityOptions): void {
  const context = doc.context;
  const { v, r, keyLength, useAES } = methodParams(options.encryptionMethod);

  const userPwd = options.userPassword ?? '';
  const ownerPwd = options.ownerPassword ?? options.userPassword ?? '';
  const perms = { ...DEFAULT_PERMISSIONS, ...options.permissions };
  const permissionBits = permissionsToInt(perms);

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

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (ref.objectNumber === encryptRef.objectNumber) continue;
    const key = objectKey(encryptionKey, ref.objectNumber, ref.generationNumber, useAES);
    const encrypted = encryptObject(object, key, useAES, context);
    if (encrypted !== object) context.assign(ref, encrypted);
  }

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
  context: PDFContext
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
  context: PDFContext
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
  context: PDFContext
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
  context: PDFContext
): PDFArray {
  const out = PDFArray.withContext(context);
  for (const value of array.asArray()) out.push(encryptObject(value, key, useAES, context));
  return out;
}

function encryptString(
  value: PDFString | PDFHexString,
  key: Uint8Array,
  useAES: boolean
): PDFHexString {
  const raw =
    value instanceof PDFHexString
      ? hexToBytes((value as unknown as { value: string }).value)
      : stringToBytes((value as unknown as { value: string }).value);
  const encrypted = useAES ? aesCbcEncrypt(key, raw) : rc4(key, raw);
  return PDFHexString.of(bytesToHex(encrypted));
}

export function securityDisablesObjectStreams(security: PDFSecurityOptions | undefined): boolean {
  return security != null;
}

export { authenticateUserPassword };
