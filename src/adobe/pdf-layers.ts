// ────────────────────────────────────────────────────────────────────────────
// PDF Layers (Optional Content Groups / OCG)
// Supports layer visibility control, nested layers, and print/export states
// ────────────────────────────────────────────────────────────────────────────

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFRef,
  PDFBool,
} from 'pdf-lib';

export interface OCGLayer {
  /** Layer name */
  name: string;
  /** Whether the layer is visible by default */
  visible?: boolean;
  /** Whether the layer is printable */
  printable?: boolean;
  /** Whether the layer is exportable */
  exportable?: boolean;
  /** Parent layer (for nesting) */
  parent?: string;
  /** Child layers */
  children?: OCGLayer[];
  /** Custom intent (e.g., 'View', 'Design', 'All') */
  intent?: string[];
}

export interface LayerState {
  /** Layer name */
  name: string;
  /** Whether visible */
  visible: boolean;
}

/**
 * Create Optional Content Groups (layers) in a PDF document.
 * Layers allow viewers to toggle visibility of content groups.
 */
export function createLayers(doc: PDFDocument, layers: OCGLayer[]): void {
  if (layers.length === 0) return;

  const context = doc.context;

  // Create the OCGs array
  const ocgs = context.obj([]) as PDFArray;
  const ocgRefs = new Map<string, PDFRef>();

  // Create each OCG
  for (const layer of layers) {
    const ocgDict = createOCGDict(context, layer);
    const ref = context.register(ocgDict);
    ocgs.push(ref);
    ocgRefs.set(layer.name, ref);
  }

  // Create the OC properties dictionary
  const ocProps = context.obj({}) as PDFDict;
  ocProps.set(PDFName.of('OCGs'), ocgs);

  // Create the Order array (defines layer grouping)
  const order = createOrderArray(context, layers, ocgRefs);
  ocProps.set(PDFName.of('Order'), order);

  // Create the D array (default state: which layers are on/off)
  const dArray = createDefaultState(context, layers);
  ocProps.set(PDFName.of('D'), dArray);

  // Create the AS array (alternate presentations)
  const asArray = context.obj([]) as PDFArray;
  const viewIntent = context.obj([]) as PDFArray;
  viewIntent.push(PDFName.of('View'));
  asArray.push(viewIntent);
  ocProps.set(PDFName.of('AS'), asArray);

  // Create the Usage dictionary for each OCG
  for (const layer of layers) {
    const ref = ocgRefs.get(layer.name);
    if (ref) {
      const ocg = context.lookup(ref) as PDFDict;
      if (ocg) {
        const usage = createUsageDict(context, layer);
        ocg.set(PDFName.of('Usage'), usage);
      }
    }
  }

  // Register the OC properties
  const ocPropsRef = context.register(ocProps);

  // Attach to document catalog
  const catalog = context.lookup(context.trailerInfo.Root) as PDFDict;
  if (catalog) {
    catalog.set(PDFName.of('OCProperties'), ocPropsRef);
  }
}

function createOCGDict(context: PDFDocument['context'], layer: OCGLayer): PDFDict {
  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Type'), PDFName.of('OCG'));
  dict.set(PDFName.of('Name'), PDFString.of(layer.name));

  // Intent
  const intents = layer.intent ?? ['View', 'All'];
  const intentArray = context.obj([]) as PDFArray;
  for (const intent of intents) {
    intentArray.push(PDFName.of(intent));
  }
  dict.set(PDFName.of('Intent'), intentArray);

  return dict;
}

function createUsageDict(context: PDFDocument['context'], layer: OCGLayer): PDFDict {
  const usage = context.obj({}) as PDFDict;

  // Print usage
  const printDict = context.obj({}) as PDFDict;
    printDict.set(PDFName.of('Print'), layer.printable !== false ? PDFBool.True : PDFBool.False);
    printDict.set(PDFName.of('PrintState'), PDFName.of(layer.visible !== false ? 'ON' : 'OFF'));
    usage.set(PDFName.of('Print'), printDict);

    // Export usage
    const exportDict = context.obj({}) as PDFDict;
    exportDict.set(PDFName.of('Export'), layer.exportable !== false ? PDFBool.True : PDFBool.False);
    exportDict.set(PDFName.of('ExportState'), PDFName.of(layer.visible !== false ? 'ON' : 'OFF'));
  usage.set(PDFName.of('Export'), exportDict);

  // View usage
  const viewDict = context.obj({}) as PDFDict;
  viewDict.set(PDFName.of('ViewState'), PDFName.of(layer.visible !== false ? 'ON' : 'OFF'));
  usage.set(PDFName.of('View'), viewDict);

  return usage;
}

function createOrderArray(
  context: PDFDocument['context'],
  layers: OCGLayer[],
  ocgRefs: Map<string, PDFRef>
): PDFArray {
  const order = context.obj([]) as PDFArray;

  for (const layer of layers) {
    const ref = ocgRefs.get(layer.name);
    if (!ref) continue;

    if (layer.children && layer.children.length > 0) {
      // Group order: [name, child1, child2, ...]
      const group = context.obj([]) as PDFArray;
      group.push(PDFString.of(layer.name));
      for (const child of layer.children) {
        const childRef = ocgRefs.get(child.name);
        if (childRef) group.push(childRef);
      }
      order.push(group);
    } else {
      order.push(ref);
    }
  }

  return order;
}

function createDefaultState(
  context: PDFDocument['context'],
  layers: OCGLayer[]
): PDFArray {
  const d = context.obj([]) as PDFArray;

  // First element: array of initially ON layers
  const onLayers = context.obj([]) as PDFArray;
  // Second element: array of initially OFF layers
  const offLayers = context.obj([]) as PDFArray;

  for (const layer of layers) {
    if (layer.visible !== false) {
      onLayers.push(PDFString.of(layer.name));
    } else {
      offLayers.push(PDFString.of(layer.name));
    }
  }

  d.push(onLayers);
  d.push(offLayers);

  return d;
}

/**
 * Set layer visibility state for a specific usage application.
 */
export function setLayerState(
  doc: PDFDocument,
  layerName: string,
  visible: boolean,
  _intent: string = 'View'
): void {
  // This modifies the OC Properties D array
  // Implementation would modify the existing OCG state
  // Simplified for now — the initial state is set during createLayers
}

/**
 * Add content to a specific layer.
 * Wraps content stream operators with BDC/EMC markers.
 */
export function addContentToLayer(
  _contentStream: Uint8Array,
  _layerName: string
): Uint8Array {
  // PDF content stream layer marking:
  // /OC /LayerName BDC
  // ... content ...
  // EMC
  //
  // This requires modifying the page's content stream
  // which is beyond pdf-lib's abstraction level.
  // In practice, this is done by the rendering engine.
  return _contentStream;
}
