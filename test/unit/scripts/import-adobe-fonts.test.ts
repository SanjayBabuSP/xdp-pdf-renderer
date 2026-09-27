import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'import-adobe-fonts.mjs');
const DEJA_VU = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const DEJA_VU_BOLD = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('import-adobe-fonts script', () => {
  let source: string;
  let dest: string;

  beforeEach(() => {
    source = tempDir('xdp-fonts-src-');
    dest = tempDir('xdp-fonts-dest-');
    fs.copyFileSync(DEJA_VU, path.join(source, 'TestFace-Regular.otf'));
    fs.copyFileSync(DEJA_VU_BOLD, path.join(source, 'TestFace-Bold.otf'));
  });

  afterEach(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('copies fonts and writes a loadable manifest', () => {
    const output = run([source, `--dest=${dest}`]);
    expect(output).toContain('Imported 2 fonts');

    expect(fs.existsSync(path.join(dest, 'TestFace-Regular.otf'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'TestFace-Bold.otf'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
    expect(manifest.count).toBe(2);
    const faces = manifest.fonts['dejavu sans'];
    expect(faces).toHaveLength(2);
    expect(faces.map((f: { weight: string }) => f.weight).sort()).toEqual(['bold', 'normal']);
    expect(manifest.fonts['testface-bold']).toBeDefined();
  });

  it('is idempotent — re-running skips unchanged files', () => {
    run([source, `--dest=${dest}`]);
    const output = run([source, `--dest=${dest}`]);
    expect(output).toContain('2 up to date');
  });

  it('dry-run writes nothing', () => {
    const output = run([source, `--dest=${dest}`, '--dry-run']);
    expect(output).toContain('Would import 2 fonts');
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(false);
    expect(fs.readdirSync(dest)).toHaveLength(0);
  });

  it('fails when the source directory does not exist', () => {
    expect(() => run([path.join(source, 'missing'), `--dest=${dest}`])).toThrow();
  });
});
