import { accessAttachment } from '@/lib/attachments/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return accessAttachment(request, (await context.params).id);
}

export async function DELETE(request: Request, context: Context) {
  return accessAttachment(request, (await context.params).id, true);
}
