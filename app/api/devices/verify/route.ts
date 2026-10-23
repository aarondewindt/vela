import { deviceResponse } from '@/lib/devices/http';
import { requireDevice } from '@/lib/devices/service';
export async function GET(request: Request) {
  return deviceResponse(() => requireDevice(request.headers, ['health:write']));
}
