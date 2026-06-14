#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { render } from './index';

const program = new Command();

program
  .name('xdp-pdf')
  .description('Render PDF documents from XDP templates, XSD schemas, and XML data')
  .version('0.1.0');

program
  .command('render')
  .description('Render a PDF from XDP template, XSD schema, and XML data')
  .requiredOption('--xdp <file>', 'Path to the XDP template file')
  .requiredOption('--xsd <file>', 'Path to the XSD schema file')
  .requiredOption('--data <file>', 'Path to the XML data file (use - for stdin)')
  .option('-o, --output <file>', 'Output PDF file path', 'output.pdf')
  .action(async (opts) => {
    const xdp = readFile(opts.xdp, '--xdp');
    const xsd = readFile(opts.xsd, '--xsd');
    const data = opts.data === '-' ? readStdin() : readFile(opts.data, '--data');

    const result = await render({ xdp, xsd, data });

    if (!result.success) {
      process.stderr.write(`Error: ${result.error.message}\nCode: ${result.error.code}\n`);
      if (result.error.details?.length) {
        result.error.details.forEach((d) => process.stderr.write(`  - ${d}\n`));
      }
      process.exit(1);
    }

    const outPath = path.resolve(opts.output);
    fs.writeFileSync(outPath, result.data);
    process.stdout.write(`PDF written to ${outPath}\n`);
  });

program
  .command('validate')
  .description('Validate XDP template, XSD schema, and XML data without rendering')
  .requiredOption('--xdp <file>', 'Path to the XDP template file')
  .requiredOption('--xsd <file>', 'Path to the XSD schema file')
  .requiredOption('--data <file>', 'Path to the XML data file')
  .action(async (opts) => {
    const xdp = readFile(opts.xdp, '--xdp');
    const xsd = readFile(opts.xsd, '--xsd');
    const data = readFile(opts.data, '--data');

    // Use a minimal render that stops before PDF generation
    const result = await render({ xdp, xsd, data });

    if (!result.success) {
      process.stderr.write(`Validation failed: ${result.error.message}\nCode: ${result.error.code}\n`);
      if (result.error.details?.length) {
        result.error.details.forEach((d) => process.stderr.write(`  - ${d}\n`));
      }
      process.exit(1);
    }
    process.stdout.write('Validation passed.\n');
  });

program
  .command('inspect')
  .description('Inspect the parsed XDP template structure')
  .requiredOption('--xdp <file>', 'Path to the XDP template file')
  .option('-o, --output <format>', 'Output format (json)', 'json')
  .action((opts) => {
    const { parseXdp } = require('./domain/parsing/parse-xdp');
    const xdp = readFile(opts.xdp, '--xdp');
    const result = parseXdp(xdp);

    if (!result.success) {
      process.stderr.write(`Inspect failed: ${result.error.message}\n`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
  });

function readFile(filePath: string, flag: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`Error: File not found for ${flag}: ${resolved}\n`);
    process.exit(2);
  }
  return fs.readFileSync(resolved, 'utf8');
}

function readStdin(): string {
  return fs.readFileSync('/dev/stdin', 'utf8');
}

program.parse(process.argv);
