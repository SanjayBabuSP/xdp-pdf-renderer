# How "Preview PDF" Works in Adobe LiveCycle Designer 11.0

## Overview

When you click the **Preview PDF** button (or press **F5**, or go to `View → Preview PDF`), LiveCycle Designer renders your XFA form design as a fully interactive PDF, displayed in a built-in PDF viewer panel — **without saving to disk**.

---

## The Full Pipeline (Step by Step)

```
Form Design (.xdp / .pdf)
        │
        ▼
 1. XFA Engine reads the form template (XML-based XFA grammar)
        │
        ▼
 2. XFA Layout Engine computes element positions
        │
        ▼
 3. PDF Rendering Library writes PDF output (in memory)
        │
        ▼
 4. PDF Plug-in renders it in the Preview PDF tab
```

---

## Key Components Involved

### 1. `FormDesigner.exe` — The Host Application
- The main application executable (`27 MB`).
- Handles the **menu command** (`View → Preview PDF`, shortcut `F5`) and the **tab switching** logic.
- Coordinates between the design view and the preview tab.
- When Preview PDF is triggered, it passes the current in-memory XDP document to the XFA pipeline.

---

### 2. XFA Engine — The Core Processing Layer
These DLLs work together to parse, validate, and process the form:

| DLL | Role |
|-----|------|
| [`xfa.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfa.dll) | Core XFA processor — the master orchestrator |
| [`xfatemplate.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfatemplate.dll) | Parses the XFA `<template>` packet (form fields, subforms, layout rules) |
| [`xfadata.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfadata.dll) | Handles the XFA `<data>` packet (any sample data bound to fields) |
| [`xfalayout.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfalayout.dll) | Performs the **layout computation** — calculates exact positions and sizes of all form objects |
| [`xfaform.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfaform.dll) | Handles the overall form object model |
| [`xfaconfiguration.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfaconfiguration.dll) | Reads the XFA `<config>` packet to determine rendering target (`pdf`) |
| [`xfapresentationagent.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfapresentationagent.dll) | The **presentation agent** — bridges the XFA engine to the PDF rendering backend |
| [`xfascripthandler.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfascripthandler.dll) | Executes FormCalc/JavaScript scripts during preview (e.g., `initialize` events) |
| [`xfafontservice.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfafontservice.dll) | Resolves and maps fonts for the preview |
| [`xfaimageservice.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfaimageservice.dll) | Handles image rendering within the form |

---

### 3. `Designer.xci` — The XFA Configuration for Preview
[`Designer.xci`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/Designer.xci) is the **XFA Configuration Interface** file. This is critical — it tells the XFA engine what mode to run in:

```xml
<agent name="designer">
    <destination>pdf</destination>   <!-- ← Target is PDF -->
    <pdf>
        <fontInfo>
            <map>
                <!-- Font substitution rules, e.g. Helvetica → Arial -->
                <equate from="Helvetica_*_*" to="Arial_*_*" force="0"/>
                <equate from="Times_*_*" to="Times New Roman_*_*" force="0"/>
                ...
            </map>
        </fontInfo>
    </pdf>
</agent>
```

- The `<destination>pdf</destination>` element directs the XFA engine to use the **PDF rendering path** (not HTML, not print).
- The `<present>` block similarly configures the **presentation layer**.
- Font equate rules ensure cross-platform fonts render consistently in the preview.

---

### 4. `Designer.xdc` — The PDF Device Configuration
[`Designer.xdc`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/Designer.xdc) is the **XDC (XML Device Configuration)** file that describes the capabilities of the PDF "device":

```xml
<xdc name="adobepdf">
    <pdl>
        <renderLib name="pdfldriver"/>  <!-- ← Uses pdfldriver.dll -->
    </pdl>
    <deviceInfo>
        <option name="language">PDF</option>
        <option name="supportsFontEmbedding">1</option>
        <option name="supportsFontLinking">1</option>
        <option name="supportsNativeLinearFill">1</option>
        <option name="supportsNativeRadialFill">1</option>
        ...
    </deviceInfo>
</xdc>
```

- Points to **`pdfldriver`** (the PDF rendering library driver).
- Declares what PDF features are supported: font embedding, gradient fills, color images, etc.
- This is how the rendering engine knows *what* to emit into the PDF byte stream.

---

### 5. PDF Rendering Stack — Writing the Actual PDF
| DLL | Role |
|-----|------|
| [`pdfldriver.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfldriver.dll) | **PDF Language Driver** — the core PDF writer that converts rendered form objects into a PDF byte stream |
| [`pdfdocument.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfdocument.dll) | Manages the PDF document object model (pages, annotations, AcroForm fields) |
| [`AdobePDFL.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/AdobePDFL.dll) | **Adobe PDF Library** — low-level PDF creation and reading engine (6MB — the largest single component) |
| [`pdfobjectcache.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfobjectcache.dll) | Caches PDF objects for performance |
| [`renderer.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/renderer.dll) | General renderer: draws graphics, shapes, borders |
| [`designrenderer.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/designrenderer.dll) | Designer-specific rendering layer |
| [`jfgraphic.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/jfgraphic.dll) | Graphic rendering (JetForm heritage) |
| [`AGM.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/AGM.dll) | Adobe Graphics Model — Adobe's internal 2D graphics rendering API (used by PDFL) |
| [`ACE.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/ACE.dll) | Adobe Color Engine — manages color conversion |
| [`CoolType.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/CoolType.dll) | Adobe's font rasterization engine (text rendering) |

---

### 6. PDF Plug-ins — Displaying the Preview In-App
The [`pdfplug_ins/`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfplug_ins/) directory contains the viewer components:

| File | Role |
|------|------|
| `AcroForm.ppi` (8.8 MB) | The **AcroForm plugin** — renders interactive PDF form fields (text boxes, dropdowns, checkboxes, buttons) in the preview tab |
| `EScript.ppi` (1.4 MB) | The **EcmaScript (JavaScript) plugin** — runs JavaScript attached to form fields during the preview |
| `PDFLibPI.ppi` (314 KB) | PDF Library plugin — integration shim for AdobePDFL |
| `AcroForm/` | Supporting files for the AcroForm plug-in |

> The `.ppi` (PDF Plug-In) files are how the in-process PDF viewer renders the interactive form — this is why Preview PDF shows a **live, interactive** PDF (you can type in fields, click buttons, trigger scripts).

---

### 7. Script Execution During Preview
[`xfascripthandler.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfascripthandler.dll) + `EScript.ppi` together handle:
- **FormCalc** scripts (via [`jfformcalc.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/jfformcalc.dll))
- **JavaScript** scripts (via [`ExtendScript.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/ExtendScript.dll) + `EScript.ppi`)

Events fired during Preview PDF include: `initialize`, `calculate`, `validate`, `ready:form`.

---

## What Happens Behind the Scenes (Detailed Flow)

```
User clicks "Preview PDF" (or presses F5)
    │
    ├─ FormDesigner.exe saves current in-memory XDP state
    │
    ├─ xfa.dll is called with mode = "preview/pdf"
    │       ├─ xfaconfiguration.dll reads Designer.xci → destination = pdf
    │       ├─ xfatemplate.dll parses the <template> packet (all form objects)
    │       ├─ xfadata.dll loads any sample data (for data-bound fields)
    │       └─ xfascripthandler.dll fires "initialize" event scripts
    │
    ├─ xfalayout.dll computes positions of every form element
    │       (handles subform flow, pagination, margins, page breaks)
    │
    ├─ xfapresentationagent.dll bridges layout output → PDF rendering
    │       ├─ Reads Designer.xdc → uses "pdfldriver" render library
    │       ├─ pdfldriver.dll translates objects to PDF operators
    │       ├─ AdobePDFL.dll writes the raw PDF byte stream (in memory)
    │       │       ├─ AGM.dll draws vector graphics
    │       │       ├─ CoolType.dll rasterizes text/fonts
    │       │       └─ ACE.dll handles color spaces
    │       └─ pdfdocument.dll assembles PDF pages + AcroForm fields
    │
    └─ AcroForm.ppi renders the completed in-memory PDF in the Preview tab
            └─ EScript.ppi executes any JavaScript attached to fields
```

---

## Key Design Insight: Why It's Not Just a Screenshot

Preview PDF is **not** a screenshot or a visual approximation. It:

1. **Runs the full XFA pipeline** — the same engine that Adobe Reader/Acrobat uses to render forms at runtime.
2. **Creates a real PDF in memory** — the output is a genuine PDF document.
3. **Loads interactive plug-ins** — `AcroForm.ppi` gives you truly interactive form fields.
4. **Executes scripts** — initialize/calculate events fire, just like in the end-user's Reader.

This means what you see in Preview PDF is **exactly** what the end-user will see in Adobe Reader/Acrobat, including scripting behavior.

---

## Difference: Preview PDF vs Preview HTML

| Feature | Preview PDF (F5) | Preview HTML (F4) |
|---------|-----------------|------------------|
| Target | `destination = pdf` via XCI | `destination = html` |
| Renderer | AdobePDFL + pdfldriver | SVGRE.dll / SVG.dll |
| Interactivity | AcroForm.ppi (full PDF form fields) | Browser-style HTML rendering |
| Script engine | EScript.ppi + ExtendScript | ExtendScript (JavaScript only) |
| Use case | Simulates Adobe Reader experience | Simulates HTML5 Forms experience |

---

## Summary Table of Critical Files

| File | Purpose in Preview PDF |
|------|------------------------|
| [`FormDesigner.exe`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/FormDesigner.exe) | Triggers preview, hosts the preview tab |
| [`Designer.xci`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/Designer.xci) | Configures XFA to target PDF output |
| [`Designer.xdc`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/Designer.xdc) | Declares PDF device capabilities |
| [`xfa.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfa.dll) | Master XFA orchestrator |
| [`xfalayout.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfalayout.dll) | Computes all form object positions |
| [`xfapresentationagent.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/xfapresentationagent.dll) | Bridges XFA → PDF renderer |
| [`pdfldriver.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfldriver.dll) | PDF language driver (writes PDF) |
| [`AdobePDFL.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/AdobePDFL.dll) | Adobe PDF Library (core PDF engine) |
| [`pdfplug_ins/AcroForm.ppi`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfplug_ins/AcroForm.ppi) | Renders interactive PDF fields in-app |
| [`pdfplug_ins/EScript.ppi`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/pdfplug_ins/EScript.ppi) | Executes JavaScript during preview |
| [`CoolType.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/CoolType.dll) | Font rendering engine |
| [`AGM.dll`](file:///c:/Users/sanja/Downloads/BD_NW_7.0_Presentation_7.70_Comp._1_/ADOBE_LC_D110/Adobe/Designer%2011.0/AGM.dll) | Adobe Graphics Model (2D drawing) |
