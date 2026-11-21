import { PDFDocument } from 'pdf-lib';

export interface FlattenOptions {
  fieldNames?: string[];
  pageIndices?: number[];
  readOnly?: boolean;
  appearanceProviders?: Record<string, (value: unknown) => Uint8Array>;
}

export function flattenFormFields(doc: PDFDocument, options: FlattenOptions = {}): void {
  try {
    const form = doc.getForm();

    if (options.fieldNames && options.fieldNames.length) {
      for (const name of options.fieldNames) {
        try {
          const field = form.getField(name);
          if (field && 'flatten' in field) {
            (field as { flatten: () => void }).flatten();
          }
        } catch {
          continue;
        }
      }
    } else {
      form.flatten();
    }
  } catch {
    return;
  }
}

export function readOnlyFormFields(doc: PDFDocument, options: FlattenOptions = {}): void {
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    const fieldNameSet = options.fieldNames ? new Set(options.fieldNames) : undefined;

    for (const field of fields) {
      const name = field.getName();

      if (fieldNameSet && fieldNameSet.size && !fieldNameSet.has(name)) continue;

      if ('enableReadOnly' in field) {
        (field as { enableReadOnly: () => void }).enableReadOnly();
      }
    }
  } catch {
    return;
  }
}

export function removeFormFields(doc: PDFDocument, fieldNames?: string[]): void {
  try {
    const form = doc.getForm();

    if (fieldNames && fieldNames.length) {
      for (const name of fieldNames) {
        try {
          form.removeField(form.getField(name));
        } catch {
          continue;
        }
      }
    } else {
      const fields = form.getFields();
      for (const field of fields) {
        try {
          form.removeField(field);
        } catch {
          continue;
        }
      }
    }
  } catch {
    return;
  }
}

export function listFormFields(doc: PDFDocument): Array<{ name: string; type: string }> {
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    return fields.map((field) => ({
      name: field.getName(),
      type: field.constructor.name,
    }));
  } catch {
    return [];
  }
}
