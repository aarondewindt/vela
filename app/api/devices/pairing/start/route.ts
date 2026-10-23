import { z } from 'zod';
import { boundedJson, deviceResponse } from '@/lib/devices/http';
import { startPairing } from '@/lib/devices/service';
const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    clientType: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  })
  .strict();
export async function POST(request: Request) {
  return deviceResponse(async () => startPairing(schema.parse(await boundedJson(request))));
}
