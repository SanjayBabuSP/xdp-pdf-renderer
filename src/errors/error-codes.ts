/**
 * Machine-readable error codes and user-facing messages for every failure
 * returned by the public API.
 */
export const ERROR_CODES = {
  INVALID_XDP: {
    code: 'XDP_1001',
    message: 'Invalid XDP structure',
    hint: 'Check that the XDP is well-formed XML with a template root element.',
  },
  MISSING_TEMPLATE: {
    code: 'XDP_1002',
    message: 'XDP missing <template> element',
    hint: 'Add a <template> element to the XDP packet.',
  },
  MISSING_ROOT_SUBFORM: {
    code: 'XDP_1003',
    message: 'XDP template missing root subform',
    hint: 'Add a root <subform> directly under <template>.',
  },
  MISSING_PAGE_SET: {
    code: 'XDP_1005',
    message: 'XDP missing <pageSet> element',
    hint: 'Add a <pageSet> with at least one <pageArea> to the template.',
  },
  UNSUPPORTED_NAMESPACE: {
    code: 'XDP_1006',
    message: 'Unsupported XFA template namespace version',
    hint: 'Use an XFA 3.x template namespace or convert the template first.',
  },
  INVALID_XSD: {
    code: 'XSD_1003',
    message: 'Invalid XSD schema structure',
    hint: 'Check that the XSD is well-formed XML with a schema root element.',
  },
  MALFORMED_XML: {
    code: 'XML_1004',
    message: 'Malformed XML input',
    hint: 'Check the XML for unclosed tags, bad entities or invalid characters.',
  },

  VALIDATION_FAILED: {
    code: 'VAL_2001',
    message: 'Data validation failed against schema',
    hint: 'Fix the reported field values or use strictValidation: false to warn instead.',
  },
  MISSING_REQUIRED: {
    code: 'VAL_2002',
    message: 'Required field missing',
    hint: 'Add the missing field to the XML data or make it optional in the XSD.',
  },
  TYPE_MISMATCH: {
    code: 'VAL_2003',
    message: 'Field type does not match schema',
    hint: 'Change the XML value to match the XSD field type.',
  },
  UNRESOLVED_BINDING: {
    code: 'VAL_2004',
    message: 'Bind ref does not resolve to schema field',
    hint: 'Update the bind <ref> to match a field in the XSD.',
  },

  BINDING_FAILED: {
    code: 'MAP_3001',
    message: 'Failed to resolve data binding',
    hint: 'Check the bind element and the corresponding XML data path.',
  },
  REPEAT_NO_ARRAY: {
    code: 'MAP_3002',
    message: 'Repeating subform bound to non-array data',
    hint: 'Supply an array of values for a repeating subform binding.',
  },

  OVERFLOW: {
    code: 'LAY_4001',
    message: 'Content exceeds available page area',
    hint: 'Reduce the content size or increase the page/content area.',
  },

  FONT_NOT_FOUND: {
    code: 'REN_5001',
    message: 'Requested font not available',
    hint: 'Pass the font through fonts or fontDirs, or install the bundled fallback fonts.',
  },
  IMAGE_LOAD_FAILED: {
    code: 'REN_5002',
    message: 'Failed to load embedded image',
    hint: 'Check that the image data is a supported, decodable format.',
  },
  PDF_GENERATION_FAILED: {
    code: 'REN_5003',
    message: 'PDF generation failed',
    hint: 'Check the error details, then verify the template layout and font configuration.',
  },
  RENDER_ABORTED: {
    code: 'REN_5004',
    message: 'Rendering was aborted or timed out',
    hint: 'Increase timeoutMs, extend the caller signal deadline, or reduce template complexity.',
  },

  UNKNOWN_UNIT: {
    code: 'GEN_0001',
    message: 'Unknown measurement unit',
    hint: 'Use a supported CSS or XFA unit such as in, mm, cm, pt, px or em.',
  },

  SCRIPT_EXECUTION_FAILED: {
    code: 'SCR_6001',
    message: 'Script execution failed',
    hint: 'Fix the script or set skipScripts: true for untrusted templates.',
  },
  SCRIPT_PARSE_ERROR: {
    code: 'SCR_6002',
    message: 'Script parse error',
    hint: 'Check the script syntax and language declaration.',
  },
  SCRIPT_TIMEOUT: {
    code: 'SCR_6003',
    message: 'Script execution timed out',
    hint: 'Simplify the script or raise the script timeout.',
  },
  SCRIPT_STACK_OVERFLOW: {
    code: 'SCR_6004',
    message: 'Script stack overflow',
    hint: 'Remove recursive or self-retriggering script calls.',
  },
  FORMCALC_ERROR: {
    code: 'SCR_6005',
    message: 'FormCalc execution error',
    hint: 'Check the FormCalc expression and the fields it references.',
  },
  JAVASCRIPT_ENGINE_ERROR: {
    code: 'SCR_6006',
    message: 'JavaScript engine error',
    hint: 'Check the JavaScript event script and its field references.',
  },
} as const;

/** Keys used to look up an entry in {@link ERROR_CODES}. */
export type ErrorCodeKey = keyof typeof ERROR_CODES;

/** Every machine-readable error code string returned by the public API. */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]['code'];
