// Edge runtime friendly SHA-1 implementation.
// We avoid node:crypto because Next.js middleware runs in Edge runtime where Node builtins are unavailable.
// The implementation follows RFC 3174 and is regression-tested against Node's SHA-1 output via bucket parity.

export type FlagName = `feature.${string}`;

let flags: Map<FlagName, number> | null = null;

export function isFeatureEnabled(flag: FlagName, identity: { openid?: string; ip?: string }): boolean {
  const percent = getFlags().get(flag);
  if (percent == null) return false;
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const subject = identity.openid || identity.ip;
  if (!subject) return false;
  return bucket(`${subject}:${flag}`) < percent;
}

export function flagSnapshot(): Record<FlagName, number> {
  return Object.fromEntries(getFlags()) as Record<FlagName, number>;
}

export function storyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.STORY_ENABLED;
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function __resetFlagsForTests(): void {
  flags = null;
}

function getFlags() {
  flags ??= loadFlags(process.env);
  return flags;
}

function loadFlags(env: NodeJS.ProcessEnv) {
  const loaded = new Map<FlagName, number>();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('FEATURE_FLAG_')) continue;
    const percent = parsePercent(value);
    if (percent == null) continue;
    loaded.set(envKeyToFlagName(key), percent);
  }
  return loaded;
}

function parsePercent(value: string | undefined) {
  if (value == null || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

function envKeyToFlagName(key: string): FlagName {
  return `feature.${key.replace(/^FEATURE_FLAG_/, '').toLowerCase()}`;
}

function bucket(input: string) {
  return sha1FirstWord(input) % 100;
}

function sha1FirstWord(input: string) {
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i -= 1) bytes.push((bitLen / 2 ** (i * 8)) & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Array<number>(80).fill(0);
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return h0 >>> 0;
}

function rotl(n: number, bits: number) {
  return ((n << bits) | (n >>> (32 - bits))) >>> 0;
}
