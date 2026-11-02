import { z } from 'zod';
import { createClientId } from './client-id';

it('uses the native UUID implementation where available', () => {
  const uuid = '00000000-0000-4000-8000-000000000001';
  const native = jest.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
  try {
    expect(createClientId()).toBe(uuid);
    expect(native).toHaveBeenCalledTimes(1);
  } finally {
    native.mockRestore();
  }
});

it('generates distinct RFC 4122 version 4 UUIDs without randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 100 }, createClientId);
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) {
      expect(z.uuid().safeParse(id).success).toBe(true);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  } finally {
    if (descriptor) {
      Object.defineProperty(crypto, 'randomUUID', descriptor);
    } else {
      Reflect.deleteProperty(crypto, 'randomUUID');
    }
  }
});
