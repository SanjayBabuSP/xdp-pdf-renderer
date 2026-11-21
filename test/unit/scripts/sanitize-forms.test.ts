import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { render } from '../../../src';
import { contentStream, extractText } from '../../helpers/pdf-content';

const REPO = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'sanitize-forms.mjs');
const SAMPLE_FORMS = path.join(REPO, 'test', 'fixtures', 'sample-forms');

const SECRETS = /acme|widget|springfield|jane|jdoe|机械密封|0f8fad5b/i;
const MARKER = 'sanitize-forms placeholder';

function run(...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function pngBase64(): string {
  const png = new PNG({ width: 40, height: 20 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i * 7) % 256;
    png.data[i + 1] = 90;
    png.data[i + 2] = 160;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

function jpegBase64(): string {
  const canvas = createCanvas(30, 10);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366cc';
  ctx.fillRect(0, 0, 30, 10);
  return canvas.encodeSync('jpeg', 90).toString('base64');
}

function bmpBase64(width = 8, height = 4): string {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + rowSize * height, 0x7f);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(rowSize * height, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);
  return buf.toString('base64');
}

const IMAGES = { png: pngBase64(), jpeg: jpegBase64(), bmp: bmpBase64() };

function xdp(extraScript = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xfa generator="AdobeLiveCycleDesigner_V11.0" APIVersion="3.6.13324.0"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/" timeStamp="2023-04-17T10:22:33Z" uuid="0f8fad5b-d9cb-469f-a165-70867728950e">
<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
<subform name="form1" layout="tb" locale="en_US">
<pageSet>
<pageArea name="Page1" id="Page1">
<contentArea x="0.25in" y="0.25in" w="8in" h="10.5in"/>
<medium stock="a4" short="210mm" long="297mm"/>
<draw name="Logo" x="0.5in" y="0.1in" w="1in" h="0.5in"><value><image contentType="image/png">${IMAGES.png}</image></value></draw>
<draw name="Photo" x="2in" y="0.1in" w="1in" h="0.3in"><value><image contentType="image/jpeg">${IMAGES.jpeg}</image></value></draw>
<draw name="Stamp" x="4in" y="0.1in" w="1in" h="0.5in"><value><image contentType="image/bmp">${IMAGES.bmp}</image></value></draw>
</pageArea>
</pageSet>
<subform name="body" w="8in" layout="tb">
<draw name="Header" w="8in" h="0.3in"><?renderCache.textRun 30 Acme Widgets GmbH, Springfield 0 1417 7548 0 0 0 "Arial" 0 0 6500 ISO-8859-1?><value><text>Acme Widgets GmbH, Springfield</text></value><font typeface="Arial" size="10pt"/></draw>
<draw name="HeaderCN" w="8in" h="0.3in"><value><text>机械密封数据表</text></value></draw>
<draw name="Contact" w="8in" h="0.3in"><value><exData contentType="text/html"><body xmlns="http://www.w3.org/1999/xhtml"><p>Contact: <span style="font-weight:bold">jane.doe@acme-widgets.test</span></p></body></exData></value></draw>
<field name="Customer" w="8in" h="0.3in">
<ui><textEdit/></ui>
<caption reserve="1.5in"><value><text>Shaft diameter</text></value></caption>
<bind match="dataRef" ref="$record.Customer"/>
<event activity="initialize" name="event__initialize"><script contentType="application/x-javascript">
// owner: Jane Doe
if (this.rawValue == "Acme Widgets GmbH") { this.presence = "hidden"; }
${extraScript}
</script></event>
</field>
<field name="Flag" w="1in" h="0.3in">
<ui><textEdit/></ui>
<bind match="dataRef" ref="$record.Flag"/>
<event activity="initialize"><script>if ($record.Flag == "X") then $.presence = "visible" endif ; reviewed by Jane
if ($record.Code == 2) then $.presence = "visible" endif</script></event>
</field>
<field name="Picture" w="1in" h="1in"><ui><imageEdit/></ui><desc><text name="embeddedHref">C:\\Users\\jdoe\\Pictures\\Acme_Logo.png</text></desc></field>
<field name="Created" w="2in" h="0.3in"><ui><dateTimeEdit/></ui><format><picture>date{DD.MM.YYYY}</picture></format><bind match="dataRef" ref="$record.Created"/></field>
<field name="Count" w="1in" h="0.3in"><ui><numericEdit/></ui><bind match="dataRef" ref="$record.Count"/></field>
<field name="Speed" w="1in" h="0.3in"><ui><numericEdit/></ui><bind match="dataRef" ref="$record.Speed"/></field>
<field name="Email" w="3in" h="0.3in"><ui><textEdit/></ui><bind match="dataRef" ref="$record.Email"/></field>
<field name="Plant" w="3in" h="0.3in"><ui><textEdit/></ui><bind match="dataRef" ref="$record.Plant"/></field>
<field name="Mode" w="3in" h="0.3in"><ui><textEdit/></ui><bind match="dataRef" ref="$record.Mode"/></field>
<subform name="AcmeOrder" w="8in" layout="tb">
<bind match="dataRef" ref="$.AcmeOrder"/>
<field name="WidgetCount" w="2in" h="0.3in"><ui><numericEdit/></ui><bind match="dataRef" ref="$.AcmeOrder.WidgetCount"/></field>
<field name="JaneNote" w="3in" h="0.3in"><ui><textEdit/></ui>
<traversal><traverse operation="next" ref="Seal\\.Springfield[0]"/></traversal>
<bind match="dataRef" ref="$.AcmeOrder.JaneNote"/>
<event activity="initialize" name="event__initialize"><script contentType="application/x-javascript">
var acmeTotal = xfa.resolveNode("form1.body.AcmeOrder.WidgetCount").rawValue;
if (acmeTotal == 250) { if (this.parent.WidgetCount.rawValue == 250) { this.presence = "hidden"; } }
var acmeRows = _AcmeOrder.count;
</script></event>
</field>
<field name="WidgetTotal" w="2in" h="0.3in"><ui><numericEdit/></ui><calculate><script>var widgetSum = WidgetCount + 0
widgetSum</script></calculate></field>
<field name="Seal.Springfield" w="2in" h="0.3in"><ui><textEdit/></ui></field>
<field name="AcmeRef" id="AcmeAnchor" w="1in" h="0.3in" presence="hidden"><ui><textEdit/></ui></field>
<draw name="AcmeBanner" w="4in" h="0.3in"><value><exData contentType="text/html"><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><p>Order <span xfa:embedType="uri" xfa:embedMode="raw" xfa:embed="#AcmeAnchor"/></p></body></exData></value></draw>
</subform>
</subform>
</subform>
<?templateDesigner DefaultPreviewDataFileName C:\\Users\\jdoe\\Acme\\preview.xml?>
<?templateDesigner fileDigest shaHash="3q2+7wABCDEFGHIJKLMNOPQRSTUV="?>
</template>
<config xmlns="http://www.xfa.org/schema/xci/3.0/"><present><pdf><version>1.7</version></pdf><xdp><packets>*</packets></xdp></present></config>
<connectionSet xmlns="http://www.xfa.org/schema/xfa-connection-set/2.8/"><xsdConnection name="DataConnection" dataDescription="DataConnection"><uri>C:\\Users\\jdoe\\Acme\\Form.xsd</uri><rootElement>Root</rootElement></xsdConnection></connectionSet>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.4-c005"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" rdf:about=""><dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>
<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><Root><Customer>Acme Widgets GmbH</Customer><Plant>Springfield</Plant></Root></xfa:data></xfa:datasets>
</xdp:xdp>
`;
}

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
<!-- Maintained by Jane Doe, Acme Widgets GmbH -->
<xs:element name="Root">
<xs:annotation><xs:documentation>Datasheet for Acme Widgets GmbH</xs:documentation></xs:annotation>
<xs:complexType><xs:sequence>
<xs:element name="Customer" type="xs:string"/>
<xs:element name="Created" type="xs:date"/>
<xs:element name="Count" type="xs:byte"/>
<xs:element name="Speed" type="xs:float"/>
<xs:element name="Flag" type="xs:string"/>
<xs:element name="Email" type="xs:string"/>
<xs:element name="Plant" type="xs:string"/>
<xs:element name="Mode" type="xs:string"/>
<xs:element name="Code" type="xs:string"/>
<xs:element name="Ref" type="xs:short"/>
<xs:element name="AcmeOrder"><xs:complexType><xs:sequence>
<xs:element name="WidgetCount" type="xs:short"/>
<xs:element name="JaneNote" type="xs:string"/>
</xs:sequence></xs:complexType></xs:element>
</xs:sequence></xs:complexType>
</xs:element>
</xs:schema>
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Root>
<Customer>Acme Widgets GmbH</Customer>
<Created>2023-04-17</Created>
<Count>120</Count>
<Speed>1500.5</Speed>
<Flag>X</Flag>
<Email>jane.doe@acme-widgets.test</Email>
<Plant>Springfield 机械密封</Plant>
<Mode>hidden</Mode>
<Code>02</Code>
<Ref>1234567</Ref>
<AcmeOrder>
<WidgetCount>250</WidgetCount>
<JaneNote>Call Jane at Springfield</JaneNote>
</AcmeOrder>
</Root>
`;

function makeInput(root: string, extraScript = ''): string {
  const dir = path.join(root, 'in');
  fs.mkdirSync(path.join(dir, 'form'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'form', 'Form.xdp'), xdp(extraScript).replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(dir, 'form', 'Form.xsd'), XSD);
  fs.writeFileSync(path.join(dir, 'form', 'Form.xml'), XML);
  fs.writeFileSync(path.join(dir, 'form', 'Expected.pdf'), '%PDF-1.7 Acme Widgets GmbH');
  fs.writeFileSync(path.join(dir, 'form', 'notes.txt'), 'Call Jane Doe');
  return dir;
}

function value(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  if (!m) throw new Error(`<${name}> not found`);
  return m[1]!;
}

function imagePayloads(xdpText: string): Buffer[] {
  return [...xdpText.matchAll(/<image[^>]*>([^<]+)<\/image>/g)].map((m) =>
    Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64')
  );
}

function readAll(dir: string): string {
  return ['Form.xdp', 'Form.xsd', 'Form.xml']
    .map((f) => fs.readFileSync(path.join(dir, 'form', f), 'utf8'))
    .join('\n');
}

function pairTags(original: string, sanitized: string): Map<string, string> {
  const tagsOf = (xml: string): string[] =>
    [...xml.matchAll(/<([A-Za-z_][\w.-]*)[\s/>]/g)].map((m) => m[1]!);
  const before = tagsOf(original);
  const after = tagsOf(sanitized);
  if (before.length !== after.length) throw new Error('data files differ in element count');
  const pairs = new Map<string, string>();
  before.forEach((name, i) => {
    const renamed = after[i]!;
    if (pairs.has(name) && pairs.get(name) !== renamed)
      throw new Error(`inconsistent rename at element ${i}`);
    pairs.set(name, renamed);
  });
  return pairs;
}

async function renderedText(dir: string): Promise<string[][]> {
  const read = (file: string): string => fs.readFileSync(path.join(dir, 'form', file), 'utf8');
  const result = await render({
    xdp: read('Form.xdp'),
    xsd: read('Form.xsd'),
    data: read('Form.xml'),
  });
  if (!result.success) throw new Error(`[${result.error.code}] ${result.error.message}`);
  const pages = (await PDFDocument.load(result.data)).getPageCount();
  const text: string[][] = [];
  for (let i = 0; i < pages; i++) text.push(extractText(await contentStream(result.data, i)));
  return text;
}
describe('sanitize-forms script', () => {
  let tmp: string;
  let input: string;
  let output: string;
  let result: SpawnSyncReturns<string>;
  let outXdp: string;
  let outXml: string;
  let tags: Map<string, string>;

  const readOut = (file: string): string =>
    fs.readFileSync(path.join(output, 'form', file), 'utf8');
  const tag = (name: string): string => {
    const renamed = tags.get(name);
    if (renamed === undefined) throw new Error(`no data element ${name}`);
    return renamed;
  };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-forms-'));
    input = makeInput(tmp);
    output = path.join(tmp, 'out');
    result = run('--in', input, '--out', output);
    if (result.status !== 0)
      throw new Error(`sanitize-forms failed:\n${result.stdout}\n${result.stderr}`);
    outXdp = readOut('Form.xdp');
    outXml = readOut('Form.xml');
    tags = pairTags(XML, outXml);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('succeeds and mirrors only the xdp/xsd/xml files', () => {
    expect(result.status).toBe(0);
    expect(fs.readdirSync(path.join(output, 'form')).sort()).toEqual([
      'Form.xdp',
      'Form.xml',
      'Form.xsd',
    ]);
  });

  it('never prints company text', () => {
    expect(result.stdout + result.stderr).not.toMatch(SECRETS);
  });

  it('removes every fictional company detail', () => {
    expect(readAll(output)).not.toMatch(SECRETS);
  });

  it('keeps structure, bindings and script code', () => {
    for (const kept of [
      `ref="$record.${tag('Customer')}"`,
      'this.presence = "hidden"',
      '$.presence = "visible"',
      'date{DD.MM.YYYY}',
      '<rootElement>Root</rootElement>',
      `name="${tag('Customer')}"`,
      'typeface="Arial"',
      '<xs:element name="Count" type="xs:byte"/>',
    ]) {
      expect(outXdp + readOut('Form.xsd')).toContain(kept);
    }
  });

  it('replaces company-specific names with generated names', () => {
    expect(tag('Customer')).toMatch(/^Field_\d{4}$/);
    expect(tag('AcmeOrder')).toMatch(/^Subform_\d{4}$/);
    expect(tag('WidgetCount')).toMatch(/^Field_\d{4}$/);
    expect(tag('JaneNote')).toMatch(/^Field_\d{4}$/);
    expect(outXdp).toContain(`<subform name="${tag('AcmeOrder')}"`);
    expect(outXdp).toMatch(/<draw name="Draw_\d{4}" x="0\.5in"/);
    expect(outXdp).toContain(`<Root><${tag('Customer')}>`);
    const xsd = readOut('Form.xsd');
    expect(xsd).toContain(`<xs:element name="${tag('AcmeOrder')}">`);
    expect(xsd).toContain(`<xs:element name="${tag('WidgetCount')}" type="xs:short"/>`);
  });

  it('keeps generic XFA and Designer names', () => {
    for (const kept of [
      'name="form1"',
      'name="Page1"',
      'name="body"',
      'name="event__initialize"',
      'name="embeddedHref"',
      '<Root>',
      '<Count>',
      '<Code>',
    ]) {
      expect(outXdp + outXml).toContain(kept);
    }
  });

  it('renames references, ids and script names consistently', () => {
    const order = tag('AcmeOrder');
    const count = tag('WidgetCount');
    expect(outXdp).toContain(`ref="$.${order}.${count}"`);
    expect(outXdp).toContain(`xfa.resolveNode("form1.body.${order}.${count}")`);
    expect(outXdp).toContain(`if (this.parent.${count}.rawValue == 250)`);
    expect(outXdp).toContain(`= _${order}.count;`);

    const jsVar = /var (var_\d{4}) = xfa\.resolveNode/.exec(outXdp);
    expect(jsVar).not.toBeNull();
    expect(outXdp).toContain(`if (${jsVar![1]} == 250)`);
    expect(outXdp).toMatch(new RegExp(`var (var_\\d{4}) = ${count} \\+ 0\\r?\\n\\1`));

    const traverse = /<traverse operation="next" ref="(Field_\d{4})\[0\]"\/>/.exec(outXdp);
    expect(traverse).not.toBeNull();
    expect(outXdp).toContain(`<field name="${traverse![1]}" w="2in"`);

    const id = /<field name="Field_\d{4}" id="(Id_\d{4})"/.exec(outXdp);
    expect(id).not.toBeNull();
    expect(outXdp).toContain(`xfa:embed="#${id![1]}"`);
  });

  it('still binds data and runs scripts after renaming', async () => {
    const original = await renderedText(input);
    const sanitized = await renderedText(output);
    expect(sanitized.map((page) => page.length)).toEqual(original.map((page) => page.length));
    const text = sanitized.flat().join('\n');
    expect(text.split('250').length - 1).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain(value(outXml, tag('JaneNote')));
  }, 30000);

  it('keeps length, spacing, case and script of replaced text', () => {
    expect(value(outXml, tag('Customer'))).toMatch(
      /^[A-Z][a-z]{3} [A-Z][a-z]{6} [A-Z][a-z]{2}[A-Z]$/
    );
    expect(value(outXml, tag('Plant'))).toMatch(/^[A-Z][a-z]{10} [\u4e00-\u9fff]{4}$/);
    expect(outXdp).toMatch(/<text>[\u4e00-\u9fff]{7}<\/text>/);
    expect(outXdp).toMatch(/<text>[A-Z][a-z]{4} [a-z]{8}<\/text>/);
  });

  it('keeps typed values valid for the schema', () => {
    const created = value(outXml, tag('Created'));
    expect(created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${created}T00:00:00Z`).toISOString().slice(0, 10)).toBe(created);
    expect(created).not.toBe('2023-04-17');

    const count = Number(value(outXml, tag('Count')));
    expect(count).toBeGreaterThanOrEqual(100);
    expect(count).toBeLessThanOrEqual(127);

    expect(value(outXml, tag('Speed'))).toMatch(/^[1-9][1-9]00\.[1-9]$/);
    expect(value(outXml, tag('Email'))).toMatch(/^user-[0-9a-f]{6}@example\.com$/);

    expect(value(outXml, tag('Ref'))).toMatch(/^[1-9]{7}$/);
    expect(value(outXml, tag('Ref'))).not.toBe('1234567');
  });

  it('scrambles script literals consistently with the data', () => {
    expect(/this\.rawValue == "([^"]*)"/.exec(outXdp)?.[1]).toBe(value(outXml, tag('Customer')));
    expect(new RegExp(`\\$record\\.${tag('Flag')} == "([^"]*)"`).exec(outXdp)?.[1]).toBe(
      value(outXml, tag('Flag'))
    );
    expect(value(outXml, tag('Mode'))).toBe('hidden');
    expect(value(outXml, tag('Code'))).toBe('02');
    expect(value(outXml, tag('WidgetCount'))).toBe('250');
  });

  it('keeps raw CR line endings instead of character references', () => {
    expect(outXdp).not.toContain('&#xD;');
    expect(outXdp).toMatch(/\/\/ [a-z]{5}: [A-Z][a-z]{3} [A-Z][a-z]{2}\r\n/);
  });

  it('scrambles Designer render caches and embedded image paths', () => {
    expect(outXdp).toMatch(
      /<\?renderCache\.textRun 30 [A-Z][a-z]{3} [A-Z][a-z]{6} [A-Z][a-z]{2}[A-Z], [A-Z][a-z]{10} 0 1417 7548 0 0 0 "Arial" 0 0 6500 ISO-8859-1\?>/
    );
    expect(outXdp).toMatch(/<text name="embeddedHref">[A-Z][a-z]{3}_[A-Z][a-z]{3}\.png<\/text>/);
  });

  it('replaces images with marked placeholders of the same size and format', () => {
    const [png, jpeg, bmp] = imagePayloads(outXdp);
    const decoded = PNG.sync.read(png!);
    expect([decoded.width, decoded.height]).toEqual([40, 20]);
    expect(png!.toString('latin1')).toContain(MARKER);

    expect(jpeg!.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(jpeg!.toString('latin1')).toContain(MARKER);

    expect(bmp!.subarray(0, 2).toString('latin1')).toBe('BM');
    expect(bmp!.readInt32LE(18)).toBe(8);
    expect(bmp!.readInt32LE(22)).toBe(4);
    expect(bmp!.subarray(6, 10).toString('latin1')).toBe('XSPH');

    for (const original of Object.values(IMAGES)) {
      expect(outXdp).not.toContain(original);
    }
  });

  it('neutralises file paths, ids and metadata', () => {
    expect(outXdp).toContain('<uri>Form.xsd</uri>');
    expect(outXdp).toMatch(/DefaultPreviewDataFileName [a-z]{7}\.xml\?>/);
    expect(outXdp).not.toContain('C:\\');
    expect(outXdp).toMatch(/uuid="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/);
    expect(outXdp).not.toContain('3q2+7wABCDEFGHIJKLMNOPQRSTUV=');
    expect(outXdp).toMatch(/<rdf:li>[A-Z][a-z]{3} [A-Z][a-z]{2}<\/rdf:li>/);
  });

  it('is deterministic for the same salt and changes with a new salt', () => {
    const again = path.join(tmp, 'again');
    expect(run('--in', input, '--out', again).status).toBe(0);
    expect(readAll(again)).toBe(readAll(output));

    fs.rmSync(path.join(input, '.sanitize-salt'));
    const resalted = path.join(tmp, 'resalted');
    expect(run('--in', input, '--out', resalted).status).toBe(0);
    const resaltedXml = fs.readFileSync(path.join(resalted, 'form', 'Form.xml'), 'utf8');
    expect(value(resaltedXml, tag('Customer'))).not.toBe(value(outXml, tag('Customer')));
  });

  it('refuses to write when kept code still carries company text', () => {
    const leakyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-forms-leak-'));
    try {
      const leakyIn = makeInput(leakyRoot, `var fmt = "text{'Springfield' 9}";`);
      const leakyOut = path.join(leakyRoot, 'out');
      const leaky = run('--in', leakyIn, '--out', leakyOut);
      expect(leaky.status).toBe(1);
      expect(leaky.stdout + leaky.stderr).toContain('S*********d (11)');
      expect(leaky.stdout + leaky.stderr).not.toMatch(SECRETS);
      expect(fs.existsSync(leakyOut)).toBe(false);
    } finally {
      fs.rmSync(leakyRoot, { recursive: true, force: true });
    }
  });

  it('--check flags text planted into existing output', () => {
    const checked = path.join(tmp, 'checked');
    fs.cpSync(output, checked, { recursive: true });
    const xmlPath = path.join(checked, 'form', 'Form.xml');
    const customer = tag('Customer');
    fs.writeFileSync(
      xmlPath,
      fs
        .readFileSync(xmlPath, 'utf8')
        .replace(new RegExp(`<${customer}>[^<]*<`), `<${customer}>Springfield<`)
    );
    const check = run('--check', '--in', input, '--out', checked);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain('S*********d (11)');
  });

  it('--check flags an original name planted into existing output', () => {
    const checked = path.join(tmp, 'checked-names');
    fs.cpSync(output, checked, { recursive: true });
    const xsdPath = path.join(checked, 'form', 'Form.xsd');
    fs.writeFileSync(
      xsdPath,
      fs.readFileSync(xsdPath, 'utf8').replace(`name="${tag('AcmeOrder')}"`, 'name="AcmeOrder"')
    );
    const check = run('--check', '--in', input, '--out', checked);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('original name');
    expect(check.stderr).toContain('A*******r (9)');
  });

  it('--audit accepts clean output and flags emails and real images', () => {
    expect(run('--audit', output).status).toBe(0);

    const audited = path.join(tmp, 'audited');
    fs.cpSync(output, audited, { recursive: true });
    const xmlPath = path.join(audited, 'form', 'Form.xml');
    const clean = fs.readFileSync(xmlPath, 'utf8');
    fs.writeFileSync(
      xmlPath,
      clean.replace('</Root>', '<Element_9999>someone@company.test</Element_9999></Root>')
    );
    expect(run('--audit', audited).status).toBe(1);

    fs.writeFileSync(xmlPath, clean);
    const xdpPath = path.join(audited, 'form', 'Form.xdp');
    fs.writeFileSync(
      xdpPath,
      fs
        .readFileSync(xdpPath, 'utf8')
        .replace(/(<image contentType="image\/png">)[^<]+/, `$1${IMAGES.png}`)
    );
    expect(run('--audit', audited).status).toBe(1);
  });

  it('--audit flags names that are neither generated nor generic', () => {
    const audited = path.join(tmp, 'audited-names');
    fs.cpSync(output, audited, { recursive: true });
    const xmlPath = path.join(audited, 'form', 'Form.xml');
    fs.writeFileSync(
      xmlPath,
      fs
        .readFileSync(xmlPath, 'utf8')
        .replace('</Root>', '<SpringfieldPlant>1</SpringfieldPlant></Root>')
    );
    const audit = run('--audit', audited);
    expect(audit.status).toBe(1);
    expect(audit.stderr).toContain('unrecognised name');
    expect(audit.stderr).toContain('S**************t (16)');
  });
});

describe('committed sample forms', () => {
  it('pass the privacy audit', () => {
    const audit = run('--audit', SAMPLE_FORMS);
    expect(audit.stderr).toBe('');
    expect(audit.status).toBe(0);
  });
});
