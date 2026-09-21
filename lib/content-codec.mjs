// Zero-dep copy of the server's workspace content codec. Kept in
// lockstep by hand — the same accepted pattern as operator-proxy.mjs's IDEMPOTENT_TOOL_NAMES
// mirror (see its own module doc): this zero-dep plugin script cannot import backend TS
// directly, and the SERVER is still the actual trust boundary (workspace_commit re-validates
// every byte), so drift here degrades to a locally-wrong preview, never a security gap.

/** The read-side content codec. UTF-8 is only safe when decoding is lossless, canonical, and
 * cannot smuggle binary content through a NUL byte. */
export function encodeContent(bytes) {
  if (bytes.includes(0)) return { encoding: 'base64', content: Buffer.from(bytes).toString('base64') };
  try {
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const reencoded = new TextEncoder().encode(content);
    if (Buffer.from(reencoded).equals(Buffer.from(bytes))) return { encoding: 'utf8', content };
  } catch {
    // Invalid UTF-8 is binary content. The returned base64 is lossless.
  }
  return { encoding: 'base64', content: Buffer.from(bytes).toString('base64') };
}

// Strict RFC 4648 base64 alphabet with correct padding shape. Node's `Buffer.from(str,
// 'base64')` is LENIENT — it silently ignores invalid characters — so this regex plus the
// re-encoding check below are what actually enforce canonicity (spec §5.4).
const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class NonCanonicalContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonCanonicalContentError';
  }
}

function isCanonicalBase64(value) {
  if (!CANONICAL_BASE64_RE.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

/** The write-side content codec, the exact inverse of `encodeContent`. */
export function decodeContent(input) {
  if (input.encoding === 'utf8') return Buffer.from(input.content, 'utf8');
  if (!isCanonicalBase64(input.content)) {
    throw new NonCanonicalContentError('content is not canonical base64');
  }
  return Buffer.from(input.content, 'base64');
}
