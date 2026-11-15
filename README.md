# @sanjay-sde/xdp-pdf-renderer
⚠️ **IMPORTANT:** THIS PROJECT IS PURELY DEVELOPED FOR MY OWN EDUCATIONAL PURPOSES. I DO NOT CONDEMN PIRATING/SHARING OF ILLEGAL SOFTWARE LICENSES WITHOUT PROPER PURCHASE.
> Render PDF documents from XDP templates, XSD schemas, and XML data — no SAP dependency.
> This is a passion project that I've developed to understand how this particular software works. I do not sell this or made money off this project.

Replaces SAP  Forms Service by taking an **XDP template**, an **XSD schema**, and **XML data** — and producing a **PDF** — entirely in Node.js with zero SAP dependencies.

## Installation

```bash
npm install @sanjay-sde/xdp-pdf-renderer
```

## Usage

### Programmatic API

```typescript
import { render } from '@sanjay-sde/xdp-pdf-renderer';
import { readFileSync, writeFileSync } from 'fs';

const result = await render({
  xdp: readFileSync('templates/invoice.xdp', 'utf8'),
  xsd: readFileSync('schemas/invoice.xsd', 'utf8'),
  data: readFileSync('data/invoice-001.xml', 'utf8'),
});

if (result.success) {
  writeFileSync('output/invoice.pdf', result.data);
  console.log('PDF generated successfully');
} else {
  console.error(`[${result.error.code}] ${result.error.message}`);
}
```

### CLI

```bash
# Render a PDF
xdp-pdf render --xdp template.xdp --xsd schema.xsd --data data.xml --output invoice.pdf

# Validate without rendering
xdp-pdf validate --xdp template.xdp --xsd schema.xsd --data data.xml

# Inspect parsed template structure
xdp-pdf inspect --xdp template.xdp --output json
```

## Architecture

The module follows a **Handler → Workflow → Domain → Lib** layered pattern:

```
src/
├── index.ts                    ← Public API
├── cli.ts                      ← CLI entry point
├── workflows/                  ← Orchestration (I/O + Pure)
│   └── render-pdf.ts
├── domain/                     ← Pure Functions (NO I/O)
│   ├── parsing/
│   ├── validation/
│   ├── mapping/
│   └── layout/
├── rendering/                  ← I/O Boundary (PDF generation)
├── lib/                        ← Generic Utilities
├── config/                     ← Configuration as Data
└── errors/                     ← Error definitions
```

All domain functions are **pure** (no I/O, no side effects) and return a `Result<T>` type:

```typescript
type Result<T> = { success: true; data: T } | { success: false; error: ErrorResult };
```

## Pipeline

```
XDP Template + XSD Schema + XML Data
         │
    Parse (pure)
         │
    Validate (pure)
         │
    Map data → layout (pure)
         │
    Calculate positions (pure)
         │
    Paginate (pure)
         │
    Render PDF (I/O)
         │
      Buffer
```

## Development

```bash
npm install
npm run build
npm test
npm run sample-forms   # render the sanitized real-world forms into test/fixtures/sample-forms/results/
```

The real-world test forms in [`test/fixtures/sample-forms`](test/fixtures/sample-forms/README.md)
are sanitized copies of private forms; see their README for how they are produced.

## License

MIT
