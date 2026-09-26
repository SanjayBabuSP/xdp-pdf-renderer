# Preview PDF – Reference Files
## Adobe LiveCycle Designer 11.0

This folder contains a copy of every file involved in the **Preview PDF** feature,
organized by their role in the pipeline for learning purposes.

---

## WHY DOES PREVIEW PDF NEED ADOBE ACROBAT READER?

This is the most important question. Here is the full answer:

### Short Answer
LiveCycle Designer's built-in PDF viewer is **not a complete, standalone PDF viewer**.
It is a **shell** that hosts Acrobat/Reader's rendering engine via the `.ppi` plug-in system.
Without a Reader/Acrobat installation, many of the plug-in components cannot initialize.

### Full Technical Explanation

#### 1. The .ppi Plug-in System IS the Acrobat Plug-in System
The files in `pdf_plugins/` use the `.ppi` extension — **PDF Plug-In**.
This is Adobe Acrobat's own plug-in architecture (same architecture used by
Acrobat Reader's plug-ins). The plug-ins expect:
- Acrobat's **plug-in host API** (a set of function tables / callbacks) to be present.
- Shared registry keys written by the Acrobat/Reader installer.
- Access to Acrobat's **core API DLLs** which are only deployed by a Reader/Acrobat install.

    AcroForm.ppi  ──► needs Acrobat's form rendering host API
    EScript.ppi   ──► needs Acrobat's JavaScript host environment
    PDFLibPI.ppi  ──► needs AdobePDFL + Acrobat bridge

#### 2. AcroForm.ppi Cannot Work Alone
`AcroForm.ppi` (the 8.8 MB interactive form rendering engine) is the same plugin
that Acrobat Reader uses to render PDF form fields. It needs:
- **Acrobat's COM/ActiveX infrastructure** registered on the system.
- Acrobat's font and resource libraries (for form widget rendering).
- Acrobat's internal "notification" system for events (click, blur, change).

Without Reader installed, the plug-in's host API is absent → plug-in fails to load
→ Preview PDF shows a blank or crashes.

#### 3. EScript.ppi Needs Acrobat's JavaScript Host
`EScript.ppi` is Acrobat's ECMAScript engine plug-in. It expects:
- Acrobat's scripting engine to be initialized as the host.
- The `app` object, `event` object, and other Acrobat JS globals to exist.
- Access to Acrobat's built-in JavaScript APIs (e.g., `app.alert`, `util.printf`).

This is why JavaScript in Preview PDF behaves identically to JavaScript in
Adobe Reader — because it IS running inside the same engine.

#### 4. Registry Dependencies (Windows)
When Acrobat Reader installs, it writes keys to:

    HKEY_LOCAL_MACHINE\SOFTWARE\Adobe\Acrobat Reader\<version>\
    HKEY_CLASSES_ROOT\AcroExch.Document  (COM registration)

LiveCycle Designer reads these registry keys to:
- Locate the Acrobat installation path.
- Initialize the plug-in host environment.
- Find shared resource files (color profiles, spell-check dictionaries, etc.).

If Reader is not installed → registry keys missing → Designer cannot set up
the PDF preview host environment.

#### 5. Shared Font & Color Resources
Reader installs shared font resources and ICC color profiles.
`CoolType.dll` and `ACE.dll` look for these in Reader's install directory.
The `AdobeXMP.DLL` (XMP metadata) also relies on shared Adobe resources.

#### 6. Why Not Bundle Everything?
Adobe intentionally does NOT bundle a complete Reader into Designer because:
- It would make the installer enormous (Reader is hundreds of MBs).
- Licensing: Acrobat's rendering technology has separate licensing terms.
- Adobe's design philosophy: Designer is a *form authoring tool*, and the
  preview should exactly match what the end-user sees in Reader — so it
  literally uses Reader to do it.

### Summary: The Dependency Chain

    LiveCycle Designer
         │
         ├─ loads pdfplug_ins/*.ppi
         │         │
         │         └─ .ppi plug-ins need ──► Acrobat Plug-in Host API
         │                                          │
         │                                          └─► Requires Acrobat/Reader installed
         │
         ├─ reads registry for Acrobat path
         │
         └─ AdobePDFL.dll + AGM.dll share resources with Reader installation

---

## FOLDER STRUCTURE OF THIS REFERENCE

    reference/
    │
    ├── README.md                  ← This file
    ├── ANALYSIS.md                ← DLL export/import analysis + dependency graph
    ├── analysis_exports.json      ← Raw export tables for 67 DLLs
    │
    ├── config_files/              ← XML configs that DRIVE the preview
    │   ├── Designer.xci           ★ Sets destination=pdf (the key config)
    │   ├── Designer.xdc           ★ Declares PDF device capabilities
    │   ├── adobepdf.xdc           ← Adobe PDF device config (production)
    │   ├── acrobat6.xdc           ← Acrobat 6 compatibility config
    │   ├── acrobat7.xdc           ← Acrobat 7 compatibility config
    │   ├── xfaf8/9/10.xdc         ← XFA for Acrobat 8/9/10 configs
    │   ├── FormDesigner.ini       ← App initialization settings
    │   └── Application.ini        ← Web URL mappings
    │
    ├── printer_configs/           ← Remaining *.xdc printer/device configs
    │                                (PCL, ZPL, PostScript, DPL, IPL, TPCL…)
    │
    ├── designer_app/              ← Top-level executables
    │   ├── FormDesigner.exe       ★ THE APPLICATION (preview host, UI, F5 pipeline)
    │   └── arh.exe                ← Adobe HTTP request helper
    │
    ├── xfa_engine/                ← XFA processing core
    │   ├── xfa.dll                ★ Master XFA orchestrator
    │   ├── xfatemplate.dll        ★ Parses XFA <template> (form objects)
    │   ├── xfadata.dll            ★ Handles XFA <data> (sample data)
    │   ├── xfalayout.dll          ★ Computes layout / positions
    │   ├── xfapresentationagent.dll ★ Bridges XFA → PDF renderer
    │   ├── xfaconfiguration.dll   ← Reads XFA <config> packet
    │   ├── xfascripthandler.dll   ← Executes XFA scripts (init/calculate)
    │   ├── xfafontservice.dll     ← Font resolution for XFA
    │   ├── xfaimageservice.dll    ← Image handling for XFA
    │   ├── xfaform.dll            ← XFA form object model
    │   ├── xfaagent.dll           ← XFA agent interface
    │   ├── xfaxdptkagent.dll      ← XDP toolkit agent
    │   ├── xfaservice.dll         ← XFA service layer
    │   ├── xfasourceset.dll       ← Data source management
    │   ├── xfalocaleset.dll       ← Locale/language handling
    │   ├── xfahrefservice.dll     ← Hyperlink/href resolution
    │   ├── xfaconnectionsetproxy.dll ← Data connection proxy
    │   └── xfatraversalservice.dll   ← DOM traversal
    │
    ├── pdf_rendering/             ← The actual PDF writer stack
    │   ├── AdobePDFL.dll          ★ Adobe PDF Library (core PDF engine, 6MB)
    │   ├── pdfldriver.dll         ★ PDF Language Driver (writes PDF syntax)
    │   ├── pdfdocument.dll        ★ PDF document object model
    │   ├── pdfobjectcache.dll     ← Caches PDF objects for performance
    │   ├── renderer.dll           ← General rendering (shapes/borders)
    │   ├── designrenderer.dll     ← Designer-specific rendering
    │   ├── softwarerenderer.dll   ← Software fallback renderer
    │   ├── jfgraphic.dll          ← JetForm graphic rendering
    │   ├── jfdom.dll              ← JetForm document object model
    │   ├── jftext.dll             ← JetForm text rendering
    │   ├── jfutility.dll          ← JetForm utilities
    │   ├── jfprotocol.dll         ← JetForm protocol handler
    │   └── jfschema.dll           ← JetForm schema processing
    │
    ├── graphics_fonts/            ← Low-level graphics & font rendering
    │   ├── AGM.dll                ★ Adobe Graphics Model (2D drawing API)
    │   ├── ACE.dll                ★ Adobe Color Engine (color management)
    │   ├── CoolType.dll           ★ Font rasterization engine (text rendering)
    │   ├── AdobeSVGAGM.dll        ← SVG rendering via AGM
    │   ├── SVG.dll / SVGRE.dll    ← SVG support / rendering engine
    │   ├── BIB.dll / BIBUtils.dll ← Adobe Babel Image Bridge
    │   ├── MPS.dll                ← Multi-Platform Support layer
    │   ├── ARE.DLL                ← Adobe Raster Engine
    │   ├── font.dll / softfont.dll ← Font management / software rendering
    │   ├── xdc.dll                ← XDC device config processor
    │   ├── AdobeLinguistic.dll    ← Linguistic/text analysis
    │   ├── JP2KLib.dll            ← JPEG 2000 image codec
    │   └── AdobeXMP.DLL           ← XMP metadata handling
    │
    ├── script_engine/             ← JavaScript / FormCalc execution
    │   ├── ExtendScript.dll       ★ Adobe ExtendScript (JavaScript engine)
    │   ├── jfformcalc.dll         ★ FormCalc language interpreter
    │   ├── ScCore.DLL             ★ ExtendScript core runtime
    │   ├── axsle.dll              ← XML/XSLT engine
    │   ├── axtelang.dll           ← AXTELanguage support
    │   ├── FileImport.dll         ← File import handling
    │   ├── jfsoap/jfwsdl/wspolicy ← SOAP / WSDL / WS-Policy support
    │
    ├── script_templates/          ★ FormCalc & JS function metadata
    │   ├── FormCalc_fn.ini        ★ Every built-in FormCalc function (syntax)
    │   ├── JavaScript_fn.ini      ★ Every built-in JS form function
    │   ├── ScriptEditor.ini / SourceEditor.ini
    │   ├── actionResult*.template ★ Script snippets for common actions
    │   ├── validation*.template   ← Validation script snippets
    │   └── extract/mergestrings.xslt ← String table transforms
    │
    ├── converters/                ← Import/convert executables (CLI conversion)
    │   ├── ConvertPDF.exe / ConvertWord.exe / ConvertIP.exe
    │   ├── ConvertIFDShell.exe / convertifd.exe
    │   ├── ConvertXF.dll / ConvertXFEN.dll (XFA→XDP)
    │   └── jfbb32/jfbmp32/jftiff32/jfxdpexport.dll ← image & XDP export
    │
    ├── converter_configs/         ← Converter XML configs + BarcodeData.xml
    │
    ├── print_drivers/             ← Output device drivers (PDF is one of them)
    │
    ├── barcode_data/              ← Barcode symbology engines (*.pmp, scd/*.bpi)
    │
    ├── xml_parsing/               ← Expat XML parsers + AdobeXMP
    │
    ├── i18n_unicode/              ← ICU unicode libs (icuuc40, icucnv40, icudt40)
    │
    ├── xfa_toolkit/               ← Java-side XFA toolkit (JARs)
    │   ├── Libs/adobe-xfa-3.1.0.jar  ★ XFA schema/toolkit classes
    │   ├── Libs/fmltoxsdgenerator.jar ★ FML → XSD generator (data mapping!)
    │   ├── ConvertXF.jar / DesignerJavaUtils.jar
    │   └── dtd/xhtml*.dtd|.ent    ← XHTML output DTDs
    │
    ├── linguistics/               ← Spell-check/hyphenation dictionaries (193MB)
    │   └── Providers/.../AdobeHunspellPlugin.dll
    │
    ├── fonts/                     ← 362 bundled Adobe fonts (.otf/.ttf/.pfm/.pfb)
    │
    ├── pdf_plugins/               ← THE ACROBAT READER BRIDGE
    │   ├── AcroForm.ppi           ★ Renders interactive form fields in-app
    │   ├── EScript.ppi            ★ Acrobat JavaScript engine plug-in
    │   └── PDFLibPI.ppi           ★ PDF Library plug-in bridge
    │
    ├── decompiled/                ★ DECOMPILED C-LIKE PSEUDOCODE (*_disasm.c)
    │                                One file per binary, every function
    │
    ├── decompile_tools/           ← Ghidra scripts + batch runner (how to redo)
    │
    ├── app_meta/                  ← Splash images, manifests, XSLT, pmd.cer
    ├── conversation/              ← Prior analysis transcripts
    └── image_formats/             ← (reserved)

---

## HOW THESE FOLDERS RELATE TO THE PIPELINE

    [User presses F5]
          │
          ▼
    config_files/Designer.xci   ← "Use PDF as destination"
    config_files/Designer.xdc   ← "Use pdfldriver, support font embedding..."
          │
          ▼
    xfa_engine/*.dll            ← Parse form + compute layout + run scripts
          │
          ▼
    pdf_rendering/*.dll         ← Write PDF byte stream in memory
          +
    graphics_fonts/*.dll        ← Draw shapes, render text, manage color
          │
          ▼
    pdf_plugins/AcroForm.ppi    ← Display interactive PDF in the Preview tab
    pdf_plugins/EScript.ppi     ← Run JavaScript as you interact with fields

---

## DECOMPILED CODE (`decompiled/`)

Every binary above has been decompiled with **Ghidra 11.1.2** (headless) into
`decompiled/<name>_disasm.c` — one file per binary, containing C-like
pseudocode for **every function**, with mangled/demangled symbol names,
RTTI prototypes and call-site addresses. This is the fastest way for a human
or an AI model to study how FormCalc is evaluated, how layout/borders/fonts
are computed, and when scripts run in the Preview-PDF pipeline.

    decompiled/
    ├── xfa_disasm.c               ← XFA orchestrator (largest)
    ├── jfformcalc_disasm.c        ★ FormCalc interpreter (grammar + eval)
    ├── ExtendScript_disasm.c      ← JavaScript engine
    ├── xfascripthandler_disasm.c  ★ when scripts run (init/calculate/layout)
    ├── xfalayout_disasm.c         ★ position/border computation
    ├── pdfdocument_disasm.c       ← PDF object model
    ├── AdobePDFL_disasm.c         ← core PDF writer
    ├── FormDesigner.exe_disasm.c  ★ the app itself (F5 preview pipeline)
    └── … (one per binary)

**Regenerating / extending:** see `decompile_tools/README.md`
(Ghidra + JDK setup, `export_all.py`, `batch_decompile_v3.sh`).

**Not decompiled (by design):** `icudt40.dll` (pure ICU data tables),
locale copies `DE/ ES/ FR/ … Convert*.dll` (localized duplicates),
`Fonts/` (font binaries).

---

## KEY LEARNING POINTS

1. **`.xci` = What to do** — XFA Configuration Interface tells the engine which
   output mode (pdf vs html) and font substitutions.

2. **`.xdc` = How to do it** — XDC Device Config declares device capabilities
   (what the "pdf printer" can render: gradients, fonts, color, etc.).

3. **`.ppi` = The Reader bridge** — These are Acrobat plug-ins. They REQUIRE
   Acrobat/Reader to be installed as they use its plug-in host infrastructure.

4. **`AdobePDFL.dll`** is the crown jewel — the 6MB Adobe PDF Library that
   actually writes the PDF byte stream. It is the same library used in Acrobat.

5. **Two script engines** coexist:
   - `jfformcalc.dll` for FormCalc (Adobe's own formula language)
   - `ExtendScript.dll` + `EScript.ppi` for JavaScript

6. **The XFA engine is separate from the PDF writer** — xfa.dll computes WHAT
   to draw; pdfldriver.dll + AdobePDFL.dll decide HOW to write it as PDF bytes.

┌──────────────────────────────────────────────────────┐
│              Form Designer (Your App)                │
│                                                      │
│  Form Canvas         ←── konva.js / fabric.js        │
│  Drag & Drop         ←── interact.js / dnd-kit       │
│  Field Properties    ←── React / Vue component       │
│  Script Editor       ←── Monaco Editor (VS Code)     │
└────────────────┬─────────────────────────────────────┘
                 │  "Preview PDF" button clicked
                 ▼
┌──────────────────────────────────────────────────────┐
│           PDF Generation (NPM packages)              │
│                                                      │
│  pdf-lib      ← creates PDF structure + form fields  │
│  PDFKit       ← draws text, shapes, images           │
│  fontkit      ← font embedding & subsetting          │
│  jsPDF        ← alternative PDF writer               │
└────────────────┬─────────────────────────────────────┘
                 │  PDF bytes (ArrayBuffer / Blob)
                 ▼
┌──────────────────────────────────────────────────────┐
│           PDF Rendering (PDF.js by Mozilla)          │
│                                                      │
│  pdfjs-dist   ← renders PDF to <canvas> in browser   │
│               ← handles AcroForm interactive fields  │
│               ← 100% open source, no Acrobat needed  │
└──────────────────────────────────────────────────────┘

# PDF Generation (writing PDF)
npm install pdf-lib          # Best for form fields + manipulation
npm install pdfkit           # Stream-based PDF writer
npm install jspdf            # Simpler PDF generation

# PDF Rendering (viewing PDF in browser - replaces AcroForm.ppi)
npm install pdfjs-dist       # Mozilla's PDF renderer (what Firefox uses)

# Font Handling (replaces CoolType.dll)
npm install fontkit          # Font parsing, subsetting, embedding
npm install opentype.js      # OpenType/TrueType font rendering

# Canvas/Graphics (replaces AGM.dll)
npm install konva            # Canvas-based 2D graphics
npm install fabric           # Interactive canvas

# Script Editor (replaces FormDesigner's script panel)
npm install @monaco-editor/react  # VS Code's editor component
