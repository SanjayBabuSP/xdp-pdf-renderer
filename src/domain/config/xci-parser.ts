// ────────────────────────────────────────────────────────────────────────────
// XCI Parser — Parse XFA Configuration Interface files
//
// Reference: xfaconfiguration.dll (XCI file processing)
// XCI files (like Designer.xci) control the XFA rendering pipeline:
//   - <destination> → rendering target (pdf/html/print)
//   - <fontInfo><map><equate> → font substitution rules
//   - <present><script> → script execution settings
//   - <pdf><version> → PDF version target
//   - <agent> → agent-specific overrides
// ────────────────────────────────────────────────────────────────────────────

import { FontEquateRule, ConfigSpec } from '../../types';
import { parseXml, getChild, toArray, attr, textContent } from '../../lib/xml-utils';

// ─── XCI Configuration Types ────────────────────────────────────────────

export interface XciConfig extends ConfigSpec {
  /** Rendering destination: 'pdf', 'html', or 'print' */
  destination?: string;

  /** Agent name (e.g., 'designer', 'server', 'reader') */
  agentName?: string;

  /** Script execution settings */
  scriptConfig?: XciScriptConfig;

  /** Device configuration (from XDC) */
  deviceConfig?: XciDeviceConfig;
}

export interface XciScriptConfig {
  /** Whether to execute scripts */
  enabled: boolean;
  /** Maximum cascading depth for calculate events */
  maxCascadeDepth: number;
  /** Events to fire during rendering */
  events: string[];
  /** Current page number variable */
  currentPageVariable?: string;
}

export interface XciDeviceConfig {
  /** Render library name (e.g., 'pdfldriver') */
  renderLib?: string;
  /** PDF language */
  language?: string;
  /** Whether font embedding is supported */
  supportsFontEmbedding: boolean;
  /** Whether font linking is supported */
  supportsFontLinking: boolean;
  /** Whether native linear fill is supported */
  supportsNativeLinearFill: boolean;
  /** Whether native radial fill is supported */
  supportsNativeRadialFill: boolean;
}

// ─── Parser ─────────────────────────────────────────────────────────────

/**
 * Parse an XCI (XFA Configuration Interface) XML string.
 * Reference: Designer.xci from Adobe LiveCycle Designer 11.0
 */
export function parseXci(xciXml: string): XciConfig {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xciXml);
  } catch {
    return defaultXciConfig();
  }

  const xfa = getChild(parsed, 'xfa') ?? parsed;
  const config = getChild(xfa as Record<string, unknown>, 'config') ?? xfa;
  const agent = getChild(config as Record<string, unknown>, 'agent');
  const present = getChild(config as Record<string, unknown>, 'present');

  // Extract destination
  const agentDestination = textContent(getChild(agent, 'destination'));
  const presentDestination = textContent(getChild(present, 'destination'));
  const destination = agentDestination ?? presentDestination ?? 'pdf';

  // Extract agent name
  const agentName = attr(agent, 'name') ?? 'designer';

  // Extract font equate rules from agent/pdf or present/pdf
  const agentPdf = getChild(agent, 'pdf');
  const presentPdf = getChild(present, 'pdf');
  const fontEquateRules = parseFontEquateRulesFromXci(agentPdf ?? presentPdf);

  // Extract PDF version info
  const pdfVersion = textContent(getChild(presentPdf ?? agentPdf, 'version'));
  const adobeExtensionLevel = parseInt(textContent(getChild(presentPdf ?? agentPdf, 'adobeExtensionLevel')) ?? '0', 10);

  // Extract script configuration
  const scriptEl = getChild(present, 'script');
  const scriptConfig = parseScriptConfig(scriptEl);

  return {
    destination,
    agentName,
    pdfVersion: pdfVersion ?? undefined,
    adobeExtensionLevel: isNaN(adobeExtensionLevel) ? undefined : adobeExtensionLevel,
    fontEquateRules,
    scriptConfig,
  };
}

/**
 * Parse an XDC (XML Device Configuration) XML string.
 * Reference: Designer.xdc from Adobe LiveCycle Designer 11.0
 */
export function parseXdc(xdcXml: string): XciDeviceConfig {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xdcXml);
  } catch {
    return defaultDeviceConfig();
  }

  const xdc = getChild(parsed, 'xdc') ?? parsed;
  const pdl = getChild(xdc as Record<string, unknown>, 'pdl');
  const deviceInfo = getChild(xdc as Record<string, unknown>, 'deviceInfo');

  const renderLibEl = getChild(pdl, 'renderLib');
  const renderLib = attr(renderLibEl, 'name');

  // Parse device options
  const options = toArray<unknown>(getChild(deviceInfo, 'option'));
  const optionMap = new Map<string, string>();
  for (const opt of options) {
    const name = attr(opt, 'name');
    const value = textContent(opt);
    if (name && value) optionMap.set(name, value);
  }

  return {
    renderLib: renderLib ?? undefined,
    language: optionMap.get('language') ?? 'PDF',
    supportsFontEmbedding: optionMap.get('supportsFontEmbedding') === '1',
    supportsFontLinking: optionMap.get('supportsFontLinking') === '1',
    supportsNativeLinearFill: optionMap.get('supportsNativeLinearFill') === '1',
    supportsNativeRadialFill: optionMap.get('supportsNativeRadialFill') === '1',
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────

function parseFontEquateRulesFromXci(pdfEl: unknown): FontEquateRule[] {
  if (!pdfEl) return [];
  const fontInfo = getChild(pdfEl, 'fontInfo');
  if (!fontInfo) return [];
  const map = getChild(fontInfo, 'map');
  if (!map) return [];

  const equates = toArray<unknown>(getChild(map, 'equate'));
  return equates
    .map((eq) => {
      const from = attr(eq, 'from');
      const to = attr(eq, 'to');
      if (!from || !to) return null;
      return {
        from,
        to,
        force: attr(eq, 'force') === '1',
      };
    })
    .filter(Boolean) as FontEquateRule[];
}

function parseScriptConfig(scriptEl: unknown): XciScriptConfig {
  if (!scriptEl) {
    return {
      enabled: true,
      maxCascadeDepth: 25, // Adobe default
      events: ['initialize', 'calculate', 'validate', 'ready', 'docReady'],
    };
  }

  return {
    enabled: textContent(getChild(scriptEl, 'enabled')) !== '0',
    maxCascadeDepth: parseInt(textContent(getChild(scriptEl, 'maxCascadeDepth')) ?? '25', 10),
    events: parseScriptEvents(scriptEl),
    currentPageVariable: textContent(getChild(scriptEl, 'currentPage')) ?? undefined,
  };
}

function parseScriptEvents(scriptEl: unknown): string[] {
  const eventsEl = getChild(scriptEl, 'events');
  if (!eventsEl) {
    return ['initialize', 'calculate', 'validate', 'ready', 'docReady'];
  }

  const eventEls = toArray<unknown>(getChild(eventsEl, 'event'));
  return eventEls
    .map((e) => textContent(e) ?? attr(e, 'name'))
    .filter(Boolean) as string[];
}

function defaultXciConfig(): XciConfig {
  return {
    destination: 'pdf',
    agentName: 'designer',
    fontEquateRules: [],
    scriptConfig: {
      enabled: true,
      maxCascadeDepth: 25,
      events: ['initialize', 'calculate', 'validate', 'ready', 'docReady'],
    },
  };
}

function defaultDeviceConfig(): XciDeviceConfig {
  return {
    renderLib: 'pdfldriver',
    language: 'PDF',
    supportsFontEmbedding: true,
    supportsFontLinking: true,
    supportsNativeLinearFill: true,
    supportsNativeRadialFill: true,
  };
}
