// ────────────────────────────────────────────────────────────────────────────
// PDF Form Flattening — Convert interactive form fields to static content
// ────────────────────────────────────────────────────────────────────────────

import { PDFDocument } from 'pdf-lib';

export interface FlattenOptions {
  /** Only flatten fields matching these names (empty = all) */
  fieldNames?: string[];
  /** Only flatten fields on these pages (empty = all) */
  pageIndices?: number[];
  /** Keep form fields but make them read-only instead of removing */
  readOnly?: boolean;
  /** Appearance providers for custom rendering */
  appearanceProviders?: Record<string, (value: unknown) => Uint8Array>;
}

/**
 * Flatten all form fields in a PDF document.
 * This converts interactive form fields into static page content,
 * making the form non-editable but preserving the visual appearance.
 *
 * Uses pdf-lib's built-in PDFForm.flatten() with additional filtering.
 */
export function flattenFormFields(doc: PDFDocument, options: FlattenOptions = {}): void {
  try {
    const form = doc.getForm();

    if (options.fieldNames && options.fieldNames.length > 0) {
      // Flatten specific fields
      for (const name of options.fieldNames) {
        try {
          const field = form.getField(name);
          if (field && 'flatten' in field) {
            (field as { flatten: () => void }).flatten();
          }
        } catch {
          // Field not found — skip
        }
      }
    } else {
      // Flatten all fields
      form.flatten();
    }
  } catch {
    // No form or no fields — nothing to flatten
  }
}

/**
 * Make form fields read-only instead of flattening.
 * Preserves the interactive appearance but prevents editing.
 */
export function readOnlyFormFields(doc: PDFDocument, options: FlattenOptions = {}): void {
  try {
    const form = doc.getForm();
    const fields = form.getFields();

    for (const field of fields) {
      const name = field.getName();

      // Filter by name if specified
      if (options.fieldNames && options.fieldNames.length > 0) {
        if (!options.fieldNames.includes(name)) continue;
      }

      // Set read-only flag
      if ('enableReadOnly' in field) {
        (field as { enableReadOnly: () => void }).enableReadOnly();
      }
    }
  } catch {
    // No form or no fields
  }
}

/**
 * Remove form fields entirely (no flattening, just deletion).
 */
export function removeFormFields(doc: PDFDocument, fieldNames?: string[]): void {
  try {
    const form = doc.getForm();

    if (fieldNames && fieldNames.length > 0) {
      for (const name of fieldNames) {
        try {
          form.removeField(form.getField(name));
        } catch {
          // Field not found
        }
      }
    } else {
      // Remove all fields
      const fields = form.getFields();
      for (const field of fields) {
        try {
          form.removeField(field);
        } catch {
          // Skip fields that can't be removed
        }
      }
    }
  } catch {
    // No form or no fields
  }
}

/**
 * Get a list of all form field names and their types.
 */
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
