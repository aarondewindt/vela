import { boundedJson, deviceResponse } from '@/lib/devices/http';
import { requireDevice } from '@/lib/devices/service';
import { ingestHealth } from '@/lib/health/ingestion';
export async function POST(request: Request) {
  return deviceResponse(async () => {
    const device = await requireDevice(request.headers, ['health:write']);
    return ingestHealth(device.userId, device.credentialId, await boundedJson(request, 65536));
  });
}
