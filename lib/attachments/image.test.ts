/** @jest-environment node */
jest.mock('server-only', () => ({}));

import sharp from 'sharp';
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, validateImage } from './image';

it.each(['jpeg', 'png', 'webp'] as const)('decodes valid %s images', async (format) => {
  const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'red' } })
    .toFormat(format)
    .toBuffer();
  await expect(validateImage(bytes, `image/${format}`)).resolves.toEqual({
    mimeType: `image/${format}`,
    width: 4,
    height: 3,
  });
});

it('rejects forged MIME types, SVG, corrupt data and truncated image bodies', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  for (const [bytes, mime] of [
    [png, 'image/jpeg'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), 'image/png'],
    [Buffer.from('not an image'), 'image/png'],
    [png.subarray(0, png.length - 30), 'image/png'],
  ] as const) {
    await expect(validateImage(bytes, mime)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
});

it('bounds byte size and decompressed dimensions', async () => {
  await expect(validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png')).rejects.toMatchObject(
    { code: 'PAYLOAD_TOO_LARGE' }
  );
  await expect(validateImage(Buffer.alloc(0), 'image/png')).rejects.toMatchObject({
    code: 'PAYLOAD_TOO_LARGE',
  });
  const side = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
  const png = await sharp({ create: { width: side, height: side, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  // A valid compressed image exceeds the decompressed pixel limit.
  expect(png.length).toBeLessThan(MAX_IMAGE_BYTES);
  await expect(validateImage(png, 'image/png')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});
