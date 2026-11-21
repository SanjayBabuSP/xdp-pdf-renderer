import {
  parseXci,
  parseXdc,
  XciConfig,
  XciDeviceConfig,
} from '../../../../src/domain/config/xci-parser';

const DEFAULT_EVENTS = ['initialize', 'calculate', 'validate', 'ready', 'docReady'];

describe('parseXci', () => {
  it('reads agent and present configuration into a ConfigSpec', () => {
    const xml = `<xfa xmlns="http://www.xfa.org/schema/xci/3.0/">
      <config>
        <agent name="Reviewer">
          <destination>pdf</destination>
          <pdf>
            <version>1.7</version>
            <adobeExtensionLevel>8</adobeExtensionLevel>
            <fontInfo><map>
              <equate from="A" to="B" force="1"/>
              <equate from="C" to="D"/>
              <equate to="E"/>
              <equate from="F"/>
            </map></fontInfo>
          </pdf>
        </agent>
        <present>
          <script>
            <enabled>0</enabled>
            <maxCascadeDepth>7</maxCascadeDepth>
            <currentPage>pageNumber</currentPage>
            <events>
              <event>init</event>
              <event name="calculate"/>
            </events>
          </script>
        </present>
      </config>
    </xfa>`;
    const config: XciConfig = parseXci(xml);
    expect(config.destination).toBe('pdf');
    expect(config.agentName).toBe('Reviewer');
    expect(config.pdfVersion).toBe('1.7');
    expect(config.adobeExtensionLevel).toBe(8);
    expect(config.fontEquateRules).toEqual([
      { from: 'A', to: 'B', force: true },
      { from: 'C', to: 'D', force: false },
    ]);
    expect(config.scriptConfig).toEqual({
      enabled: false,
      maxCascadeDepth: 7,
      events: ['init', 'calculate'],
      currentPageVariable: 'pageNumber',
    });
  });

  it('prefers present destination and present pdf details when agent omits them', () => {
    const xml = `<xfa>
      <config>
        <agent name="designer"/>
        <present>
          <destination>print</destination>
          <pdf>
            <version>2.0</version>
            <adobeExtensionLevel>3</adobeExtensionLevel>
          </pdf>
        </present>
      </config>
    </xfa>`;
    const config = parseXci(xml);
    expect(config.destination).toBe('print');
    expect(config.pdfVersion).toBe('2.0');
    expect(config.adobeExtensionLevel).toBe(3);
    expect(config.fontEquateRules).toEqual([]);
  });

  it('falls back to defaults for a bare config element', () => {
    const config = parseXci('<xfa><config/></xfa>');
    expect(config.destination).toBe('pdf');
    expect(config.agentName).toBe('designer');
    expect(config.pdfVersion).toBeUndefined();
    expect(config.fontEquateRules).toEqual([]);
    expect(config.scriptConfig).toEqual({
      enabled: true,
      maxCascadeDepth: 25,
      events: DEFAULT_EVENTS,
    });
  });

  it('defaults script settings when no events element is present', () => {
    const xml = `<xfa><config><present><script><maxCascadeDepth>10</maxCascadeDepth></script></present></config></xfa>`;
    expect(parseXci(xml).scriptConfig).toEqual({
      enabled: true,
      maxCascadeDepth: 10,
      events: DEFAULT_EVENTS,
    });
  });

  it('returns the default config for malformed XML', () => {
    expect(parseXci('<xfa><config></config')).toEqual({
      destination: 'pdf',
      agentName: 'designer',
      fontEquateRules: [],
      scriptConfig: {
        enabled: true,
        maxCascadeDepth: 25,
        events: DEFAULT_EVENTS,
      },
    });
  });
});

describe('parseXdc', () => {
  it('reads render library and device capability options', () => {
    const xml = `<xdc>
      <pdl><renderLib name="customRenderer"/></pdl>
      <deviceInfo>
        <option name="language">EN</option>
        <option name="supportsFontEmbedding">1</option>
        <option name="supportsFontLinking">0</option>
        <option name="supportsNativeLinearFill">1</option>
        <option name="supportsNativeRadialFill">0</option>
        <option>ignored</option>
      </deviceInfo>
    </xdc>`;
    const config: XciDeviceConfig = parseXdc(xml);
    expect(config).toEqual({
      renderLib: 'customRenderer',
      language: 'EN',
      supportsFontEmbedding: true,
      supportsFontLinking: false,
      supportsNativeLinearFill: true,
      supportsNativeRadialFill: false,
    });
  });

  it('returns the default device config for malformed XML', () => {
    expect(parseXdc('<xdc></xdc')).toEqual({
      renderLib: 'pdfldriver',
      language: 'PDF',
      supportsFontEmbedding: true,
      supportsFontLinking: true,
      supportsNativeLinearFill: true,
      supportsNativeRadialFill: true,
    });
  });

  it('defaults language and capabilities when deviceInfo is absent', () => {
    const config = parseXdc('<xdc><pdl><renderLib name="lib"/></pdl></xdc>');
    expect(config.renderLib).toBe('lib');
    expect(config.language).toBe('PDF');
    expect(config.supportsFontEmbedding).toBe(false);
    expect(config.supportsFontLinking).toBe(false);
    expect(config.supportsNativeLinearFill).toBe(false);
    expect(config.supportsNativeRadialFill).toBe(false);
  });
});
