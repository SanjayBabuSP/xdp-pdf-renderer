import * as root from '../../src/index';
import * as adobe from '../../src/adobe';
import * as scripting from '../../src/domain/scripting';
import * as formcalc from '../../src/domain/scripting/formcalc';
import * as jsEngine from '../../src/domain/scripting/js-engine';

describe('public barrels expose their runtime exports', () => {
  it('src/index.ts exposes the public API', () => {
    expect(typeof root.render).toBe('function');
    expect(typeof root.validate).toBe('function');
    expect(typeof root.compile).toBe('function');
    expect(typeof root.inspect).toBe('function');
    expect(typeof root.ERROR_CODES).toBe('object');
    expect(root.ERROR_CODES.PDF_GENERATION_FAILED.code).toBe('REN_5003');
    expect(root.ERROR_CODES.FONT_NOT_FOUND.hint).toEqual(expect.any(String));
  });

  it('render delegates to the workflow', async () => {
    const result = await root.render({ xdp: '<invalid/>', xsd: '', data: '' });
    expect(result.success).toBe(false);
  });

  it('validate and inspect return failure results for invalid inputs', async () => {
    const validated = await root.validate({ xdp: '<invalid/>', xsd: '', data: '' });
    expect(validated.success).toBe(false);
    const inspected = root.inspect('<invalid/>');
    expect(inspected.success).toBe(false);
  });

  it('src/adobe/index.ts exposes its feature entry points', () => {
    expect(typeof adobe.applyPdfSecurity).toBe('function');
    expect(typeof adobe.addBookmarks).toBe('function');
    expect(typeof adobe.addAnnotations).toBe('function');
    expect(typeof adobe.createLayers).toBe('function');
    expect(typeof adobe.flattenFormFields).toBe('function');
    expect(typeof adobe.setGlobalTabOrder).toBe('function');
    expect(typeof adobe.resolveFontSequence).toBe('function');
    expect(typeof adobe.XfaEventDispatcher).toBe('function');
    expect(typeof adobe.validateXfaNamespaces).toBe('function');
    expect(typeof adobe.applyDocumentMetadata).toBe('function');
    expect(typeof adobe.embedXfaPackage).toBe('function');
    expect(typeof adobe.markDocumentTagged).toBe('function');
    expect(typeof adobe.createAcroFormFields).toBe('function');
    expect(typeof adobe.applyPdfVersion).toBe('function');
    expect(typeof adobe.md5).toBe('function');
  });

  it('src/domain/scripting/index.ts exposes its scripting entry points', () => {
    expect(typeof scripting.dispatchScripts).toBe('function');
    expect(typeof scripting.dispatchPostLayoutScripts).toBe('function');
    expect(typeof scripting.dispatchInteractiveEvent).toBe('function');
    expect(typeof scripting.buildScriptIndex).toBe('function');
    expect(typeof scripting.createFieldAccessor).toBe('function');
    expect(typeof scripting.FormCalcParser).toBe('function');
    expect(typeof scripting.JavaScriptEngine).toBe('function');
    expect(typeof scripting.SomExpressionResolver).toBe('function');
    expect(typeof scripting.parseSomExpression).toBe('function');
    expect(typeof scripting.buildDependencyGraph).toBe('function');
    expect(typeof scripting.PropertyChangeTracker).toBe('function');
    expect(typeof scripting.createXfaFormProxy).toBe('function');
    expect(scripting.ADOBE_MAX_CASCADE_DEPTH).toBeGreaterThan(0);
  });

  it('src/domain/scripting/formcalc/index.ts exposes the formcalc pipeline', () => {
    expect(typeof formcalc.FormCalcLexer).toBe('function');
    expect(typeof formcalc.TokenType).toBe('object');
    expect(typeof formcalc.FormCalcParser).toBe('function');
    expect(typeof formcalc.FormCalcParseError).toBe('function');
    expect(typeof formcalc.FormCalcEvaluator).toBe('function');
    expect(typeof formcalc.FormCalcError).toBe('function');
    expect(typeof formcalc.formCalcTruthy).toBe('function');
  });

  it('src/domain/scripting/js-engine/index.ts exposes the JavaScript engine', () => {
    expect(typeof jsEngine.JavaScriptEngine).toBe('function');
    expect(typeof jsEngine.JavaScriptEngineError).toBe('function');
  });
});
