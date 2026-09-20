import { RgbColor } from '../types';

/**
 * A single run of text with consistent formatting.
 * Rich text is broken into multiple runs, each with its own style.
 */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: RgbColor;
}

/**
 * Parse simple XHTML/HTML rich text content into structured text runs.
 *
 * Handles the basic formatting that XFA exData content commonly uses:
 *   - <b>, <strong> → bold
 *   - <i>, <em> → italic
 *   - <br/>, <br> → newline
 *   - <span style="..."> → inline styles (font-size, color)
 *   - <p> → paragraph break
 *
 * This is intentionally limited — it covers the subset of HTML that
 * LiveCycle Designer's rich text editor actually produces. Full HTML
 * rendering is out of scope.
 */
export function parseRichText(html: string): TextRun[] {
  if (!html || !html.trim()) return [];

  const runs: TextRun[] = [];
  let remaining = html;
  let currentBold = false;
  let currentItalic = false;
  let currentFontSize: number | undefined;
  let currentColor: RgbColor | undefined;

  // State stack for nested tags
  const stateStack: Array<{
    bold: boolean;
    italic: boolean;
    fontSize?: number;
    color?: RgbColor;
  }> = [];

  while (remaining.length > 0) {
    // Find next tag
    const tagMatch = remaining.match(/^([^<]*)<(\/?)(\w+)([^>]*)>/);

    if (!tagMatch) {
      // No more tags — capture remaining text
      const text = decodeEntities(remaining.trim());
      if (text) {
        runs.push({
          text,
          bold: currentBold || undefined,
          italic: currentItalic || undefined,
          fontSize: currentFontSize,
          color: currentColor,
        });
      }
      break;
    }

    // Capture text before the tag
    const textBefore = tagMatch[1];
    if (textBefore) {
      const decoded = decodeEntities(textBefore);
      if (decoded) {
        runs.push({
          text: decoded,
          bold: currentBold || undefined,
          italic: currentItalic || undefined,
          fontSize: currentFontSize,
          color: currentColor,
        });
      }
    }

    const isClosing = tagMatch[2] === '/';
    const tagName = tagMatch[3].toLowerCase();
    const attrs = tagMatch[4];
    remaining = remaining.slice(tagMatch[0].length);

    if (isClosing) {
      // Pop state
      if (stateStack.length > 0) {
        const prev = stateStack.pop()!;
        currentBold = prev.bold;
        currentItalic = prev.italic;
        currentFontSize = prev.fontSize;
        currentColor = prev.color;
      }
    } else {
      // Push state before applying new formatting
      stateStack.push({
        bold: currentBold,
        italic: currentItalic,
        fontSize: currentFontSize,
        color: currentColor,
      });

      switch (tagName) {
        case 'b':
        case 'strong':
          currentBold = true;
          break;
        case 'i':
        case 'em':
          currentItalic = true;
          break;
        case 'br':
          runs.push({ text: '\n' });
          // Self-closing: pop state immediately
          stateStack.pop();
          break;
        case 'p':
          if (runs.length > 0) {
            runs.push({ text: '\n' });
          }
          break;
        case 'span': {
          // Parse inline style attributes
          const style = extractStyleAttr(attrs);
          if (style) {
            const fontSize = parseFontSizeFromStyle(style);
            if (fontSize) currentFontSize = fontSize;
            const color = parseColorFromStyle(style);
            if (color) currentColor = color;
          }
          break;
        }
      }
    }
  }

  return mergeAdjacentRuns(runs);
}

/**
 * Convert text runs back to a plain string (for simple rendering fallback).
 */
export function textRunsToPlainText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function extractStyleAttr(attrs: string): string | undefined {
  const match = attrs.match(/style\s*=\s*"([^"]*)"/i);
  return match?.[1];
}

function parseFontSizeFromStyle(style: string): number | undefined {
  const match = style.match(/font-size\s*:\s*([\d.]+)(pt|px|em)?/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === 'px') return value * 0.75; // px → pt
  return value;
}

function parseColorFromStyle(style: string): RgbColor | undefined {
  // rgb(R, G, B)
  const rgbMatch = style.match(/color\s*:\s*rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
  }
  // #RRGGBB or #RGB
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

/** Merge adjacent runs with identical formatting to reduce draw calls. */
function mergeAdjacentRuns(runs: TextRun[]): TextRun[] {
  if (runs.length <= 1) return runs;
  const merged: TextRun[] = [runs[0]];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = runs[i];
    if (
      prev.bold === curr.bold &&
      prev.italic === curr.italic &&
      prev.fontSize === curr.fontSize &&
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
