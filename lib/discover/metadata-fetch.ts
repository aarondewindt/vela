import 'server-only';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { addAbortSignal } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { TRPCError } from '@trpc/server';
import { webUrlSchema } from './schema';
import { extractMetadata } from './metadata';

export const metadataLimits = { bytes: 1024 * 1024, redirects: 3, timeoutMs: 8000 };
export function isPublicAddress(address: string) {
  if (!ipaddr.isValid(address)) {
    return false;
  }
  const ip = ipaddr.parse(address);
  if (ip.range() !== 'unicast') {
    return false;
  }
  // IPv6 is restricted to global unicast; transition/mapped ranges are excluded by range().
  if (ip.kind() === 'ipv6') {
    return ip.match(ipaddr.parseCIDR('2000::/3'));
  }
  return true;
}
export function fetchableUrl(value: string) {
  const parsed = webUrlSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid URL');
  }
  const url = new URL(parsed.data);
  if (url.port) {
    throw new Error('Only standard web ports are supported');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host.endsWith('.') || (!host.includes('.') && !isIP(host))) {
    throw new Error('Invalid public hostname');
  }
  if (isIP(host) && !isPublicAddress(host)) {
    throw new Error('Private address');
  }
  url.hash = '';
  return url;
}

async function readPage(
  url: URL,
  signal: AbortSignal
): Promise<{ location?: string; html?: string }> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Private address');
  }
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        signal,
        agent: false,
        maxHeaderSize: 16384,
        // Pin the validated IP while retaining the original Host header and TLS identity.
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [pinned]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
        headers: {
          Accept: 'text/html, application/xhtml+xml',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Vela-Metadata/1.0',
        },
      },
      (response) => {
        addAbortSignal(signal, response);
        response.on('error', reject);
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (location) {
            resolve({ location });
          } else {
            reject(new Error('Missing redirect target'));
          }
          return;
        }
        const type = response.headers['content-type'] || '';
        if (
          status < 200 ||
          status >= 300 ||
          !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(type) ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity') ||
          Number(response.headers['content-length']) > metadataLimits.bytes
        ) {
          response.destroy();
          reject(new Error('Unsupported page or response'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > metadataLimits.bytes) {
            response.destroy(new Error('Page is too large'));
          } else {
            chunks.push(chunk);
          }
        });
        response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    request.on('error', reject);
    request.end();
  });
}

export async function fetchPageMetadata(sourceUrl: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Metadata request timed out'));
      }, metadataLimits.timeoutMs);
    });
    const work = async () => {
      let url = fetchableUrl(sourceUrl);
      for (let redirects = 0; redirects <= metadataLimits.redirects; redirects++) {
        const page = await readPage(url, controller.signal);
        if (page.html !== undefined) {
          return extractMetadata(page.html, sourceUrl, url.href);
        }
        if (redirects === metadataLimits.redirects) {
          throw new Error('Too many redirects');
        }
        url = fetchableUrl(new URL(page.location!, url).href);
      }
      throw new Error('No page');
    };
    return await Promise.race([work(), deadline]);
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Could not retrieve page metadata. The URL may be unavailable, unsupported or blocked. You can retry or keep editing manually.',
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
