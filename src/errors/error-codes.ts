export const ERROR_CODES = {
  // Parsing errors (1xxx)
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

  // Validation errors (2xxx)
  VALIDATION_FAILED: { code: 'VAL_2001', message: 'Data validation failed against schema' },
  MISSING_REQUIRED: { code: 'VAL_2002', message: 'Required field missing' },
  TYPE_MISMATCH: { code: 'VAL_2003', message: 'Field type does not match schema' },
  UNRESOLVED_BINDING: { code: 'VAL_2004', message: 'Bind ref does not resolve to schema field' },

  // Mapping errors (3xxx)
  BINDING_FAILED: { code: 'MAP_3001', message: 'Failed to resolve data binding' },
  REPEAT_NO_ARRAY: { code: 'MAP_3002', message: 'Repeating subform bound to non-array data' },

  // Layout errors (4xxx)
  OVERFLOW: { code: 'LAY_4001', message: 'Content exceeds available page area' },

  // Rendering errors (5xxx)
  FONT_NOT_FOUND: { code: 'REN_5001', message: 'Requested font not available' },
  IMAGE_LOAD_FAILED: { code: 'REN_5002', message: 'Failed to load embedded image' },
  PDF_GENERATION_FAILED: { code: 'REN_5003', message: 'PDF generation failed' },
} as const;

export type ErrorCodeKey = keyof typeof ERROR_CODES;
