# Adobe LiveCycle Designer 11.0 - DLL Analysis

## Overview
Analysis of 67 native Win32 DLLs (PE32, i386) from the Preview PDF pipeline.
All DLLs built with MSVC (MSVCR120.dll / MSVCP120.dll), compiled Nov 12 2020.

---

## Key Findings

### Build Information
- **PDB paths**: `Z:\jenkins\workspace\P11_Designer\sap_designer_p11_bootstrap\lc_designer_core\`
- **Branch**: `p9b`
- **OS**: `x86_win32_NET`
- **Version scheme**: `xtg_version_<module> version=3.6.20316.0`

### Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                     XFA ENGINE LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│ xfa.dll (2.6MB, 3681 exports) ← Master orchestrator            │
│   ├── xfatemplate.dll (706KB) ← Parses <template>              │
│   ├── xfadata.dll (227KB)     ← Handles <data>                 │
│   ├── xfalayout.dll (916KB)   ← Computes positions             │
│   ├── xfapresentationagent.dll ← Bridges XFA → PDF             │
│   ├── xfaform.dll             ← Form object model              │
│   ├── xfascripthandler.dll    ← JS/FormCalc execution          │
│   │     ├── ExtendScript.dll  ← JavaScript engine               │
│   │     └── jfformcalc.dll    ← FormCalc interpreter            │
│   ├── xfaservice.dll          ← Service layer (encoding/XSL)   │
│   ├── xfaconfiguration.dll    ← Reads <config> packet          │
│   ├── xfaxdptkagent.dll       ← XDP toolkit (PDF read/write)   │
│   │     └── AdobePDFL.dll     ← Core PDF engine                │
│   ├── xfafontservice.dll      ← Font resolution                │
│   ├── xfaimageservice.dll     ← Image handling                 │
│   ├── xfaagent.dll            ← Agent interface (logging)      │
│   ├── xfasourceset.dll        ← Data source (ADO/ODBC)         │
│   ├── xfalocaleset.dll        ← Locale/language                │
│   ├── xfahrefservice.dll      ← Hyperlink resolution           │
│   ├── xfaconnectionsetproxy.dll ← Data connection proxy         │
│   └── xfatraversalservice.dll   ← DOM traversal                │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PDF RENDERING LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│ AdobePDFL.dll (6.4MB, 1523 exports) ← PDF byte stream writer   │
│   ├── pdfldriver.dll (637KB) ← PDF language driver              │
│   ├── pdfdocument.dll (1.3MB) ← PDF document model             │
│   ├── pdfobjectcache.dll      ← Object caching                 │
│   ├── renderer.dll (414KB)    ← Shapes/borders rendering       │
│   ├── designrenderer.dll      ← Designer-specific rendering    │
│   ├── softwarerenderer.dll    ← Software fallback              │
│   ├── jfgraphic.dll (687KB)  ← JetForm graphics               │
│   ├── jfdom.dll (365KB)      ← JetForm DOM                    │
│   ├── jftext.dll (1.1MB)     ← Text/barcode rendering         │
│   ├── jfutility.dll (751KB)  ← Core utilities                 │
│   ├── jfprotocol.dll          ← Protocol handler               │
│   └── jfschema.dll            ← Schema processing              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                 GRAPHICS & FONTS LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│ AGM.dll (3.5MB)     ← Adobe Graphics Model (2D drawing)        │
│ ACE.dll              ← Adobe Color Engine (color management)    │
│ CoolType.dll (3.1MB) ← Font rasterization                      │
│ BIB.dll              ← Babel Image Bridge                       │
│ BIBUtils.dll         ← BIB utilities                            │
│ MPS.dll (5MB)       ← Multi-Platform Support                    │
│ font.dll (240KB)    ← Font management                           │
│ softfont.dll         ← Software font rendering                  │
│ SVG.dll / SVGRE.dll  ← SVG support/rendering                    │
│ AdobeSVGAGM.dll      ← SVG via AGM                              │
│ JP2KLib.dll          ← JPEG 2000 codec                          │
│ AdobeLinguistic.dll  ← Text analysis                            │
│ xdc.dll              ← Device config processor                  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SCRIPT ENGINE LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│ ExtendScript.dll     ← Adobe JavaScript engine                  │
│ ScCore.DLL           ← ExtendScript core runtime                │
│ jfformcalc.dll       ← FormCalc interpreter                     │
│ axsle.dll            ← XSLT engine                              │
│ axtelang.dll         ← AXTELanguage support                     │
│ FileImport.dll       ← File import handling                     │
│ jfsoap.dll           ← SOAP web service                         │
│ jfwsdl.dll           ← WSDL support                             │
│ wspolicy.dll         ← WS-Policy                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Export Counts (Top DLLs by Export Count)

| DLL | Size | Exports | Category |
|-----|------|---------|----------|
| jftext.dll | 1.1 MB | 3,448 | PDF Rendering |
| xfa.dll | 2.6 MB | 3,681 | XFA Engine |
| jfutility.dll | 751 KB | 2,329 | PDF Rendering |
| icuuc40.dll | 941 KB | 1,750 | I18n/Unicode |
| AdobePDFL.dll | 6.4 MB | 1,523 | PDF Core |
| ScCore.DLL | 585 KB | 1,226 | Script Engine |
| jfgraphic.dll | 687 KB | 1,206 | PDF Rendering |
| xfalayout.dll | 916 KB | 1,157 | XFA Engine |
| WRServices.dll | 1.2 MB | 1,103 | Core Libraries |
| xfatemplate.dll | 706 KB | 1,069 | XFA Engine |

---

## Key Strings by DLL

### xfa.dll - XFA Master Orchestrator
- Version tags: `AdobeDesigner_V6.0`, `AdobeLiveCycleDesigner_V8.0`, `AdobeFormsCentral`
- Encoding support: `ISO-8859-1` through `-9`, `Shift-JIS`, `KSC-5601`, `HKSCS-BIG5`
- XDC versions: `XDCEDIT_V1.0`, `XDCEDIT_V1.1`, `XDCEDIT_V1.3`, `XDCEDIT_V2.0`
- Locale support: `Cyrillic`, `EastEuropeanRoman`, `Japanese`, `SimplifiedChinese`, `TraditionalChinese`, `Vietnamese`

### xfatemplate.dll - Template Parser
- Properties: `BackColor`, `BorderColor`, `BorderWidth`, `ForeColor`, `Justification`
- Events: `OnCalculate`, `OnFormClosing`, `OnFormReady`, `OnInitialize`, `OnValidate`
- Data: `ConnectionString`, `RecordSource`, `CommandType`, `CursorType`
- Scripts: `FormCalc`, `JavaScript`, `PerlScript`
- Fields: `MultiLine`, `Password`, `MaxChars`, `ScrollLabel`, `Strikethrough`

### xfaxdptkagent.dll - XDP Toolkit
- PDF operations: `AcroForm`, `PDFEditPrivate`, `PDFLPriv`, `PDFLibrary`
- Annotations: `FreeText`, `Highlight`, `StrikeOut`, `Underline`, `FileAttachment`
- Encoding: `FlateDecode`, `ISO-8859-1`, `KSC-5601`, `Shift-JIS`
- Signature: `SigFlags`, `Contents`, `CheckSum`

### xfasourceset.dll - Data Source
- ADO operations: `ADODB.Connection`, `ADODB.Recordset`, `ADORecordSet::Open`
- DB operations: `MoveFirst`, `MoveLast`, `MoveNext`, `MovePrevious`
- CRUD: `deleteRecord`, `updateRecord`, `updateBatch`, `cancelBatch`
- Connection: `Provider=MSDASQL`, `Data Source=`

### xfascripthandler.dll - Script Handler
- Engines: `formcalc`, `javascript`
- Runtime: `ExtendScript.dll`, `ScCore.dll`, `jfformcalc.dll`
- Debug: `XTG_DBG_V1.0.4`

### AdobePDFL.dll - PDF Core (1523 exports)
- Color management: `AGMCCO*` series (30+ color profile functions)
- Color space: `AGMColorSpace*` series (20+ functions)
- Image processing: `AGMImage*` series (15+ functions)
- PDF operations: Extensive ACE (Adobe Color Engine) integration

### pdfldriver.dll - PDF Driver
- Viewer strings: `ADBE.Viewer_string_*`, `ADBE.Viewer_Form_string_*`
- JS: `ADBE_JSConsole`, `ADBE_JSDebugger`
- Language: `ADBE.LANGUAGE`

### pdfdocument.dll - PDF Document
- JavaScript API: `AFMakeNumber(getField("`, `AFNumber_`, `AFPercent_`, `AFSimple_Calculate(`
- Same AGM/ACE color management as other rendering DLLs

---

## Key Architecture Insights

1. **Two script engines coexist**: FormCalc (jfformcalc.dll) + JavaScript (ExtendScript.dll + EScript.ppi)
2. **XFA engine is separate from PDF writer**: xfa.dll computes WHAT to draw; pdfldriver.dll + AdobePDFL.dll write HOW
3. **AdobePDFL.dll is the crown jewel**: 6MB core PDF engine, same as Acrobat
4. **JetForm legacy**: Many jf*.dll files are from JetForm (acquired by Adobe)
5. **ADO data sources**: xfasourceset.dll uses OLE DB/ADO for database connections
6. **Build pipeline**: Jenkins → P11_Designer → lc_designer_core → dev_xtg

---

## Files Generated

- `analysis_exports.json` - Full exports + imports for all 67 DLLs (51,327 lines)
- `ANALYSIS.md` - This summary file
- `decompiled/*_disasm.c` - Ghidra decompilation (C-like pseudocode) of every
  binary in this reference folder, one file per binary, all functions included.
  Regenerate with `decompile_tools/` (Ghidra 11.1.2 headless + `export_all.py`).
  Skipped by design: `icudt40.dll` (ICU data only), locale `Convert*.dll`
  duplicates, font binaries.
