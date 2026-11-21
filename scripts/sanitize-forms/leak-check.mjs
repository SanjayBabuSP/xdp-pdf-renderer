
import { tokenize, parseAttrs, decode, localName } from './xml-tokens.mjs';
import { isAllowedUrl, hostOf } from './scrambler.mjs';
import { lexScript, literal, scriptLanguage } from './script-literals.mjs';
import { hasMarker, sniffImage } from './placeholder-image.mjs';
import { sha256 } from './transform.mjs';
import { visitNames, GENERATED } from './names.mjs';
import { isGenericName } from './generic-words.mjs';

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_PATTERN = /\b(?:https?|ftp|file):\/\/[^\s"'<>]+|\bwww\.[\w-]+(?:\.[\w-]+)+[^\s"'<>]*/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\s"'<>]*|\\\\[\w.$-]+\\[^\s"'<>]*/g;
const BASE64_BLOB = /^[A-Za-z0-9+/=\s]{200,}$/;
const CAMEL_PARTS = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{L}+/gu;

export function mask(s) {
  const chars = [...s];
  const n = chars.length;
  if (n <= 2) return `${'*'.repeat(n)} (${n})`;
  return `${chars[0]}${'*'.repeat(n - 2)}${chars[n - 1]} (${n})`;
}

export function scan(text) {
  const values = new Set();
  const words = new Map();
  const images = [];
  const plain = [];
  const keepWord = (w) => {
    const key = w.toLowerCase();
    if (!words.has(key)) words.set(key, w);
  };
  const addWords = (s) => {
    for (const run of s.match(/\p{L}+/gu) ?? []) {
      keepWord(run);
      for (const part of run.match(CAMEL_PARTS) ?? []) keepWord(part);
    }
  };

  const stack = [];
  for (const token of tokenize(text)) {
    if (token.type === 'open' || token.type === 'empty') {
      const attrs = parseAttrs(token.raw);
      addWords(token.name);
      for (const attr of attrs) {
        addWords(attr.name);
        addWords(attr.value);
        values.add(attr.value.trim());
      }
      plain.push(token.raw);
      if (token.type === 'open') {
        stack.push({ local: localName(token.name), contentType: attrs.find((a) => a.name === 'contentType')?.value });
      }
      continue;
    }
    if (token.type === 'close') {
      stack.pop();
      plain.push(token.raw);
      continue;
    }
    const top = stack[stack.length - 1];
    let value = token.raw;
    if (token.type === 'text') value = decode(token.raw);
    else if (token.type === 'cdata') value = token.raw.slice(9, -3);
    else if (token.type === 'comment') value = token.raw.slice(4, -3);

    if ((token.type === 'text' || token.type === 'cdata') && value.trim()) {
      const inImage = top?.local === 'image';
      if (inImage || BASE64_BLOB.test(value)) {
        const buf = Buffer.from(value.replace(/\s+/g, ''), 'base64');
        if (inImage || sniffImage(buf)) {
          images.push(buf);
          continue;
        }
      }
      if (top?.local === 'script') {
        for (const part of lexScript(value, scriptLanguage(top.contentType))) {
          if (part.kind === 'string') values.add(literal(part).content.trim());
        }
      }
    }
    plain.push(value);
    addWords(value);
    values.add(value.trim());
  }
  return { values, words, images, plain: plain.join('\n') };
}

export function leakProblems(rel, scanned, known) {
  const problems = [];
  for (const value of known.replacedValues) {
    if (!known.structuralValues.has(value) && scanned.values.has(value)) {
      problems.push({ rel, kind: 'original text value', sample: mask(value) });
    }
  }
  for (const [key, word] of scanned.words) {
    if (key.length >= 5 && known.replacedWords.has(key) && !known.structuralWords.has(key)) {
      problems.push({ rel, kind: 'original word', sample: mask(word) });
    }
  }
  for (const image of scanned.images) {
    if (known.originalImageHashes.has(sha256(image))) problems.push({ rel, kind: 'original image' });
  }
  const lower = scanned.plain.toLowerCase();
  for (const term of known.terms) {
    if (lower.includes(term.toLowerCase())) problems.push({ rel, kind: 'listed term', sample: mask(term) });
  }
  return problems;
}

export function auditProblems(rel, scanned) {
  const problems = [];
  for (const email of scanned.plain.match(EMAIL) ?? []) {
    if (!/@example\.(com|org)$/i.test(email)) problems.push({ rel, kind: 'email address', sample: mask(email) });
  }
  for (const url of scanned.plain.match(URL_PATTERN) ?? []) {
    if (!isAllowedUrl(url)) problems.push({ rel, kind: 'url', sample: mask(hostOf(url)) });
  }
  for (const found of scanned.plain.match(WINDOWS_PATH) ?? []) {
    problems.push({ rel, kind: 'windows path', sample: mask(found) });
  }
  for (const image of scanned.images) {
    if (!hasMarker(image)) problems.push({ rel, kind: 'image without placeholder marker' });
  }
  return problems;
}

export function nameLeakProblems(file, renamedNames) {
  const found = new Set();
  visitNames(file, { add: (name) => renamedNames.has(name) && found.add(name) });
  return [...found].map((name) => ({ rel: file.rel, kind: 'original name', sample: mask(name) }));
}

export function nameAuditProblems(file, genericWords) {
  const found = new Set();
  visitNames(file, {
    add: (name) => name && !GENERATED.test(name) && !isGenericName(name, genericWords) && found.add(name),
  });
  return [...found].map((name) => ({ rel: file.rel, kind: 'unrecognised name', sample: mask(name) }));
}

export function report(problems, log = console.error) {
  const counts = new Map();
  for (const p of problems) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  log(`Privacy check failed: ${problems.length} problem(s)`);
  for (const [kind, n] of counts) log(`  ${kind}: ${n}`);
  for (const p of problems.slice(0, 40)) log(`    ${p.kind.padEnd(34)} ${p.rel}  ${p.sample ?? ''}`);
  if (problems.length > 40) log(`    … ${problems.length - 40} more`);
}
