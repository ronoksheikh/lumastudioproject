// Outbound requests to user-supplied model endpoints. The api process holds secrets and can reach the
// internal network, so students must not be able to aim it at private addresses (SSRF): addresses are
// checked at CONNECT time (after DNS), which also defeats DNS rebinding.
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { config } from '../config.js';
import { badRequest } from '../http/errors.js';

const blocklist = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocklist.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fe80::', 10], ['fc00::', 7], ['ff00::', 8], ['64:ff9b::', 96]] as const) blocklist.addSubnet(net6, prefix, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (!family) return true;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    // IPv4-mapped IPv6: judge the embedded v4 address
    const v4 = address.slice(7);
    return net.isIP(v4) === 4 ? blocklist.check(v4, 'ipv4') : true;
  }
  return blocklist.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

const guardedLookup = (hostname: string, options: dns.LookupOptions, cb: LookupCb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '' as never);
    const ok = (addrs as dns.LookupAddress[]).filter((a) => !isBlockedAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EBLOCKED' }), '' as never);
    if (options.all) return cb(null, ok);
    cb(null, ok[0]!.address, ok[0]!.family);
  });
};

const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never }, headersTimeout: 120_000, bodyTimeout: 0 });
const openAgent = new Agent({ headersTimeout: 120_000, bodyTimeout: 0 });

/** Throws a 400 if `raw` is not an acceptable model endpoint URL. */
export function assertProviderUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest('The base URL is not a valid URL');
  }
  if (u.protocol !== 'https:' && !(config.allowPrivateProviderUrls && u.protocol === 'http:')) throw badRequest('The base URL must start with https://');
  if (u.username || u.password) throw badRequest('Do not put credentials in the base URL — use the API key field');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!config.allowPrivateProviderUrls) {
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw badRequest('That address is not reachable from the server (private or local)');
    if (net.isIP(host) && isBlockedAddress(host)) throw badRequest('That address is not reachable from the server (private or local)');
  }
  return u;
}

/** fetch() for the openai client: blocks private destinations unless ALLOW_PRIVATE_PROVIDER_URLS=1. */
export const safeFetch = ((input: unknown, init?: unknown) =>
  undiciFetch(input as never, { ...(init as object), dispatcher: config.allowPrivateProviderUrls ? openAgent : guardedAgent } as never)) as unknown as typeof fetch;

/** fetch() that ALWAYS refuses private destinations (used by the agent's web_fetch, regardless of ALLOW_PRIVATE_PROVIDER_URLS). */
export const guardedFetch = ((input: unknown, init?: unknown) =>
  undiciFetch(input as never, { ...(init as object), dispatcher: guardedAgent } as never)) as unknown as typeof fetch;

/** Literal-IP / localhost check for URLs the agent wants to fetch. */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest('Not a valid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badRequest('Only http(s) URLs can be fetched');
  if (u.username || u.password) throw badRequest('URLs with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (net.isIP(host) && isBlockedAddress(host))) {
    throw badRequest('That address is not reachable (private or local)');
  }
  return u;
}
