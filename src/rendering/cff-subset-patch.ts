import fontkit from '@pdf-lib/fontkit';
import type { Font, Subset, SubsetStream } from '@pdf-lib/fontkit';
import type { PDFDocument } from 'pdf-lib';

type CffSubset = Subset & { cff?: { offSize?: number } };
type FontkitRegistration = Parameters<PDFDocument['registerFontkit']>[0];

function patchCffSubset(subset: CffSubset, offSize: number): Subset {
  const encodeStream = subset.encodeStream.bind(subset);
  subset.encodeStream = (): SubsetStream => {
    const stream = encodeStream();
    let patched = false;
    stream.on('data', (data: Uint8Array): void => {
      if (patched || data.length < 4) return;
      if (data[0] === 1 && data[1] === 0 && data[2] === 4) {
        data[3] = offSize;
      }
      patched = true;
    });
    return stream;
  };
  return subset;
}

export function createPatchedFontkit(): FontkitRegistration {
  const create = fontkit.create.bind(fontkit);
  const wrapper: Pick<FontkitRegistration, 'create'> = {
    create(buffer: Uint8Array, postscriptName?: string): Font {
      const font = create(buffer, postscriptName);
      const createSubset = font.createSubset.bind(font);
      font.createSubset = (): Subset => {
        const subset = createSubset() as CffSubset;
        const offSize = subset.cff?.offSize;
        return typeof offSize === 'number' ? patchCffSubset(subset, offSize) : subset;
      };
      return font;
    },
  };
  return wrapper as FontkitRegistration;
}
