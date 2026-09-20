// ────────────────────────────────────────────────────────────────────────────
// XFA Namespace Validation — Strict validation of XFA template namespaces
// Supports XFA 2.8, 3.3, 3.6, and provides backward compatibility warnings
// ────────────────────────────────────────────────────────────────────────────

export interface NamespaceValidationResult {
  /** Whether the namespace is valid */
  valid: boolean;
  /** The detected namespace version */
  detectedVersion: string | null;
  /** Warning messages */
  warnings: string[];
  /** Error messages */
  errors: string[];
  /** Whether backward compatibility mode is needed */
  backwardCompat: boolean;
}

/** Known XFA template namespaces */
const KNOWN_NAMESPACES: Record<string, { version: string; supported: boolean }> = {
  'http://www.xfa.org/schema/xfa-template/2.0/': { version: '2.0', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.1/': { version: '2.1', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.2/': { version: '2.2', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.3/': { version: '2.3', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.4/': { version: '2.4', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.5/': { version: '2.5', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.6/': { version: '2.6', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.7/': { version: '2.7', supported: false },
  'http://www.xfa.org/schema/xfa-template/2.8/': { version: '2.8', supported: true },
  'http://www.xfa.org/schema/xfa-template/3.0/': { version: '3.0', supported: false },
  'http://www.xfa.org/schema/xfa-template/3.1/': { version: '3.1', supported: false },
  'http://www.xfa.org/schema/xfa-template/3.2/': { version: '3.2', supported: false },
  'http://www.xfa.org/schema/xfa-template/3.3/': { version: '3.3', supported: true },
  'http://www.xfa.org/schema/xfa-template/3.4/': { version: '3.4', supported: false },
  'http://www.xfa.org/schema/xfa-template/3.5/': { version: '3.5', supported: false },
  'http://www.xfa.org/schema/xfa-template/3.6/': { version: '3.6', supported: true },
};

/** Elements/attributes that differ between XFA versions */
const VERSION_DIFFERENCES: Record<string, Record<string, string>> = {
  '3.3': {
    'subform@layout': 'Added "position" as explicit layout mode',
    'assist': 'Added accessibility assist element',
    'relevant': 'Enhanced relevance handling',
    'calc': 'New calculation engine features',
  },
  '3.6': {
    'subform@layout': 'Added "tbrl" (top-to-bottom, right-to-left) layout',
    'field@access': 'Enhanced access control',
    'script@runAt': 'Added "docReady" runAt value',
    'pdf': 'Enhanced PDF rendering options',
  },
};

/**
 * Validate XFA namespace declarations in an XDP document.
 * Detects the XFA version and provides compatibility warnings.
 */
export function validateXfaNamespaces(
  namespaceDeclarations: Record<string, string>,
  strict: boolean = false
): NamespaceValidationResult {
  const result: NamespaceValidationResult = {
    valid: true,
    detectedVersion: null,
    warnings: [],
    errors: [],
    backwardCompat: false,
  };

  // Find the template namespace
  let templateNs: string | null = null;
  for (const [, uri] of Object.entries(namespaceDeclarations)) {
    if (uri.includes('xfa-template')) {
      templateNs = uri;
      break;
    }
  }

  if (!templateNs) {
    result.warnings.push('No XFA template namespace found — assuming XFA 3.3');
    result.detectedVersion = '3.3';
    return result;
  }

  const nsInfo = KNOWN_NAMESPACES[templateNs];
  if (nsInfo) {
    result.detectedVersion = nsInfo.version;

    if (nsInfo.supported) {
      result.valid = true;
    } else if (strict) {
      result.valid = false;
      result.errors.push(
        `XFA template namespace ${nsInfo.version} is not directly supported. ` +
        `Supported versions: 2.8, 3.3, 3.6`
      );
    } else {
      result.warnings.push(
        `XFA template namespace ${nsInfo.version} is not directly supported. ` +
        `Attempting backward-compatible parsing. Some features may not work correctly.`
      );
      result.backwardCompat = true;

      // Check for version-specific features
      const diffs = VERSION_DIFFERENCES[nsInfo.version];
      if (diffs) {
        for (const [feature, description] of Object.entries(diffs)) {
          result.warnings.push(`  Feature '${feature}': ${description}`);
        }
      }
    }
  } else {
    result.warnings.push(
      `Unknown XFA template namespace: ${templateNs}. ` +
      `Attempting to parse as XFA 3.3.`
    );
    result.detectedVersion = '3.3';
  }

  return result;
}

/**
 * Validate namespace prefixes used in an XDP document.
 * Checks for common issues like incorrect prefix usage.
 */
export function validateNamespacePrefixes(
  prefixes: Record<string, string>,
  strict: boolean = false
): string[] {
  const warnings: string[] = [];

  for (const [prefix, uri] of Object.entries(prefixes)) {
    if (!uri.startsWith('http://') && !uri.startsWith('urn:')) {
      if (strict) {
        warnings.push(`Namespace prefix '${prefix}' has non-standard URI: ${uri}`);
      } else {
        warnings.push(`Warning: Namespace prefix '${prefix}' has non-standard URI`);
      }
    }

    // Check for misspelled common prefixes
    if (prefix === 'xpatemplate') {
      warnings.push(
        `Possible misspelled namespace prefix: '${prefix}'. Did you mean 'xfa-templates'?`
      );
    }
  }

  return warnings;
}

/**
 * Get version-specific feature flags.
 * Returns which features are available in a given XFA version.
 */
export function getVersionFeatures(version: string): Record<string, boolean> {
  const features: Record<string, boolean> = {
    // Base features (available in all versions)
    'field': true,
    'subform': true,
    'draw': true,
    'exclGroup': true,
    'event': true,
    'script': true,
    'calculate': true,
    'validate': true,
    'ui': true,
    'caption': true,
    'para': true,
    'font': true,
    'border': true,
    'margin': true,
    'bind': true,
    'occur': true,
    'value': true,

    // Version-specific features
    'layout.position': version >= '2.8',
    'layout.tbrl': version >= '3.6',
    'assist': version >= '3.3',
    'script.runAt.docReady': version >= '3.6',
    'script.runAt.pageOpen': true,
    'script.runAt.pageClose': true,
    'pdf.enhanced': version >= '3.6',
    'field.access.enhanced': version >= '3.6',
    'subform.layout.position': true,
    'subform.layout.table': true,
    'subform.layout.flow': true,
    'subform.layout.row': true,
  };

  return features;
}
