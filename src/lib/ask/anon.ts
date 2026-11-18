import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { isProduction } from '../env.ts';

// Questions without a login. A visitor is a browser: a random token in a cookie, turned into
// an id for the Taipei day by an HMAC, so one day's questions can't be tied to another's and
// nothing about the visitor is in it. That id stands where a Google account id would in
// ask_usage and ask_log (`anon:` + 16 hex). Their address only caps how many questions one
// network asks a day (a visitor clearing the cookie gets a new token), under its own HMAC
// (`anonip:` + 16 hex), in ask_usage alone: never in ask_log, and stripped from backups.
// Not the address as the visitor: Taiwan's mobile networks put many people behind one IPv4,
// who would share two questions and each other's answers.
export const ANON_PREFIX = 'anon:';
export const ADDRESS_PREFIX = 'anonip:';
export const ANON_COOKIE = 'gooaye_anon';

// The ids from `prefix` up to (not including) the prefix with its last character's successor,
// so an index on the id applies. `anon:`…`anon;` leaves out `anonip:` ('i' sorts after ';').
const range = (prefix: string): [string, string] => [prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)];
const [anonFrom, anonTo] = range(ANON_PREFIX);
const [addressFrom, addressTo] = range(ADDRESS_PREFIX);
// For SQL: the prefixes are constants, never input
export const ANON_SQL = (col = 'user_id') => `(${col} >= '${anonFrom}' AND ${col} < '${anonTo}')`;
export const ADDRESS_SQL = (col = 'user_id') => `(${col} >= '${addressFrom}' AND ${col} < '${addressTo}')`;

export function isAnon(userId: string): boolean {
  return userId.startsWith(ANON_PREFIX);
}

// What identifies a network: the address, or for IPv6 its /64, since one connection is handed
// a whole /64 and could otherwise ask again from each address in it
export function addressKey(ip: string): string | null {
  const v = isIP(ip);
  if (v === 4) return ip;
  if (v !== 6) return null;
  // An IPv4-mapped address is the IPv4 one
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

// The visitor's address. Live, every request comes through Cloudflare, which sets
// CF-Connecting-IP (overwriting one a client sent), and only Cloudflare can reach the
// server (the Vultr firewall), so the header can be trusted there and nothing else can.
// Locally there is no Cloudflare: every request is from one address.
export function clientAddress(headers: Pick<Headers, 'get'>): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return addressKey(cf);
  return isProduction() ? null : '127.0.0.1';
}

// The visitor's token from their cookie, if it is one this site would have made
const TOKEN = /^[0-9a-f]{32}$/;
export function anonToken(cookie: string | undefined): string | null {
  return cookie && TOKEN.test(cookie) ? cookie : null;
}

// The cookie's value in a request's headers (route handlers read them as headers, so tests can too)
export function cookieValue(headers: Pick<Headers, 'get'>, name = ANON_COOKIE): string | undefined {
  for (const part of headers.get('cookie')?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export function newAnonToken(): string {
  return randomBytes(16).toString('hex');
}

// Kept a year: it holds nothing but the token, and the ids made from it change every day
export function anonCookie(token: string): string {
  return `${ANON_COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${isProduction() ? '; Secure' : ''}`;
}

// The key the ids are made with: derived from NEXTAUTH_SECRET (the web has it already, and
// can't sign anyone in without it), under its own label so the two uses never share a key.
// Derived once per secret.
let derived: { from: string; key: string } | undefined;
function key(): string | null {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  if (derived?.from !== secret) derived = { from: secret, key: createHmac('sha256', secret).update('gooaye anon ask id').digest('hex') };
  return derived.key;
}

const id = (prefix: string, day: string, what: string, secret: string) =>
  prefix + createHmac('sha256', secret).update(`${prefix}${day}\n${what}`).digest('hex').slice(0, 16);

// Whether someone signed out can ask: there is an address to cap their network by and a key
// (a browser without the cookie yet gets one with its first question)
export function anonAllowed(address: string | null): boolean {
  return !!address && !!key();
}

// Who is asking without a login on a Taipei day: their browser's id and their network's key,
// or null when there is no token, address or secret to make them from (then they sign in)
export type Visitor = { id: string; address: string };
export function anonVisitor(token: string | null, address: string | null, day: string, secret = key()): Visitor | null {
  if (!token || !address || !secret) return null;
  return { id: id(ANON_PREFIX, day, token, secret), address: id(ADDRESS_PREFIX, day, address, secret) };
}
