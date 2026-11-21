export const ERROR_CODES = {
  INVALID_XDP: { code: 'XDP_1001', message: 'Invalid XDP structure' },
  MISSING_TEMPLATE: { code: 'XDP_1002', message: 'XDP missing <template> element' },
  MISSING_ROOT_SUBFORM: { code: 'XDP_1003', message: 'XDP template missing root subform' },
  MISSING_PAGE_SET: { code: 'XDP_1005', message: 'XDP missing <pageSet> element' },
  UNSUPPORTED_NAMESPACE: {
    code: 'XDP_1006',
    message: 'Unsupported XFA template namespace version',
  },
  INVALID_XSD: { code: 'XSD_1003', message: 'Invalid XSD schema structure' },
  MALFORMED_XML: { code: 'XML_1004', message: 'Malformed XML input' },

  VALIDATION_FAILED: { code: 'VAL_2001', message: 'Data validation failed against schema' },
  MISSING_REQUIRED: { code: 'VAL_2002', message: 'Required field missing' },
  TYPE_MISMATCH: { code: 'VAL_2003', message: 'Field type does not match schema' },
  UNRESOLVED_BINDING: { code: 'VAL_2004', message: 'Bind ref does not resolve to schema field' },

  BINDING_FAILED: { code: 'MAP_3001', message: 'Failed to resolve data binding' },
  REPEAT_NO_ARRAY: { code: 'MAP_3002', message: 'Repeating subform bound to non-array data' },

  OVERFLOW: { code: 'LAY_4001', message: 'Content exceeds available page area' },

  FONT_NOT_FOUND: { code: 'REN_5001', message: 'Requested font not available' },
  IMAGE_LOAD_FAILED: { code: 'REN_5002', message: 'Failed to load embedded image' },
  PDF_GENERATION_FAILED: { code: 'REN_5003', message: 'PDF generation failed' },

  SCRIPT_EXECUTION_FAILED: { code: 'SCR_6001', message: 'Script execution failed' },
  SCRIPT_PARSE_ERROR: { code: 'SCR_6002', message: 'Script parse error' },
  SCRIPT_TIMEOUT: { code: 'SCR_6003', message: 'Script execution timed out' },
  SCRIPT_STACK_OVERFLOW: { code: 'SCR_6004', message: 'Script stack overflow' },
  FORMCALC_ERROR: { code: 'SCR_6005', message: 'FormCalc execution error' },
  JAVASCRIPT_ENGINE_ERROR: { code: 'SCR_6006', message: 'JavaScript engine error' },
} as const;

export type ErrorCodeKey = keyof typeof ERROR_CODES;
