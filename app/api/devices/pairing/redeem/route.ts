import { z } from 'zod';
import { boundedJson, deviceResponse } from '@/lib/devices/http';
import { redeemPairing } from '@/lib/devices/service';
const schema = z.object({ sessionSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export async function POST(request: Request) {
  return deviceResponse(async () =>
    redeemPairing(schema.parse(await boundedJson(request)).sessionSecret)
  );
}
