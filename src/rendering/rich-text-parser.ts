import { RgbColor } from '../types';

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  color?: RgbColor;
  fontFamily?: string;
  lineAdvance?: number;
  marginTop?: number;
  marginBottom?: number;
  spacerOnly?: boolean;
}

interface RichState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize?: number;
  color?: RgbColor;
  fontFamily?: string;
  lineAdvance?: number;
  marginTop?: number;
  marginBottom?: number;
  spacerOnly?: boolean;
}

interface StateFrame {
  state: RichState;
  tagName: string;
  inSpacer: boolean;
}

const BODY_BASELINE: RichState = { bold: false, italic: false, underline: false };

export function parseRichText(html: string): TextRun[] {
  if (!html || !html.trim()) return [];

  const runs: TextRun[] = [];
  const spacerRuns = new Set<TextRun>();
  let remaining = decodeEntities(html);
  let state: RichState = { ...BODY_BASELINE };
  const stateStack: StateFrame[] = [];
  let spacerDepth = 0;

  const pushRun = (text: string): void => {
    if (!text) return;
    const run: TextRun = {
      text,
      bold: state.bold || undefined,
      italic: state.italic || undefined,
      underline: state.underline || undefined,
      fontSize: state.fontSize,
      color: state.color,
      fontFamily: state.fontFamily,
      lineAdvance: state.lineAdvance,
      marginTop: state.marginTop,
      marginBottom: state.marginBottom,
    };
    runs.push(run);
    if (spacerDepth > 0 && text.includes('\u00a0')) spacerRuns.add(run);
  };

  while (remaining.length) {
    const tagMatch = remaining.match(/^([^<]*)<(\/?)(\w+)([^>]*)>/);

    if (!tagMatch) {
      pushRun(remaining);
      break;
    }

    pushRun(tagMatch[1]);

    const isClosing = tagMatch[2] === '/';
    const tagName = tagMatch[3].toLowerCase();
    const attrs = tagMatch[4];
    remaining = remaining.slice(tagMatch[0].length);

    if (isClosing) {
      const matchIndex = findFrameIndex(stateStack, tagName);
      if (matchIndex < 0) {
        if (tagName === 'p' || tagName === 'div') state = { ...BODY_BASELINE };
        continue;
      }
      const matched = stateStack[matchIndex];
      while (stateStack.length > matchIndex) {
        const frame = stateStack.pop();
        if (frame?.inSpacer) spacerDepth--;
      }
      state = matched.state;
      continue;
    }

    if (tagName === 'br') {
      pushRun('\n');
      continue;
    }

    const inSpacer = /xfa-spacerun\s*:\s*yes/i.test(attrs);
    stateStack.push({ state: { ...state }, tagName, inSpacer });
    if (inSpacer) spacerDepth++;
    switch (tagName) {
      case 'b':
      case 'strong':
        state.bold = true;
        break;
      case 'i':
      case 'em':
        state.italic = true;
        break;
      case 'p':
      case 'div':
        if (runs.length) pushRun('\n');
        applyStyleFromAttrs(state, attrs);
        break;
      case 'body':
      case 'span':
        applyStyleFromAttrs(state, attrs);
        break;
    }
  }

  markSpacerParagraphs(runs, spacerRuns);
  return mergeAdjacentRuns(runs);
}

function findFrameIndex(frames: StateFrame[], tagName: string): number {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].tagName === tagName) return i;
  }
  return -1;
}

function markSpacerParagraphs(runs: TextRun[], spacerRuns: ReadonlySet<TextRun>): void {
  let start = 0;
  for (let i = 0; i <= runs.length; i++) {
    if (i < runs.length && runs[i].text !== '\n') continue;
    const paragraph = runs.slice(start, i);
    if (paragraph.length && paragraph.some((run) => spacerRuns.has(run))) {
      const content = paragraph.map((run) => run.text).join('');
      if (/^[\u00a0]+$/.test(content)) {
        for (const run of paragraph) run.spacerOnly = true;
      }
    }
    start = i + 1;
  }
}

export function textRunsToPlainText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t\n\r\f\v]+/g, ' ');
}

function extractStyleAttr(attrs: string): string | undefined {
  const match = attrs.match(/style\s*=\s*"([^"]*)"/i);
  return match?.[1];
}

function applyStyleFromAttrs(state: RichState, attrs: string): void {
  const style = extractStyleAttr(attrs);
  if (!style) return;

  const weight = style
    .match(/font-weight\s*:\s*([^;]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
  if (weight) state.bold = weight === 'bold' || weight === 'bolder' || /^[6-9]\d\d$/.test(weight);

  const fontStyle = style
    .match(/font-style\s*:\s*([^;]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
  if (fontStyle) state.italic = fontStyle === 'italic' || fontStyle === 'oblique';

  const decoration = style.match(/text-decoration\s*:\s*([^;]+)/i)?.[1]?.toLowerCase();
  if (decoration) {
    state.underline = !decoration.includes('none') && decoration.includes('underline');
  }

  const fontSize = parseFontSizeFromStyle(style);
  if (fontSize) state.fontSize = fontSize;

  const lineAdvance = parseLineAdvanceFromStyle(style, state.fontSize);
  if (lineAdvance !== undefined) state.lineAdvance = lineAdvance;
  const marginTop = parseSpacingFromStyle(style, 'top');
  if (marginTop !== undefined) state.marginTop = marginTop;
  const marginBottom = parseSpacingFromStyle(style, 'bottom');
  if (marginBottom !== undefined) state.marginBottom = marginBottom;

  const color = parseColorFromStyle(style);
  if (color) state.color = color;

  const fontFamily = parseFontFamilyFromStyle(style);
  if (fontFamily) state.fontFamily = fontFamily;
}

function parseLineAdvanceFromStyle(style: string, fontSize?: number): number | undefined {
  const match = style.match(/line-height\s*:\s*([\d.]+)(pt|px|em|%)?/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2]?.toLowerCase();
  if (unit === 'pt') return value;
  if (unit === 'px') return value * 0.75;
  if (unit === '%') return fontSize === undefined ? undefined : (value / 100) * fontSize;
  return fontSize === undefined ? value : value * fontSize;
}

const MARGIN_TOP_RE = /(?:^|;)\s*margin-top\s*:\s*(-?[\d.]+)(pt|px)?/i;
const MARGIN_BOTTOM_RE = /(?:^|;)\s*margin-bottom\s*:\s*(-?[\d.]+)(pt|px)?/i;

function parseSpacingFromStyle(style: string, property: 'top' | 'bottom'): number | undefined {
  const match = style.match(property === 'top' ? MARGIN_TOP_RE : MARGIN_BOTTOM_RE);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  return match[2]?.toLowerCase() === 'px' ? value * 0.75 : value;
}

function parseFontFamilyFromStyle(style: string): string | undefined {
  const match = style.match(/font-family\s*:\s*([^;]+)/i);
  if (!match) return undefined;
  const value = match[1].trim();
  const quoted = value.match(/'([^']+)'|"([^"]+)"/);
  if (quoted) return (quoted[1] ?? quoted[2]).trim();
  const first = value
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '');
  return first || undefined;
}

function parseFontSizeFromStyle(style: string): number | undefined {
  const match = style.match(/font-size\s*:\s*([\d.]+)(pt|px|em)?/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === 'px') return value * 0.75;
  return value;
}

function parseColorFromStyle(style: string): RgbColor | undefined {
  const rgbMatch = style.match(/color\s*:\s*rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
  }
  const hexMatch = style.match(/color\s*:\s*#([0-9a-f]{3,6})/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }
  return undefined;
}

function mergeAdjacentRuns(runs: TextRun[]): TextRun[] {
  if (runs.length <= 1) return runs;
  const merged: TextRun[] = [runs[0]];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = runs[i];
    if (
      prev.bold === curr.bold &&
      prev.italic === curr.italic &&
      prev.underline === curr.underline &&
      prev.fontSize === curr.fontSize &&
      prev.fontFamily === curr.fontFamily &&
      prev.lineAdvance === curr.lineAdvance &&
      prev.marginTop === curr.marginTop &&
      prev.marginBottom === curr.marginBottom &&
      prev.spacerOnly === curr.spacerOnly &&
      colorsEqual(prev.color, curr.color)
    ) {
      prev.text += curr.text;
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function colorsEqual(a?: RgbColor, b?: RgbColor): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}
