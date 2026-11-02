import 'server-only';

import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from './limits';

/** Honor camera orientation for model decoders that ignore EXIF. Stored originals stay intact. */
export async function prepareModelImage(bytes: Buffer, mediaType: string) {
  const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' });
  const { orientation } = await image.metadata();
  if (!orientation || orientation === 1) {
    return { bytes, mediaType };
  }
  // Lossless PNG for other formats; high-quality JPEG avoids large camera-photo payloads.
  const oriented = image.autoOrient();
  return mediaType === 'image/jpeg'
    ? {
        bytes: await oriented.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer(),
        mediaType,
      }
    : { bytes: await oriented.png().toBuffer(), mediaType: 'image/png' };
}
