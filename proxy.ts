import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (process.env.VELA_PUBLIC_MODE !== 'true') {
    return NextResponse.next();
  }

  const origin = new URL(process.env.BETTER_AUTH_URL!);
  // cloudflared must preserve the public Host. Do not trust X-Forwarded-Host.
  if (request.headers.get('host') !== origin.host) {
    return new NextResponse('Unexpected host', { status: 421 });
  }
  const path = request.nextUrl.pathname;
  if (
    path.startsWith('/__nextjs') ||
    path.startsWith('/_next/webpack-hmr') ||
    path.endsWith('.map') ||
    path === '/dev-tools' ||
    path.startsWith('/dev-tools/')
  ) {
    return new NextResponse(null, { status: 404 });
  }
  if (
    path.startsWith('/api/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    (request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.has('origin') && request.headers.get('origin') !== origin.origin))
  ) {
    return new NextResponse('Requests must come from this site.', { status: 403 });
  }
  const response = NextResponse.next();
  if (!path.startsWith('/_next/static/')) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}
