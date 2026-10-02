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
  maxH?: number;
  maxW?: number;
  rotate?: number;
}

/**
 * breakBefore/breakAfter enum. evidence: xfa.dll string block
 * "contentArea, pageArea, pageEven, pageFront, pageOdd" with "auto" as the
 * schema default (AcroForm.ppi_disasm.c:794816 passes 0x350000=auto as
 * default for enum properties) and value order from FUN_18527420
 * (xfalayout_disasm.c:16579: 0x350002→pageArea target, 0x350001→contentArea
 * via FUN_18526fe0 :16345).
 */
export type BreakValue = 'auto' | 'contentArea' | 'pageArea' | 'pageEven' | 'pageFront' | 'pageOdd';

/**
 * <keep> element — three enum properties, all "auto" = no keep
 * (xfalayout_disasm.c:66094 hasActiveKeep: keeps only if any of the three
 * properties differs from 0x360000=auto). Stored as raw attribute/child
 * values because Designer rarely emits <keep>; the layout code treats any
 * non-"auto" value as active.
 */
export interface KeepSpec {
  [key: string]: string;
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
  /** Stroke transparency 0..1 (`/CA` ExtGState). evidence: pdfdocument:138444 */
  opacity?: number;
  /**
   * Line-cap style for this edge: 'square'|'round'|'butt'.
   * evidence: designrenderer:6182 cap enum 0x50000/1/2 → PDF J 0/1/2.
   */
  cap?: string;
  /**
   * Line-join style: 'miter'|'round'|'bevel'.
   * evidence: designrenderer:6182 join enum 0x60000/1/2 → PDF j 0/1/2.
   */
  join?: string;
}

export interface FillSpec {
  presence?: string;
  color?: RgbColor;
  /** Fill transparency 0..1 (`/ca` ExtGState). evidence: pdfdocument:144010 */
  opacity?: number;
  /**
   * Fill type: 'solid'|'none'|'toTop'|'toBottom'|'toLeft'|'toRight'|'radial'.
   * Gradient types map to PDF ShadingType 2 (axial) or 3 (radial).
   * evidence: renderer:35845 (axial), renderer:36519 (radial), pdfldriver:40203.
   */
  fillType?: string;
  /**
   * End colour for gradient fills (the second stop).
   * Absent → defaults to white {r:255,g:255,b:255}.
   * evidence: renderer:35845 buildLinearGradient uses color1/color2 parameters.
   */
  color2?: RgbColor;
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
  /** Script content type: 'application/x-formcalc' or 'application/x-javascript' */
  contentType?: string;
  /** When the script should run: 'deprecated' | 'docOpen' | 'docReady' | 'pageOpen' | 'pageClose' */
  runAt?: string;
}

export interface ChoiceListItem {
  text: string;
  value?: string;
}

export interface UiSpec {
  type: 'textEdit' | 'numericEdit' | 'dateTimeEdit' | 'imageEdit' | 'checkButton' | 'choiceList' | 'barcode' | 'button' | 'signature' | 'unknown';
  multiLine?: boolean;
  allowRichText?: boolean;
  borderPresence?: string;
  /** For textEdit/numericEdit/dateTimeEdit: horizontal alignment */
  hAlign?: string;
  /** For textEdit/numericEdit/dateTimeEdit: vertical alignment */
  vAlign?: string;
  /** For choiceList: the selectable items */
  items?: ChoiceListItem[];
  /** For choiceList: open state */
  open?: string;
  /** For choiceList: text enclosure style */
  textEnclosure?: string;
  /** For checkButton: values for on/off states */
  checkedValue?: string;
  uncheckedValue?: string;
  /** For checkButton: mark style */
  mark?: string;
  /** For barcode: encoding hint */
  encodeHint?: string;
  /** For barcode: character encoding */
  charEncoding?: string;
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
  /**
   * Stable unique identity assigned at parse time (XDP `id` when present,
   * otherwise a synthetic key). Used to reconcile script-driven property
   * changes back onto the exact node they were made against.
   */
  uid?: string;
  layout?: 'tb' | 'lr' | 'rl-tb' | 'table' | 'row' | 'rl-row' | 'position';
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
  events?: EventSpec[];
  /** XFA relevant attribute for conditional visibility (e.g. "$ + |rest.textContent != ''") */
  relevant?: string;
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
  /** Set by expandRepeats on occurrence instances (0-based); engines stack them. */
  repeatIndex?: number;
}

export interface ExclGroupNode {
  type: 'exclGroup';
  name?: string;
  /** Stable unique identity assigned at parse time (see SubformNode.uid). */
  uid?: string;
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  children: FieldNode[];
  position?: Position;
  presence?: PresenceValue;
  border?: BorderSpec;
  margin?: MarginSpec;
  resolvedValue?: unknown;
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
}

export interface FieldNode {
  type: 'field';
  name?: string;
  /** Stable unique identity assigned at parse time (see SubformNode.uid). */
  uid?: string;
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  ui?: UiSpec;
  font?: FontSpec;
  caption?: CaptionSpec;
  para?: ParaSpec;
  access?: string;
  position?: Position;
  events?: EventSpec[];
  calculate?: { override?: string; script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string } };
  validate?: { script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string } };
  formatPicture?: string;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  margin?: MarginSpec;
  colSpan?: number;
  border?: BorderSpec;
  /** XFA relevant attribute for conditional visibility */
  relevant?: string;
  /** Default value from <value> element */
  defaultValue?: unknown;
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
  /** Set by expandRepeats on occurrence instances (0-based); engines stack them. */
  repeatIndex?: number;
}

export interface DrawNode {
  type: 'draw';
  name?: string;
  /** Stable unique identity assigned at parse time (see SubformNode.uid). */
  uid?: string;
  value?: {
    type: 'text' | 'image' | 'richText' | 'rectangle' | 'line' | 'arc' | 'circle';
    contentType?: string;
    content?: string;
    shapeBorder?: BorderSpec;
    /** For arc: sweep angle in degrees */
    sweepAngle?: number;
    /** For arc: start angle in degrees */
    startAngle?: number;
    /**
     * For image: aspect mode.
     * 'none'=stretch, 'fit'=uniform scale, 'actual'=native DPI,
     * 'width'=fit width, 'height'=fit height.
     * evidence: xfaimageservice_disasm.c:9324.
     */
    aspectMode?: string;
    /** For image: horizontal DPI (xres). evidence: xfaimageservice:9324. */
    xdpi?: number;
    /** For image: vertical DPI (yres). Defaults to xdpi. */
    ydpi?: number;
    /** For image: horizontal alignment within spare space. evidence: xfaimageservice:9281. */
    hAlign?: 'left' | 'center' | 'right';
    /** For image: vertical alignment within spare space. evidence: xfaimageservice:9281. */
    vAlign?: 'top' | 'middle' | 'bottom';
  };
  font?: FontSpec;
  position?: Position;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  ui?: UiSpec;
  margin?: MarginSpec;
  border?: BorderSpec;
  events?: EventSpec[];
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
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
  /**
   * Events declared directly on the ROOT subform (e.g. activity="ready"
   * ref="$form", ref="$layout", docReady). The root subform itself is not
   * represented as a LayoutNode (only its name is kept in rootSubformName),
   * so its scripts are carried here for the script dispatcher.
   */
  rootEvents?: EventSpec[];
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
  /**
   * Extra directories scanned for font files (.otf/.ttf) at render time.
   * Merged with the imported Adobe manifest (`npm run fonts:import`) — useful
   * for pointing at a Designer install or a system font directory.
   */
  fontDirs?: string[];
  pageHeight?: number;
  maxInputSize?: number;
  /** Hard-fail on missing required schema fields. Default true. Set false to tolerate real-world
   *  XFA data instances (e.g. SAP OData exports) that commonly omit optional navigation properties
   *  even when the XSD lacks minOccurs="0". */
  strictValidation?: boolean;
  /** Preview/draft mode: force-show watermark subforms (invisible presence) that would
   *  normally be hidden. Matches Adobe LiveCycle's preview rendering. */
  previewMode?: boolean;
  /** Skip all script execution during rendering. Default false. */
  skipScripts?: boolean;
  /** Specific script events to skip (e.g., ['validate'] to skip validation scripts). */
  skipScriptEvents?: string[];
  /** Adobe-specific PDF features (security, bookmarks, annotations, layers, etc.) */
  adobe?: AdobeOptions;
}

/** Adobe-specific PDF rendering options */
export interface AdobeOptions {
  /** Password protection and permissions */
  security?: {
    userPassword?: string;
    ownerPassword?: string;
    permissions?: {
      print?: boolean;
      modify?: boolean;
      copy?: boolean;
      annotate?: boolean;
      fillForms?: boolean;
      extract?: boolean;
      assemble?: boolean;
      printHighQuality?: boolean;
    };
    encryptionMethod?: 'rc4_40' | 'rc4_128' | 'aes_128';
  };
  /** PDF bookmarks / outlines */
  bookmarks?: Array<{
    title: string;
    pageIndex: number;
    zoom?: number;
    y?: number;
    children?: Array<{ title: string; pageIndex: number }>;
  }>;
  /** Annotations to add */
  annotations?: Array<{
    type: 'text' | 'stamp' | 'highlight' | 'link' | 'freeText';
    rect: [number, number, number, number];
    pageIndex: number;
    contents?: string;
    author?: string;
    stampName?: string;
  }>;
  /** Optional Content Groups (layers) */
  layers?: Array<{
    name: string;
    visible?: boolean;
    printable?: boolean;
    exportable?: boolean;
  }>;
  /** Form flattening */
  flatten?: boolean | { fieldNames?: string[] };
  /** Tab order for form fields */
  tabOrder?: 'documents' | 'fields' | 'structure' | 'appearance';
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
  /** Root subform name — carried so post-layout scripts can resolve paths */
  rootSubformName?: string;
  /** Root-subform events — carried for post-layout (docReady) dispatch */
  rootEvents?: EventSpec[];
}
