/** @jest-environment node */
jest.mock('server-only', () => ({}));
import sharp from 'sharp';
import { prepareModelImage } from './model-image';

it.each(['jpeg', 'png', 'webp'] as const)(
  'leaves upright %s originals byte-for-byte unchanged',
  async (format) => {
    const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } })
      .toFormat(format)
      .toBuffer();
    const result = await prepareModelImage(bytes, `image/${format}`);
    expect(result.bytes).toBe(bytes);
    expect(result.mediaType).toBe(`image/${format}`);
  }
);

it('physically rotates EXIF-tagged phone JPEGs without changing stored originals', async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const original = Buffer.from(bytes);
  const result = await prepareModelImage(bytes, 'image/jpeg');
  expect(await sharp(result.bytes).metadata()).toMatchObject({
    format: 'jpeg',
    width: 4,
    height: 8,
  });
  expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined();
  expect(bytes).toEqual(original);
  expect((await sharp(bytes).metadata()).orientation).toBe(6);
});

it('handles mirrored orientation and returns the actual derivative MIME type', async () => {
  const pixels = Buffer.from([255, 0, 0, 0, 0, 255]);
  const bytes = await sharp(pixels, { raw: { width: 2, height: 1, channels: 3 } })
    .png()
    .withMetadata({ orientation: 2 })
    .toBuffer();
  const result = await prepareModelImage(bytes, 'image/png');
  expect(result.mediaType).toBe('image/png');
  const raw = await sharp(result.bytes).removeAlpha().raw().toBuffer();
  expect(raw).toEqual(Buffer.from([0, 0, 255, 255, 0, 0]));
});

it('fails closed on corrupt input instead of passing undecodable image bytes to the model', async () => {
  await expect(prepareModelImage(Buffer.from('invalid'), 'image/jpeg')).rejects.toThrow();
});
