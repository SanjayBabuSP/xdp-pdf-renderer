import * as fs from 'fs';
import { loadManifest, lookupVariants } from '../../src/rendering/font-registry';

/**
 * Whether the proprietary Adobe faces for `families` were imported into
 * `assets/fonts/adobe/` (via `npm run fonts:import`). That directory is
 * gitignored — the faces ship with LiveCycle Designer and cannot be
 * committed — so it exists on a developer machine but never in CI.
 */
export function hasImportedFaces(families: string[]): boolean {
  const manifest = loadManifest();
  if (!manifest) return false;
  return families.every((family) => {
    const variants = lookupVariants(manifest, family);
    return !!variants?.some((v) => fs.existsSync(v.file));
  });
}

/**
 * `it` when the imported Adobe faces for `families` are available, `it.skip`
 * otherwise — so asset-dependent tests skip (not fail) in clean checkouts.
 *
 * Usage: `itWithImportedFaces(['Myriad Pro'])('...', async () => { ... })`
 */
export function itWithImportedFaces(families: string[]): typeof it {
  return hasImportedFaces(families) ? it : it.skip;
}
