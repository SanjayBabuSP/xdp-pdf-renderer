
import { FontEquateRule, ConfigSpec } from '../../types';
import { parseXml, getChild, toArray, attr, textContent } from '../../lib/xml-utils';

export interface XciConfig extends ConfigSpec {
  destination?: string;

  agentName?: string;

  scriptConfig?: XciScriptConfig;

  deviceConfig?: XciDeviceConfig;
}

export interface XciScriptConfig {
  enabled: boolean;
  maxCascadeDepth: number;
  events: string[];
  currentPageVariable?: string;
}

export interface XciDeviceConfig {
  renderLib?: string;
  language?: string;
  supportsFontEmbedding: boolean;
  supportsFontLinking: boolean;
  supportsNativeLinearFill: boolean;
  supportsNativeRadialFill: boolean;
}

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

  const agentDestination = textContent(getChild(agent, 'destination'));
  const presentDestination = textContent(getChild(present, 'destination'));
  const destination = agentDestination ?? presentDestination ?? 'pdf';

  const agentName = attr(agent, 'name') ?? 'designer';

  const agentPdf = getChild(agent, 'pdf');
  const presentPdf = getChild(present, 'pdf');
  const fontEquateRules = parseFontEquateRulesFromXci(agentPdf ?? presentPdf);

  const pdfVersion = textContent(getChild(presentPdf ?? agentPdf, 'version'));
  const adobeExtensionLevel = parseInt(textContent(getChild(presentPdf ?? agentPdf, 'adobeExtensionLevel')) ?? '0', 10);

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
      maxCascadeDepth: 25,
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
