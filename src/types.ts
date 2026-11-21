export interface ErrorResult {
  code: string;
  message: string;
  details?: string[];
}

export type Result<T> = { success: true; data: T } | { success: false; error: ErrorResult };

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

export type BreakValue = 'auto' | 'contentArea' | 'pageArea' | 'pageEven' | 'pageFront' | 'pageOdd';

export interface KeepSpec {
  [key: string]: string;
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

export interface RenderOptions {
  fonts?: Record<string, string>;
  fontDirs?: string[];
  pageHeight?: number;
  maxInputSize?: number;
  strictValidation?: boolean;
  onWarning?: (message: string) => void;
  previewMode?: boolean;
  skipScripts?: boolean;
  skipScriptEvents?: string[];
  adobe?: AdobeOptions;
}

export interface AdobeOptions {
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
  bookmarks?: Array<{
    title: string;
    pageIndex: number;
    zoom?: number;
    y?: number;
    children?: Array<{ title: string; pageIndex: number }>;
  }>;
  annotations?: Array<{
    type: 'text' | 'stamp' | 'highlight' | 'link' | 'freeText';
    rect: [number, number, number, number];
    pageIndex: number;
    contents?: string;
    author?: string;
    stampName?: string;
  }>;
  layers?: Array<{
    name: string;
    visible?: boolean;
    printable?: boolean;
    exportable?: boolean;
  }>;
  flatten?: boolean | { fieldNames?: string[] };
  tabOrder?: 'documents' | 'fields' | 'structure' | 'appearance';
  acroForm?: boolean | { tabOrderFromTraversal?: boolean };
  tagged?: boolean | { language?: string; title?: string };
  embedXfa?: boolean;
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
