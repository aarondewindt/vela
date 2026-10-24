import { deviceResponse } from '@/lib/devices/http';
import { auditedIngestion } from '@/lib/companion/audit';
export async function POST(request: Request) {
  return deviceResponse(() => auditedIngestion(request));
}
