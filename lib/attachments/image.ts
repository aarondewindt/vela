import 'server-only';

import sharp from 'sharp';
import { TRPCError } from '@trpc/server';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const imageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;

export async function validateImage(bytes: Buffer, mimeType: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Images must be 1 byte to 10 MiB.' });
  }
  try {
    // Limit the decoder surface before invoking libvips (in particular, no SVG/PDF).
    const signature = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'image/jpeg'
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : null;
    if (!signature || signature !== mimeType) {
      throw new Error('Unsupported image.');
    }
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    const actual = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[
      metadata.format as string
    ];
    if (!actual || actual !== mimeType || (metadata.pages ?? 1) !== 1) {
      throw new Error('Unsupported image.');
    }
    // Metadata alone accepts truncated images. Force decoding of all pixels.
    await image.stats();
    return { mimeType: actual, width: metadata.width!, height: metadata.height! };
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Upload a valid, single-frame JPEG, PNG or WebP image of at most 40 megapixels.',
    });
  }
}
