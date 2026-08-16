import { detectRestrictedInput } from './minimize';

const sensitiveKey =
  /(?:authorization|cookie|credential|password|secret|token|safe.?word|private.?key|content|message|url|ciphertext|fingerprint|destination|contact)/iu;
const bearerLike = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+/giu;
const privateKeyLike =
  /-----BEGIN [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----/giu;
const urlLike = /\bhttps?:\/\/[^\s<>{}"']+/giu;
const emailLike = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phoneLike = /(?:\+?\d[\s().-]*){7,15}/gu;

export function redactString(value: string): string {
  if (detectRestrictedInput(value).length > 0) return '[REDACTED_RESTRICTED_INPUT]';
  return value
    .replace(privateKeyLike, '[REDACTED_PRIVATE_KEY]')
    .replace(bearerLike, '[REDACTED_CREDENTIAL]')
    .replace(urlLike, '[REDACTED_URL]')
    .replace(emailLike, '[REDACTED_EMAIL]')
    .replace(phoneLike, '[REDACTED_PHONE]');
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = sensitiveKey.test(key) ? '[REDACTED]' : redactValue(nested, seen);
    }
    return result;
  }
  return String(value);
}

export function redactForLog(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}
