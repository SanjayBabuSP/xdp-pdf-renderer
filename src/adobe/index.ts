export { applyPdfSecurity } from './pdf-security';
export type { PDFSecurityOptions, PDFPermissions } from './pdf-security';

export { addBookmarks, autoGenerateBookmarks } from './pdf-bookmarks';
export type { BookmarkItem } from './pdf-bookmarks';

export { addAnnotation, addAnnotations, createFieldWidgets } from './pdf-annotations';
export type { AnnotationOptions, AnnotationType, AnnotationFlag } from './pdf-annotations';

export { createLayers, setLayerState, addContentToLayer } from './pdf-layers';
export type { OCGLayer, LayerState } from './pdf-layers';

export {
  flattenFormFields,
  readOnlyFormFields,
  removeFormFields,
  listFormFields,
} from './pdf-form-flatten';
export type { FlattenOptions } from './pdf-form-flatten';

export { setTabOrder, setGlobalTabOrder, setTabOrderForPages } from './pdf-tab-order';
export type { TabOrder } from './pdf-tab-order';

export {
  resolveFontSequence,
  addFontSequenceRule,
  parseFontSequenceString,
  DEFAULT_FONT_SEQUENCES,
} from './font-sequences';
export type { FontSequenceRule } from './font-sequences';

export {
  XfaEventDispatcher,
  createXfaEvent,
  eventBubbles,
  XFA_EVENTS,
  BUBBLING_EVENTS,
  NON_BUBBLING_EVENTS,
} from './xfa-event-bubbling';
export type { XfaEvent, EventPhase, EventHandler } from './xfa-event-bubbling';

export {
  validateXfaNamespaces,
  validateNamespacePrefixes,
  getVersionFeatures,
} from './xfa-namespace-validation';
export type { NamespaceValidationResult } from './xfa-namespace-validation';

export { applyDocumentMetadata, setNeedsRendering, preserveInfoOverrides } from './pdf-metadata';
export type { MetadataOptions } from './pdf-metadata';

export { embedXfaPackage, extractXfaPackets } from './pdf-xfa';
export type { XfaPacket } from './pdf-xfa';

export { markDocumentTagged } from './pdf-tagged';
export type { TaggedOptions } from './pdf-tagged';

export { createAcroFormFields } from './pdf-acroform';
export type { AcroFormOptions } from './pdf-acroform';

export { applyPdfVersion, applyAdobeExtensionLevel } from './pdf-catalog';

export { md5 } from './crypto-utils';
