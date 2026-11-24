import type { LayoutModel, Result } from '../../../types';
import { success, failure } from '../../../lib/result-type';
import { parseXml, getChild, toArray, attr } from '../../../lib/xml-utils';
import { ERROR_CODES } from '../../../errors/error-codes';
import { stampUids } from '../../../lib/node-uid';
import { stampInheritedFontSizes } from './inherit-font-size';
import { validateXfaNamespaces } from '../../../adobe/xfa-namespace-validation';
import { orderedTemplateKids, firstOrderedSubformKids } from './ordered';
import { parsePages } from './page';
import { parseChildren } from './subform';
import { parseConfig, parseConnectionSet } from './config';
import { parseVariables, parseDocumentMetadata } from './metadata';
import { parseEvents } from './helpers';

const TEMPLATE_NAMESPACES = [
  'http://www.xfa.org/schema/xfa-template/2.8/',
  'http://www.xfa.org/schema/xfa-template/3.3/',
  'http://www.xfa.org/schema/xfa-template/3.6/',
];

export interface XdpParseOptions {
  strict?: boolean;
  maxInputSize?: number;
}

export function parseXdp(xdpXml: string, options: XdpParseOptions = {}): Result<LayoutModel> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xdpXml, options.maxInputSize);
  } catch (e) {
    return failure(ERROR_CODES.MALFORMED_XML.code, `${ERROR_CODES.MALFORMED_XML.message}: ${e}`);
  }

  const root = getChild(parsed, 'xdp:xdp') ?? getChild(parsed, 'xdp');
  if (!root) return failure(ERROR_CODES.INVALID_XDP.code, ERROR_CODES.INVALID_XDP.message);

  const template = findTemplate(root as Record<string, unknown>);
  if (!template)
    return failure(ERROR_CODES.MISSING_TEMPLATE.code, ERROR_CODES.MISSING_TEMPLATE.message);

  const namespaceResult = validateXfaNamespaces(
    collectNamespaces(root as Record<string, unknown>, template),
    options.strict === true
  );
  if (!namespaceResult.valid) {
    return failure(
      ERROR_CODES.UNSUPPORTED_NAMESPACE.code,
      namespaceResult.errors.join('; ') || 'Unsupported XFA template namespace'
    );
  }

  const rootSubform = findRootSubform(template);
  if (!rootSubform)
    return failure(ERROR_CODES.MISSING_ROOT_SUBFORM.code, ERROR_CODES.MISSING_ROOT_SUBFORM.message);

  const orderedRootKids = orderedTemplateKids(xdpXml);
  const orderedRootSubformKids = firstOrderedSubformKids(orderedRootKids);

  const pages = parsePages(rootSubform, orderedRootSubformKids);
  const children = parseChildren(rootSubform, orderedRootSubformKids);
  const config = parseConfig(getChild(root as Record<string, unknown>, 'config'));
  const connection = parseConnectionSet(getChild(root as Record<string, unknown>, 'connectionSet'));
  const variables = parseVariables(getChild(rootSubform, 'variables'));
  const rootEvents = parseEvents(getChild(rootSubform, 'event'));
  const metadata = parseDocumentMetadata(root as Record<string, unknown>, rootSubform);

  stampUids([children, ...pages.map((page) => page.masterPageChildren)]);
  stampInheritedFontSizes(children);
  for (const page of pages) stampInheritedFontSizes(page.masterPageChildren);

  return success({
    rootSubformName: attr(rootSubform, 'name') ?? 'value',
    locale: attr(rootSubform, 'locale'),
    pages,
    children,
    rootEvents,
    variables,
    config,
    ...connection,
    metadata,
    version: namespaceResult.detectedVersion ?? undefined,
    warnings: namespaceResult.warnings.length ? namespaceResult.warnings : undefined,
  } as LayoutModel);
}

function collectNamespaces(
  root: Record<string, unknown>,
  template: unknown
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const element of [root, template]) {
    if (!element || typeof element !== 'object') continue;
    for (const key of Object.keys(element as Record<string, unknown>)) {
      if (key === '@_xmlns') {
        out[''] = String((element as Record<string, unknown>)[key]);
      } else if (key.startsWith('@_xmlns:')) {
        out[key.slice('@_xmlns:'.length)] = String((element as Record<string, unknown>)[key]);
      }
    }
  }
  return out;
}

function findTemplate(root: Record<string, unknown>): unknown {
  if (root['template']) return root['template'];
  for (const key of Object.keys(root)) {
    if (key === 'template' || key.endsWith(':template')) return root[key];
  }
  return undefined;
}

function findRootSubform(template: unknown): unknown {
  const subforms = toArray(getChild(template, 'subform'));
  return subforms[0] ?? null;
}

void TEMPLATE_NAMESPACES;
