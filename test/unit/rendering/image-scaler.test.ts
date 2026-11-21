import { computeImageRect, ImageDimensions } from '../../../src/rendering/image-scaler';

const SQUARE: ImageDimensions = { pixelW: 100, pixelH: 50 };

describe('computeImageRect degenerate inputs', () => {
  it('fills the effective box when the image has no pixels', () => {
    expect(computeImageRect('fit', 200, 120, { pixelW: 0, pixelH: 10 })).toEqual({
      drawW: 200,
      drawH: 120,
      offsetX: 0,
      offsetY: 0,
    });
    expect(computeImageRect('fit', 200, 120, { pixelW: 10, pixelH: 0 })).toEqual({
      drawW: 200,
      drawH: 120,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('uses swapped dimensions in rotated mode', () => {
    expect(computeImageRect('fit', 300, 100, { pixelW: 0, pixelH: 1 }, {}, true)).toEqual({
      drawW: 100,
      drawH: 300,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('returns a zero-size box when the target has no extent', () => {
    expect(computeImageRect('fit', 0, 100, SQUARE)).toEqual({
      drawW: 0,
      drawH: 100,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

describe('computeImageRect sizing modes', () => {
  it('stretches to the box in none mode', () => {
    expect(
      computeImageRect('none', 200, 120, SQUARE, { hAlign: 'right', vAlign: 'middle' })
    ).toEqual({
      drawW: 200,
      drawH: 120,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('uses pixel dimensions and DPI in actual mode', () => {
    const image: ImageDimensions = { pixelW: 100, pixelH: 50, xdpi: 100, ydpi: 50 };
    const rect = computeImageRect('actual', 200, 200, image, {
      hAlign: 'center',
      vAlign: 'middle',
    });
    expect(rect.drawW).toBeCloseTo(72, 10);
    expect(rect.drawH).toBeCloseTo(72, 10);
    expect(rect.offsetX).toBeCloseTo(64, 10);
    expect(rect.offsetY).toBeCloseTo(64, 10);
  });

  it('defaults both DPIs to 96 when only the pixel size is known', () => {
    const rect = computeImageRect('actual', 200, 200, SQUARE);
    expect(rect.drawW).toBeCloseTo((100 * 72) / 96, 10);
    expect(rect.drawH).toBeCloseTo((50 * 72) / 96, 10);
  });

  it('derives height from aspect ratio in width mode', () => {
    expect(computeImageRect('width', 200, 500, SQUARE)).toEqual({
      drawW: 200,
      drawH: 100,
      offsetX: 0,
      offsetY: 400,
    });
  });

  it('derives width from aspect ratio in height mode', () => {
    expect(computeImageRect('height', 500, 200, SQUARE)).toEqual({
      drawW: 400,
      drawH: 200,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('preserves aspect ratio and honours alignment in fit mode', () => {
    expect(
      computeImageRect('fit', 200, 200, SQUARE, { hAlign: 'center', vAlign: 'middle' })
    ).toEqual({
      drawW: 200,
      drawH: 100,
      offsetX: 0,
      offsetY: 50,
    });
    expect(computeImageRect('fit', 200, 200, SQUARE, { vAlign: 'bottom' })).toEqual({
      drawW: 200,
      drawH: 100,
      offsetX: 0,
      offsetY: 0,
    });
    expect(computeImageRect('fit', 200, 200, SQUARE)).toEqual({
      drawW: 200,
      drawH: 100,
      offsetX: 0,
      offsetY: 100,
    });
  });

  it('treats any unrecognised mode as fit', () => {
    expect(computeImageRect('unknown-mode', 200, 200, SQUARE)).toEqual({
      drawW: 200,
      drawH: 100,
      offsetX: 0,
      offsetY: 100,
    });
  });

  it('applies fit against the rotated box', () => {
    expect(computeImageRect('fit', 300, 100, SQUARE, {}, true)).toEqual({
      drawW: 100,
      drawH: 50,
      offsetX: 0,
      offsetY: 250,
    });
  });

  it('clamps spare space to zero when the image overflows the box', () => {
    expect(
      computeImageRect('height', 50, 200, SQUARE, { hAlign: 'right', vAlign: 'middle' })
    ).toEqual({
      drawW: 400,
      drawH: 200,
      offsetX: 0,
      offsetY: 0,
    });
  });
});
