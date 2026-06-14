// ────────────────────────────────────────────────────────────────────────────
// Shared type definitions for the xdp-pdf-render module
// ────────────────────────────────────────────────────────────────────────────

// ─── Result Type ─────────────────────────────────────────────────────────────

export interface ErrorResult {
  code: string;
  message: string;
  details?: string[];
}

export type Result<T> = { success: true; data: T } | { success: false; error: ErrorResult };

// ─── Units & Positioning ─────────────────────────────────────────────────────

export type Unit = 'in' | 'cm' | 'mm' | 'pt' | 'px';

export interface Position {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  minH?: number;
  minW?: number;
}

// ─── Font & Style ─────────────────────────────────────────────────────────────

export interface FontSpec {
  family?: string;
  size?: number;
  weight?: string;
  posture?: string;
}

export interface BorderSpec {
  presence?: string;
}

export interface MarginSpec {
  topInset?: number;
  bottomInset?: number;
  leftInset?: number;
  rightInset?: number;
}

// ─── Bind & UI ───────────────────────────────────────────────────────────────

export interface BindSpec {
  match: 'dataRef' | 'none';
  ref?: string;
  picture?: string;
}

export interface CaptionSpec {
  reserve?: number;
  text?: string;
  font?: FontSpec;
}

export interface ParaSpec {
  vAlign?: string;
  hAlign?: string;
}

export interface EventSpec {
  name?: string;
  activity?: string;
  ref?: string;
  script?: string;
}

export interface UiSpec {
  type: 'textEdit' | 'numericEdit' | 'dateTimeEdit' | 'imageEdit' | 'unknown';
  multiLine?: boolean;
  borderPresence?: string;
}

export interface OccurSpec {
  min?: number;
  max: number; // -1 = unbounded
}

export type PresenceValue = 'visible' | 'hidden' | 'invisible' | 'inactive';

// ─── Layout Nodes ────────────────────────────────────────────────────────────

export interface SubformNode {
  type: 'subform';
  name?: string;
  layout?: 'tb' | 'lr' | 'table' | 'row' | 'position';
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  occur?: OccurSpec;
  columnWidths?: number[];
  children: LayoutNode[];
  locale?: string;
  restoreState?: string;
  presence?: PresenceValue;
  margin?: MarginSpec;
}

export interface FieldNode {
  type: 'field';
  name?: string;
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  ui?: UiSpec;
  font?: FontSpec;
  caption?: CaptionSpec;
  para?: ParaSpec;
  access?: string;
  position?: Position;
  events?: EventSpec[];
  calculate?: { override?: string };
  formatPicture?: string;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  margin?: MarginSpec;
  colSpan?: number;
}

export interface DrawNode {
  type: 'draw';
  name?: string;
  value?: {
    type: 'text' | 'image' | 'richText';
    contentType?: string;
    content?: string;
  };
  font?: FontSpec;
  position?: Position;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  ui?: UiSpec;
  margin?: MarginSpec;
}

export type LayoutNode = SubformNode | FieldNode | DrawNode;

// ─── Page ────────────────────────────────────────────────────────────────────

export interface PageMedium {
  stock: string;
  short: number; // points
  long: number; // points
}

export interface ContentArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageDefinition {
  name: string;
  id?: string;
  medium: PageMedium;
  contentArea: ContentArea;
  masterPageChildren: LayoutNode[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ConfigSpec {
  pdfVersion?: string;
  adobeExtensionLevel?: number;
  fonts?: Array<{ typeface: string; psName: string; weight?: string }>;
}

// ─── Layout Model ────────────────────────────────────────────────────────────

export interface LayoutModel {
  rootSubformName: string;
  locale?: string;
  pages: PageDefinition[];
  children: LayoutNode[];
  config?: ConfigSpec;
  xsdUri?: string;
  xsdRootElement?: string;
}

// ─── Schema Model ────────────────────────────────────────────────────────────

export interface SchemaFieldSimple {
  type:
    | 'string'
    | 'int'
    | 'byte'
    | 'short'
    | 'integer'
    | 'decimal'
    | 'float'
    | 'date'
    | 'dateTime'
    | 'anyURI';
  required: boolean;
  repeating?: boolean;
  maxOccurs?: number;
}

export interface SchemaFieldComplex {
  type: 'complex';
  required: boolean;
  repeating?: boolean;
  maxOccurs?: number;
  fields: SchemaFields;
}

export type SchemaField = SchemaFieldSimple | SchemaFieldComplex;

export interface SchemaFields {
  [fieldName: string]: SchemaField;
}

export interface SchemaModel {
  rootElement: string;
  schemaAttributes: {
    attributeFormDefault?: string;
    elementFormDefault?: string;
  };
  fields: SchemaFields;
}

// ─── Data Object ─────────────────────────────────────────────────────────────

export type DataValue = string | number | boolean | null | DataObject | DataObject[];

export interface DataObject {
  [key: string]: DataValue | DataValue[];
}

// ─── Render Options ──────────────────────────────────────────────────────────

export interface RenderOptions {
  fonts?: Record<string, string>;
  pageHeight?: number;
  maxInputSize?: number;
}

// ─── Positioned / Paginated Layout ───────────────────────────────────────────

export interface AbsolutePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PositionedNode {
  absolutePosition?: AbsolutePosition;
}

export interface PaginatedPage {
  pageIndex: number;
  medium: PageMedium;
  contentArea: ContentArea;
  masterPageChildren: LayoutNode[];
  children: LayoutNode[];
}

export interface PaginatedLayout {
  pages: PaginatedPage[];
}
