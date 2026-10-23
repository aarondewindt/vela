/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:http', () => ({ request: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchPageMetadata, fetchableUrl, isPublicAddress, metadataLimits } from './metadata-fetch';
const dns = lookup as jest.Mock;
const https = httpsRequest as jest.Mock;
function response(
  status: number,
  headers: Record<string, string>,
  body = '<title>Example</title>'
) {
  https.mockImplementationOnce((_url, options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const stream = Object.assign(new PassThrough(), { statusCode: status, headers });
      callback(stream);
      if (!stream.destroyed) {
        stream.end(body);
      }
    };
    options.lookup('example.com', { all: true }, (_error: unknown, entries: unknown) => {
      expect(entries).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
    return request;
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
it.each([
  '127.0.0.1',
  '0.0.0.0',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.0.1',
  '169.254.169.254',
  '100.64.0.1',
  '198.18.0.1',
  '224.0.0.1',
  '240.0.0.1',
  '192.0.2.1',
  '::1',
  '::',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '2002:7f00:1::',
  '2001:db8::1',
])('blocks nonpublic IP %s', (ip) => {
  expect(isPublicAddress(ip)).toBe(false);
});
it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('permits public IP %s', (ip) =>
  expect(isPublicAddress(ip)).toBe(true)
);
it.each([
  'file:///etc/passwd',
  'http://localhost',
  'http://127.1',
  'http://2130706433',
  'http://0x7f000001',
  'https://[::1]',
  'https://example.com:8443',
  'https://user:pass@example.com',
  'bad',
])('rejects untrusted URL %s before network requests', async (url) => {
  expect(() => fetchableUrl(url)).toThrow();
  await expect(fetchPageMetadata(url)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(https).not.toHaveBeenCalled();
  expect(httpRequest).not.toHaveBeenCalled();
});
it('pins validated DNS and checks each redirect while retaining original provenance', async () => {
  response(302, { location: '/next' });
  response(200, { 'content-type': 'text/html; charset=utf-8' });
  expect(await fetchPageMetadata('https://example.com/start')).toMatchObject({
    sourceUrl: 'https://example.com/start',
    resolvedUrl: 'https://example.com/next',
    title: 'Example',
  });
  expect(dns).toHaveBeenCalledTimes(2);
  expect(https.mock.calls[0][1]).toMatchObject({
    agent: false,
    maxHeaderSize: 16384,
    signal: expect.any(AbortSignal),
  });
});
it('blocks mixed DNS, private redirect targets and DNS failures', async () => {
  dns.mockResolvedValueOnce([
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  await expect(fetchPageMetadata('https://example.com')).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(https).not.toHaveBeenCalled();
  response(302, { location: 'http://169.254.169.254/latest' });
  await expect(fetchPageMetadata('https://example.com')).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(httpRequest).not.toHaveBeenCalled();
  dns.mockRejectedValueOnce(new Error('ENOTFOUND'));
  await expect(fetchPageMetadata('https://unreachable.example')).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
it.each([
  [404, { 'content-type': 'text/html' }, ''],
  [200, { 'content-type': 'application/pdf' }, ''],
  [200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }, ''],
  [200, { 'content-type': 'text/html', 'content-length': '2000000' }, ''],
  [200, { 'content-type': 'text/html' }, 'x'.repeat(metadataLimits.bytes + 1)],
] as const)('rejects unsupported/oversized responses (%s)', async (status, headers, body) => {
  response(status, headers, body);
  await expect(fetchPageMetadata('https://example.com')).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
it('bounds redirect loops', async () => {
  for (let i = 0; i < 4; i++) {
    response(302, { location: '/again' });
  }
  await expect(fetchPageMetadata('https://example.com')).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(https).toHaveBeenCalledTimes(4);
});
it('bounds even a stalled DNS lookup with the total deadline', async () => {
  jest.useFakeTimers();
  try {
    dns.mockReturnValue(new Promise(() => {}));
    const pending = fetchPageMetadata('https://example.com').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(metadataLimits.timeoutMs);
    await expect(pending).resolves.toMatchObject({ code: 'BAD_REQUEST' });
    expect(https).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
