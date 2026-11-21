type DataCallback = (data: Uint8Array) => void;

interface FakeStream {
  on(event: 'data' | 'end', callback: DataCallback): FakeStream;
}

interface FakeSubset {
  cff?: { offSize: number };
  encodeStream(): FakeStream;
}

interface FakeFont {
  createSubset(): FakeSubset;
}

interface PatchModule {
  createPatchedFontkit: () => {
    create: (buffer: Uint8Array, postscriptName?: string) => unknown;
  };
}

function streamWith(bytes: Uint8Array): FakeStream {
  const stream: FakeStream = {
    on(event, callback) {
      if (event === 'data') callback(bytes);
      return stream;
    },
  };
  return stream;
}

function loadPatchedCreate(font: FakeFont): (buffer: Uint8Array, name?: string) => FakeFont {
  let patchedCreate: ((buffer: Uint8Array, name?: string) => FakeFont) | undefined;
  jest.isolateModules(() => {
    jest.doMock('@pdf-lib/fontkit', () => ({
      __esModule: true,
      default: { create: () => font },
    }));
    const mod = require('../../../src/rendering/cff-subset-patch') as PatchModule;
    const create = mod.createPatchedFontkit().create;
    patchedCreate = (buffer, name) => create(buffer, name) as FakeFont;
  });
  if (!patchedCreate) throw new Error('createPatchedFontkit was not loaded');
  return patchedCreate;
}

function firstChunk(stream: FakeStream): Uint8Array {
  const chunks: Uint8Array[] = [];
  stream.on('data', (data) => chunks.push(data));
  return chunks[0];
}

describe('createPatchedFontkit', () => {
  it('repairs the malformed CFF header emitted for CFF subsets', () => {
    const subset: FakeSubset = {
      cff: { offSize: 3 },
      encodeStream: () => streamWith(Uint8Array.from([1, 0, 4, 21, 9])),
    };
    const patched = loadPatchedCreate({ createSubset: () => subset })(new Uint8Array());

    const bytes = firstChunk(patched.createSubset().encodeStream());
    expect(Array.from(bytes.slice(0, 4))).toEqual([1, 0, 4, 3]);
  });

  it('leaves subsets without CFF data unchanged', () => {
    const subset: FakeSubset = {
      encodeStream: () => streamWith(Uint8Array.from([1, 0, 4, 21, 9])),
    };
    const patched = loadPatchedCreate({ createSubset: () => subset })(new Uint8Array());

    const bytes = firstChunk(patched.createSubset().encodeStream());
    expect(Array.from(bytes.slice(0, 4))).toEqual([1, 0, 4, 21]);
  });
});
