import { boundedJson, deviceResponse } from '@/lib/devices/http';
import { requireDevice } from '@/lib/devices/service';
import { saveDiagnostics } from '@/lib/companion/service';
export async function POST(request: Request) {
  return deviceResponse(async () => {
    const device = await requireDevice(request.headers, ['health:write']);
    return saveDiagnostics(device.userId, device.credentialId, await boundedJson(request, 262144));
  });
}
