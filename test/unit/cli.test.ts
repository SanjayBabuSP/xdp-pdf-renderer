import * as fs from 'fs';
import { Command } from 'commander';
import { inspect, render, validate } from '../../src/index';
import type { LayoutModel, Result } from '../../src/types';
import { version } from '../../package.json';

interface CommandSpy {
  commandName: string | undefined;
  descriptions: string[];
  versions: string[];
  requiredOptions: Array<{ flags: string; description: string }>;
  options: Array<{ flags: string; description: string; defaultValue?: unknown }>;
  actions: Array<(opts: Record<string, unknown>) => void | Promise<void>>;
  children: CommandSpy[];
  parsedArgv: string[] | undefined;
}

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn((filePath: unknown) => {
      if (typeof filePath === 'string' && filePath.endsWith('package.json')) {
        return JSON.stringify(jest.requireActual('../../package.json'));
      }
      return '';
    }),
    writeFileSync: jest.fn(),
  };
});

jest.mock('commander', () => {
  class MockCommand {
    static instances: MockCommand[] = [];
    commandName: string | undefined;
    descriptions: string[] = [];
    versions: string[] = [];
    requiredOptions: Array<{ flags: string; description: string }> = [];
    options: Array<{ flags: string; description: string; defaultValue?: unknown }> = [];
    actions: Array<(opts: Record<string, unknown>) => void | Promise<void>> = [];
    children: MockCommand[] = [];
    parsedArgv: string[] | undefined;

    constructor(commandName?: string) {
      this.commandName = commandName;
      MockCommand.instances.push(this);
    }

    name(value: string): this {
      this.commandName = value;
      return this;
    }

    description(value: string): this {
      this.descriptions.push(value);
      return this;
    }

    version(value: string): this {
      this.versions.push(value);
      return this;
    }

    command(value: string): MockCommand {
      const child = new MockCommand(value);
      this.children.push(child);
      return child;
    }

    requiredOption(flags: string, description: string): this {
      this.requiredOptions.push({ flags, description });
      return this;
    }

    option(flags: string, description: string, defaultValue?: unknown): this {
      this.options.push({ flags, description, defaultValue });
      return this;
    }

    action(handler: (opts: Record<string, unknown>) => void | Promise<void>): this {
      this.actions.push(handler);
      return this;
    }

    parse(argv: string[]): this {
      this.parsedArgv = argv;
      return this;
    }
  }

  return { Command: MockCommand };
});

jest.mock('../../src/index', () => ({
  inspect: jest.fn(),
  render: jest.fn(),
  validate: jest.fn(),
}));

class ProcessExit extends Error {}

const commandClass = Command as unknown as { instances: CommandSpy[] };
const argv = ['node', 'xdp-pdf', '--help'];

async function opts(): Promise<Record<string, unknown>> {
  return {
    xdp: 'template.xdp',
    xsd: 'schema.xsd',
    data: 'data.xml',
    output: 'out.pdf',
    lenient: false,
  };
}

describe('cli module wiring', () => {
  let root: CommandSpy;
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeAll(async () => {
    process.argv = argv;
    await import('../../src/cli');
    root = commandClass.instances[0];
  });

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new ProcessExit(String(code));
    }) as (code?: string | number | null) => never);
    jest.mocked(fs.existsSync).mockReset().mockReturnValue(true);
    jest.mocked(fs.readFileSync).mockReset().mockReturnValue('FILE');
    jest
      .mocked(fs.writeFileSync)
      .mockReset()
      .mockImplementation(() => undefined);
    jest.mocked(render).mockReset();
    jest.mocked(validate).mockReset();
    jest.mocked(inspect).mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('registers the program metadata and parses the captured argv', () => {
    expect(commandClass.instances).toHaveLength(4);
    expect(root.commandName).toBe('xdp-pdf');
    expect(root.descriptions).toEqual([
      'Render PDF documents from XDP templates, XSD schemas, and XML data',
    ]);
    expect(root.versions).toEqual([version]);
    expect(root.parsedArgv).toBe(argv);
    expect(root.children.map((child) => child.commandName)).toEqual([
      'render',
      'validate',
      'inspect',
    ]);
  });

  it('registers the render command options and a single action', () => {
    const command = root.children[0];
    expect(command.descriptions).toEqual([
      'Render a PDF from XDP template, XSD schema, and XML data',
    ]);
    expect(command.requiredOptions.map((option) => option.flags)).toEqual([
      '--xdp <file>',
      '--xsd <file>',
      '--data <file>',
    ]);
    expect(command.options.map((option) => option.flags)).toEqual([
      '-o, --output <file>',
      '--lenient',
    ]);
    expect(command.options.map((option) => option.defaultValue)).toEqual(['output.pdf', false]);
    expect(command.actions).toHaveLength(1);
    expect(typeof command.actions[0]).toBe('function');
  });

  it('registers the validate command options and a single action', () => {
    const command = root.children[1];
    expect(command.descriptions).toEqual([
      'Validate XDP template, XSD schema, and XML data without rendering',
    ]);
    expect(command.requiredOptions.map((option) => option.flags)).toEqual([
      '--xdp <file>',
      '--xsd <file>',
      '--data <file>',
    ]);
    expect(command.options.map((option) => option.flags)).toEqual(['--lenient']);
    expect(command.options.map((option) => option.defaultValue)).toEqual([false]);
    expect(command.actions).toHaveLength(1);
    expect(typeof command.actions[0]).toBe('function');
  });

  it('registers the inspect command options and a single action', () => {
    const command = root.children[2];
    expect(command.descriptions).toEqual(['Inspect the parsed XDP template structure']);
    expect(command.requiredOptions.map((option) => option.flags)).toEqual(['--xdp <file>']);
    expect(command.options.map((option) => option.flags)).toEqual(['-o, --output <format>']);
    expect(command.options.map((option) => option.defaultValue)).toEqual(['json']);
    expect(command.actions).toHaveLength(1);
    expect(typeof command.actions[0]).toBe('function');
  });

  it('wires the render action to render() and writes the output file', async () => {
    const success: Result<Buffer> = { success: true, data: Buffer.from('%PDF-1.7') };
    jest.mocked(render).mockResolvedValue(success);
    await root.children[0].actions[0](await opts());

    expect(jest.mocked(render)).toHaveBeenCalledWith({
      xdp: 'FILE',
      xsd: 'FILE',
      data: 'FILE',
      options: { strictValidation: true },
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('out.pdf'), success.data);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PDF written to '));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('wires the lenient flag to non-strict validation', async () => {
    jest.mocked(render).mockResolvedValue({ success: true, data: Buffer.from('%PDF-') });
    await root.children[0].actions[0]({ ...(await opts()), lenient: true });
    expect(jest.mocked(render)).toHaveBeenCalledWith(
      expect.objectContaining({ options: { strictValidation: false } })
    );
  });

  it('reads stdin when the data flag is a dash', async () => {
    jest.mocked(render).mockResolvedValue({ success: true, data: Buffer.from('%PDF-') });
    await root.children[0].actions[0]({ ...(await opts()), data: '-' });
    expect(fs.readFileSync).toHaveBeenCalledWith(0, 'utf8');
  });

  it('reports render failures and exits with code 1', async () => {
    jest.mocked(render).mockResolvedValue({
      success: false,
      error: { code: 'REN_5003', message: 'broken', details: ['detail'] },
    });
    await expect(root.children[0].actions[0](await opts())).rejects.toThrow(ProcessExit);
    expect(stderrSpy).toHaveBeenCalledWith('Error: broken\nCode: REN_5003\n');
    expect(stderrSpy).toHaveBeenCalledWith('  - detail\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('reports a missing file and exits with code 2', async () => {
    jest.mocked(fs.existsSync).mockReturnValue(false);
    await expect(root.children[0].actions[0](await opts())).rejects.toThrow(ProcessExit);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('File not found for --xdp'));
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(jest.mocked(render)).not.toHaveBeenCalled();
  });

  it('wires the validate action to the library validate() function', async () => {
    jest.mocked(validate).mockResolvedValue({ success: true, data: Buffer.from('%PDF-') });
    await root.children[1].actions[0](await opts());
    expect(jest.mocked(validate)).toHaveBeenCalledWith({
      xdp: 'FILE',
      xsd: 'FILE',
      data: 'FILE',
      options: { strictValidation: true },
    });
    expect(stdoutSpy).toHaveBeenCalledWith('Validation passed.\n');
  });

  it('reports validate failures and exits with code 1', async () => {
    jest.mocked(validate).mockResolvedValue({
      success: false,
      error: { code: 'VAL_2001', message: 'invalid', details: ['missing'] },
    });
    await expect(root.children[1].actions[0](await opts())).rejects.toThrow(ProcessExit);
    expect(stderrSpy).toHaveBeenCalledWith('Validation failed: invalid\nCode: VAL_2001\n');
    expect(stderrSpy).toHaveBeenCalledWith('  - missing\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('wires the inspect action to the library inspect() function', async () => {
    const layout: LayoutModel = { rootSubformName: 'form', pages: [], children: [] };
    jest.mocked(inspect).mockReturnValue({ success: true, data: layout });
    await root.children[2].actions[0]({ xdp: 'template.xdp', output: 'json' });
    expect(jest.mocked(inspect)).toHaveBeenCalledWith('FILE');
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(layout, null, 2) + '\n');
  });

  it('reports inspect failures and exits with code 1', async () => {
    jest.mocked(inspect).mockReturnValue({
      success: false,
      error: { code: 'XDP_1001', message: 'bad template' },
    });
    expect(() => root.children[2].actions[0]({ xdp: 'template.xdp', output: 'json' })).toThrow(
      ProcessExit
    );
    expect(stderrSpy).toHaveBeenCalledWith('Inspect failed: bad template\n');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
