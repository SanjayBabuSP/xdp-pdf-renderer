import type { ErrorCode } from './errors/error-codes';

/**
 * A failure returned instead of a thrown exception.
 */
export interface ErrorResult {
  /** Machine-readable code from {@link ERROR_CODES}. */
  code: ErrorCode;

  /** Short user-facing description of the failure. */
  message: string;

  /** Optional list of field-level or parser-level details. */
  details?: string[];

  /** Optional next step that resolves the failure. */
  hint?: string;
}

/**
 * The result of an operation that either succeeds with data or returns an
 * {@link ErrorResult}. Operations in this library do not throw on bad input.
 *
 * @template T - The type of the success value.
 */
export type Result<T> = { success: true; data: T } | { success: false; error: ErrorResult };

/**
 * A parsed XDP/XSD pair that can be rendered repeatedly with different data.
 */
export interface CompiledTemplate {
  /**
   * Renders this template with the supplied XML data.
   *
   * @param data - XML data as text.
   * @param options - Optional rendering settings; these override the options
   * passed to `compile()`.
   * @returns A success result containing PDF bytes, or a failure result.
   */
  render(data: string, options?: RenderOptions): Promise<Result<Uint8Array>>;
}

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
  anchorType?: string;
}

export type BreakValue = 'auto' | 'contentArea' | 'pageArea' | 'pageEven' | 'pageFront' | 'pageOdd';

export interface KeepSpec {
  [key: string]: string;
}

export interface TextLineRange {
  start: number;
  end: number;
}

export interface OriginalBox {
  topOffset: number;
  height: number;
}

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
  thickness?: number;
  color?: RgbColor;
  style?: string;
  opacity?: number;
  cap?: string;
  join?: string;
}

export interface FillSpec {
  presence?: string;
  color?: RgbColor;
  opacity?: number;
  fillType?: string;
  color2?: RgbColor;
}

export interface BorderSpec {
  presence?: string;
  edges?: EdgeSpec[];
  fill?: FillSpec;
  cornerRadius?: number;
  cornerRadii?: Array<number | undefined>;
}

export interface MarginSpec {
  topInset?: number;
  bottomInset?: number;
  leftInset?: number;
  rightInset?: number;
}

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
  richHtml?: string;
  /** Caption paragraph metrics such as alignment, indents and margins. */
  para?: ParaSpec;
}

export interface ParaSpec {
  vAlign?: string;
  hAlign?: string;
  lineHeight?: number;
  spaceAbove?: number;
  spaceBelow?: number;
  textIndent?: number;
  marginLeft?: number;
  marginRight?: number;
}

export interface EventSpec {
  name?: string;
  activity?: string;
  ref?: string;
  script?: string;
  contentType?: string;
  runAt?: string;
}

export interface ChoiceListItem {
  text: string;
  value?: string;
}

export interface UiSpec {
  type:
    | 'textEdit'
    | 'numericEdit'
    | 'dateTimeEdit'
    | 'imageEdit'
    | 'checkButton'
    | 'choiceList'
    | 'barcode'
    | 'button'
    | 'signature'
    | 'unknown';
  multiLine?: boolean;
  allowRichText?: boolean;
  borderPresence?: string;
  hAlign?: string;
  vAlign?: string;
  items?: ChoiceListItem[];
  open?: string;
  textEnclosure?: string;
  checkedValue?: string;
  uncheckedValue?: string;
  mark?: string;
  encodeHint?: string;
  charEncoding?: string;
  symbology?: string;
  moduleWidth?: string;
  moduleHeight?: string;
  checksum?: string;
  checkDigit?: string;
  wideNarrowRatio?: string;
  textLocation?: string;
  errorCorrectionLevel?: string;
  dataLength?: string;
  label?: string;
  highlight?: string;
}

export interface AssistSpec {
  toolTip?: string;
  description?: string;
  name?: string;
  usage?: string;
}

export type ExtrasSpec = Record<string, string>;

export interface TraversalSpec {
  order?: string;
  fields?: string[];
}

export interface OccurSpec {
  min?: number;
  max: number;
}

export type PresenceValue = 'visible' | 'hidden' | 'invisible' | 'inactive';

export interface SubformNode {
  type: 'subform';
  name?: string;
  uid?: string;
  layout?: 'tb' | 'lr-tb' | 'lr' | 'rl-tb' | 'table' | 'row' | 'rl-row' | 'position';
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  occur?: OccurSpec;
  columnWidths?: number[];
  isSubformSet?: boolean;
  setRelation?: 'ordered' | 'choice' | 'unordered';
  children: LayoutNode[];
  locale?: string;
  restoreState?: string;
  presence?: PresenceValue;
  margin?: MarginSpec;
  border?: BorderSpec;
  position?: Position;
  events?: EventSpec[];
  relevant?: string;
  assist?: AssistSpec;
  extras?: ExtrasSpec;
  traversal?: TraversalSpec;
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
  repeatIndex?: number;
}

export interface ExclGroupNode {
  type: 'exclGroup';
  name?: string;
  uid?: string;
  bindMatch?: 'dataRef' | 'none';
  bindRef?: string;
  children: LayoutNode[];
  position?: Position;
  presence?: PresenceValue;
  relevant?: string;
  assist?: AssistSpec;
  extras?: ExtrasSpec;
  traversal?: TraversalSpec;
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
  calculate?: {
    override?: string;
    script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string };
  };
  validate?: {
    script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string };
  };
  formatPicture?: string;
  locale?: string;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  margin?: MarginSpec;
  colSpan?: number;
  border?: BorderSpec;
  relevant?: string;
  defaultValue?: unknown;
  imageValue?: NonNullable<DrawNode['value']>;
  assist?: AssistSpec;
  extras?: ExtrasSpec;
  traversal?: TraversalSpec;
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
  repeatIndex?: number;
  textLineRange?: TextLineRange;
  originalBox?: OriginalBox;
  inheritedFontSize?: number;
}

export interface DrawNode {
  type: 'draw';
  name?: string;
  uid?: string;
  value?: {
    type: 'text' | 'image' | 'richText' | 'rectangle' | 'line' | 'arc' | 'circle';
    contentType?: string;
    content?: string;
    shapeBorder?: BorderSpec;
    sweepAngle?: number;
    startAngle?: number;
    aspectMode?: string;
    xdpi?: number;
    ydpi?: number;
    hAlign?: 'left' | 'center' | 'right';
    vAlign?: 'top' | 'middle' | 'bottom';
  };
  font?: FontSpec;
  position?: Position;
  presence?: PresenceValue;
  resolvedValue?: unknown;
  ui?: UiSpec;
  margin?: MarginSpec;
  border?: BorderSpec;
  para?: ParaSpec;
  events?: EventSpec[];
  relevant?: string;
  assist?: AssistSpec;
  extras?: ExtrasSpec;
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
  colSpan?: number;
  textLineRange?: TextLineRange;
  originalBox?: OriginalBox;
  inheritedFontSize?: number;
}

export type LayoutNode = SubformNode | FieldNode | DrawNode | ExclGroupNode;

export interface PageMedium {
  stock: string;
  short: number;
  long: number;
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

export interface FontEquateRule {
  from: string;
  to: string;
  force: boolean;
}

export interface DocumentMetadata {
  title?: string;
  description?: string;
  author?: string;
  language?: string;
}

export interface ConfigSpec {
  pdfVersion?: string;
  adobeExtensionLevel?: number;
  fonts?: Array<{ typeface: string; psName: string; weight?: string }>;
  fontEquateRules?: FontEquateRule[];
}

export interface LayoutModel {
  rootSubformName: string;
  locale?: string;
  pages: PageDefinition[];
  children: LayoutNode[];
  rootEvents?: EventSpec[];
  variables?: Record<string, string>;
  config?: ConfigSpec;
  xsdUri?: string;
  xsdRootElement?: string;
  metadata?: DocumentMetadata;
  version?: string;
  warnings?: string[];
}

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

export type DataValue = string | number | boolean | null | DataObject | DataObject[];

export interface DataObject {
  [key: string]: DataValue | DataValue[];
}

/**
 * Options for rendering a form. All fields are optional.
 */
export interface RenderOptions {
  /** Locale for picture formatting, e.g. `de_DE`; defaults to the XDP locale then `en-US`. */
  locale?: string;

  /** Map of font family to font file path. */
  fonts?: Record<string, string>;

  /** Extra directories to scan for font files. */
  fontDirs?: string[];

  /** Override the page height in points. */
  pageHeight?: number;

  /** Maximum accepted size of the XDP, XSD and XML inputs in bytes. */
  maxInputSize?: number;

  /** Fail on validation problems; defaults to false, which emits warnings. */
  strictValidation?: boolean;

  /** Callback that receives validation warnings in non-strict mode. */
  onWarning?: (message: string) => void;

  /** Render only the layout preview without final PDF features. */
  previewMode?: boolean;

  /** Skip FormCalc and JavaScript execution; use this for untrusted templates. */
  skipScripts?: boolean;

  /** Event names to skip, e.g. `['initialize', 'docReady']`. */
  skipScriptEvents?: string[];

  /** Optional cancellation signal, checked between pipeline steps. */
  signal?: AbortSignal;

  /**
   * Cooperative deadline in milliseconds; it cannot interrupt synchronous work
   * already in progress.
   */
  timeoutMs?: number;

  /** Adobe-specific PDF features. */
  adobe?: AdobeOptions;
}

/**
 * Adobe PDF features applied after the form has been rendered.
 */
export interface AdobeOptions {
  /** Password protection and encryption settings. */
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
  /** PDF outline entries. */
  bookmarks?: Array<{
    title: string;
    pageIndex: number;
    zoom?: number;
    y?: number;
    children?: Array<{ title: string; pageIndex: number }>;
  }>;
  /** PDF annotations added on top of the rendered form. */
  annotations?: Array<{
    type: 'text' | 'stamp' | 'highlight' | 'link' | 'freeText';
    rect: [number, number, number, number];
    pageIndex: number;
    contents?: string;
    author?: string;
    stampName?: string;
  }>;
  /** Optional content layers. */
  layers?: Array<{
    name: string;
    visible?: boolean;
    printable?: boolean;
    exportable?: boolean;
  }>;
  /** Flatten form fields into static page content. */
  flatten?: boolean | { fieldNames?: string[] };

  /** Structure tree order for tagged PDFs. */
  tabOrder?: 'documents' | 'fields' | 'structure' | 'appearance';

  /** Emit an AcroForm for the rendered fields. */
  acroForm?: boolean | { tabOrderFromTraversal?: boolean };

  /** Emit a tagged PDF structure tree. */
  tagged?: boolean | { language?: string; title?: string };

  /** Embed the original XDP packet in the PDF. */
  embedXfa?: boolean;

  /** Document metadata overrides. */
  metadata?: {
    producer?: string;
    creatorTool?: string;
  };
}

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
  rootSubformName?: string;
  rootEvents?: EventSpec[];
}
