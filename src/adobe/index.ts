// ────────────────────────────────────────────────────────────────────────────
// Adobe-specific PDF features — Public API
// Re-exports all capabilities from the adobe/ directory
// ────────────────────────────────────────────────────────────────────────────

// PDF Security
export { applyPdfSecurity } from './pdf-security';
export type { PDFSecurityOptions, PDFPermissions } from './pdf-security';

// PDF Bookmarks / Outlines
export { addBookmarks, autoGenerateBookmarks } from './pdf-bookmarks';
export type { BookmarkItem } from './pdf-bookmarks';

// PDF Annotations
export { addAnnotation, addAnnotations, createFieldWidgets } from './pdf-annotations';
export type { AnnotationOptions, AnnotationType, AnnotationFlag } from './pdf-annotations';

// PDF Layers (OCG)
export { createLayers, setLayerState, addContentToLayer } from './pdf-layers';
export type { OCGLayer, LayerState } from './pdf-layers';

// Form Flattening
export { flattenFormFields, readOnlyFormFields, removeFormFields, listFormFields } from './pdf-form-flatten';
export type { FlattenOptions } from './pdf-form-flatten';

// Tab Ordering
export { setTabOrder, setGlobalTabOrder, setTabOrderForPages } from './pdf-tab-order';
export type { TabOrder } from './pdf-tab-order';

// Font Substitution Sequences
export {
  resolveFontSequence,
  addFontSequenceRule,
  parseFontSequenceString,
  DEFAULT_FONT_SEQUENCES,
} from './font-sequences';
export type { FontSequenceRule } from './font-sequences';

// XFA Event Bubbling
export { XfaEventDispatcher, createXfaEvent, XFA_EVENTS, BUBBLING_EVENTS, NON_BUBBLING_EVENTS } from './xfa-event-bubbling';
export type { XfaEvent, EventPhase, EventHandler, EventTarget } from './xfa-event-bubbling';

// XFA Namespace Validation
export { validateXfaNamespaces, validateNamespacePrefixes, getVersionFeatures } from './xfa-namespace-validation';
export type { NamespaceValidationResult } from './xfa-namespace-validation';

// Crypto Utilities (internal use)
export { md5 } from './crypto-utils';
