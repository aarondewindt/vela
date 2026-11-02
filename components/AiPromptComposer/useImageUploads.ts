'use client';

import { createClientId } from '@/lib/client-id';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { MAX_IMAGE_BYTES, imageMimeTypes } from '@/lib/attachments/limits';
import { maxMessageImages } from '@/lib/ai-dev/schema';

export type ImageUpload = {
  key: string;
  file: File;
  preview: string;
  progress: number;
  attachmentId?: string;
  error?: string;
  request?: XMLHttpRequest;
};

/** Draft files and blob URLs stay local to the composer; only UUIDs leave on submission. */
export function useImageUploads() {
  const items = useRef<ImageUpload[]>([]);
  const [images, setImages] = useState<ImageUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const publish = () => setImages([...items.current]);
  useEffect(
    () => () => {
      for (const image of items.current) {
        image.request?.abort();
        URL.revokeObjectURL(image.preview);
      }
      items.current = [];
    },
    []
  );

  function upload(image: ImageUpload) {
    const request = new XMLHttpRequest();
    image.request = request;
    image.error = undefined;
    image.progress = 0;
    request.open('POST', '/api/attachments');
    request.setRequestHeader('Content-Type', image.file.type);
    request.setRequestHeader('X-Filename', encodeURIComponent(image.file.name));
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        image.progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
        publish();
      }
    };
    const fail = (message: string) => {
      image.request = undefined;
      image.error = message;
      publish();
    };
    request.onerror = () => fail('Upload failed. Check your connection and retry.');
    request.ontimeout = () => fail('Upload timed out. Please retry.');
    request.onload = () => {
      let body;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        fail('Upload failed. Please retry.');
        return;
      }
      if (request.status !== 201 || !z.uuid().safeParse(body?.id).success) {
        fail(typeof body?.error === 'string' ? body.error : 'Upload failed. Please retry.');
        return;
      }
      image.attachmentId = body.id;
      image.progress = 100;
      image.request = undefined;
      publish();
    };
    request.send(image.file);
    publish();
  }

  function add(files: File[]) {
    setError(null);
    for (const file of files) {
      if (!(imageMimeTypes as readonly string[]).includes(file.type)) {
        setError('Use JPEG, PNG or WebP images. HEIC and other formats are not supported.');
        continue;
      }
      if (!file.size || file.size > MAX_IMAGE_BYTES) {
        setError('Each image must be 1 byte to 10 MiB.');
        continue;
      }
      if (items.current.length >= maxMessageImages) {
        setError(`Attach up to ${maxMessageImages} images per message.`);
        break;
      }
      const image: ImageUpload = {
        key: createClientId(),
        file,
        preview: URL.createObjectURL(file),
        progress: 0,
      };
      items.current.push(image);
      upload(image);
    }
  }
  function remove(key: string) {
    const image = items.current.find((item) => item.key === key);
    if (image) {
      image.request?.abort();
      URL.revokeObjectURL(image.preview);
      items.current = items.current.filter((item) => item !== image);
      publish();
    }
  }
  function clear() {
    items.current.forEach((image) => {
      image.request?.abort();
      URL.revokeObjectURL(image.preview);
    });
    items.current = [];
    setError(null);
    publish();
  }
  // Removed/abandoned uploads use the storage service's existing seven-day pruning.
  // Do not DELETE here: a submitted message may already have retained an image.
  return { images, error, setError, add, remove, retry: upload, clear };
}
