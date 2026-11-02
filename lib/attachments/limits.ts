/** Client-safe advisory limits; the attachment service validates the actual bytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const imageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
