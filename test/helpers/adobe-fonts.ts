import * as fs from 'fs';
import { loadManifest, lookupVariants } from '../../src/rendering/font-registry';

export function hasImportedFaces(families: string[]): boolean {
  const manifest = loadManifest();
  if (!manifest) return false;
  return families.every((family) => {
    const variants = lookupVariants(manifest, family);
    return !!variants?.some((v) => fs.existsSync(v.file));
  });
}

export function itWithImportedFaces(families: string[]): typeof it {
  return hasImportedFaces(families) ? it : it.skip;
}
