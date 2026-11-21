
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
  name: string;
  visible?: boolean;
  printable?: boolean;
  exportable?: boolean;
  parent?: string;
  children?: OCGLayer[];
  intent?: string[];
}

export interface LayerState {
  name: string;
  visible: boolean;
}

export function createLayers(doc: PDFDocument, layers: OCGLayer[]): void {
  if (layers.length === 0) return;

  const context = doc.context;

  const ocgs = context.obj([]) as PDFArray;
  const ocgRefs = new Map<string, PDFRef>();

  for (const layer of layers) {
    const ocgDict = createOCGDict(context, layer);
    const ref = context.register(ocgDict);
    ocgs.push(ref);
    ocgRefs.set(layer.name, ref);
  }

  const ocProps = context.obj({}) as PDFDict;
  ocProps.set(PDFName.of('OCGs'), ocgs);

  const order = createOrderArray(context, layers, ocgRefs);
  ocProps.set(PDFName.of('Order'), order);

  const dArray = createDefaultState(context, layers);
  ocProps.set(PDFName.of('D'), dArray);

  const asArray = context.obj([]) as PDFArray;
  const viewIntent = context.obj([]) as PDFArray;
  viewIntent.push(PDFName.of('View'));
  asArray.push(viewIntent);
  ocProps.set(PDFName.of('AS'), asArray);

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

  const ocPropsRef = context.register(ocProps);

  const catalog = context.lookup(context.trailerInfo.Root) as PDFDict;
  if (catalog) {
    catalog.set(PDFName.of('OCProperties'), ocPropsRef);
  }
}

function createOCGDict(context: PDFDocument['context'], layer: OCGLayer): PDFDict {
  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Type'), PDFName.of('OCG'));
  dict.set(PDFName.of('Name'), PDFString.of(layer.name));

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

  const printDict = context.obj({}) as PDFDict;
    printDict.set(PDFName.of('Print'), layer.printable !== false ? PDFBool.True : PDFBool.False);
    printDict.set(PDFName.of('PrintState'), PDFName.of(layer.visible !== false ? 'ON' : 'OFF'));
    usage.set(PDFName.of('Print'), printDict);

    const exportDict = context.obj({}) as PDFDict;
    exportDict.set(PDFName.of('Export'), layer.exportable !== false ? PDFBool.True : PDFBool.False);
    exportDict.set(PDFName.of('ExportState'), PDFName.of(layer.visible !== false ? 'ON' : 'OFF'));
  usage.set(PDFName.of('Export'), exportDict);

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

    if (layer.children && layer.children.length) {
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

  const onLayers = context.obj([]) as PDFArray;
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

export function setLayerState(
  doc: PDFDocument,
  layerName: string,
  visible: boolean,
  _intent: string = 'View'
): void {
}

export function addContentToLayer(
  _contentStream: Uint8Array,
  _layerName: string
): Uint8Array {
  return _contentStream;
}
