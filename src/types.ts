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
  rotate?: number;
}

// ─── Font & Style ─────────────────────────────────────────────────────────────

export interface FontSpec {
  family?: string;
  size?: number;
  weight?: string;
  posture?: string;
  color?: RgbColor;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface EdgeSpec {
  presence?: string;
  thickness?: number; // points
  color?: RgbColor;
  style?: string; // solid | dashed | dotted | embossed | etched | lowered | raised
}

export interface FillSpec {
  presence?: string;
  color?: RgbColor;
}

export interface BorderSpec {
  presence?: string;
  /** 1 edge = applies to all 4 sides; 4 edges = [top, right, bottom, left]. */
  edges?: EdgeSpec[];
  fill?: FillSpec;
  cornerRadius?: number;
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
  placement?: 'left' | 'right' | 'top' | 'bottom' | 'inline';
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

export interface ChoiceListItem {
  text: string;
  value?: string;
}

export interface UiSpec {
  type: 'textEdit' | 'numericEdit' | 'dateTimeEdit' | 'imageEdit' | 'checkButton' | 'choiceList' | 'barcode' | 'button' | 'signature' | 'unknown';
  multiLine?: boolean;
  borderPresence?: string;
  /** For choiceList: the selectable items */
  items?: ChoiceListItem[];
  /** For checkButton: values for on/off states */
  checkedValue?: string;
  uncheckedValue?: string;
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
  border?: BorderSpec;
  position?: Position;
}

export interface ExclGroupNode {
  type: 'exclGroup';
  name?: string;
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  children: FieldNode[];
  position?: Position;
  presence?: PresenceValue;
  border?: BorderSpec;
  margin?: MarginSpec;
  resolvedValue?: unknown;
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
  border?: BorderSpec;
}

export interface DrawNode {
  type: 'draw';
  name?: string;
  value?: {
    type: 'text' | 'image' | 'richText' | 'rectangle' | 'line' | 'arc' | 'circle';
    contentType?: string;
    content?: string;
    shapeBorder?: BorderSpec;
    /** For arc: sweep angle in degrees */
    sweepAngle?: number;
    /** For arc: start angle in degrees */
    startAngle?: number;
  };
  font?: FontSpec;
  position?: Position;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  ui?: UiSpec;
  margin?: MarginSpec;
  border?: BorderSpec;
}

export type LayoutNode = SubformNode | FieldNode | DrawNode | ExclGroupNode;

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

export interface FontEquateRule {
  from: string;
  to: string;
  force: boolean;
}

export interface ConfigSpec {
  pdfVersion?: string;
  adobeExtensionLevel?: number;
  fonts?: Array<{ typeface: string; psName: string; weight?: string }>;
  fontEquateRules?: FontEquateRule[];
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
  /** Hard-fail on missing required schema fields. Default true. Set false to tolerate real-world
   *  XFA data instances (e.g. SAP OData exports) that commonly omit optional navigation properties
   *  even when the XSD lacks minOccurs="0". */
  strictValidation?: boolean;
  /** Preview/draft mode: force-show watermark subforms (invisible presence) that would
   *  normally be hidden. Matches Adobe LiveCycle's preview rendering. */
  previewMode?: boolean;
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
