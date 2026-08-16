import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type SafeLogValue =
  | null
  | boolean
  | number
  | string
  | readonly SafeLogValue[]
  | { readonly [key: string]: SafeLogValue };

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: Readonly<Record<string, SafeLogValue>>;
}

export type LogSink = (record: LogRecord) => void;

const levelRank: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey =
  /(?:artifact|authorization|cookie|credential|password|secret|token|safe.?word|private.?key|content|message|url|ciphertext|fingerprint|destination|contact|email|phone)/iu;
const credentialInText = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+/giu;
const privateKeyInText =
  /-----BEGIN [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----/giu;
const authorizationInText =
  /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?token|pass(?:word|code))\s*[:=]\s*[A-Za-z0-9._~+/@$!%-]{4,}/giu;
const jwtInText = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const otpInText =
  /\b(?:otp|one[- ]time (?:code|password)|verification code|security code)\D{0,16}\d{4,8}\b/giu;
const cardCandidate = /(?:\d[ -]?){13,19}/gu;
const urlInText = /\bhttps?:\/\/[^\s<>{}"']+/giu;
const emailInText = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phoneInText = /(?:\+?\d[\s().-]*){7,15}/gu;
const eventName = /^[a-z][a-z0-9_.-]{1,79}$/u;

function luhn(value: string): boolean {
  const digits = value.replace(/\D/gu, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const character = digits[index];
    if (character === undefined) return false;
    let digit = Number(character);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function sanitizeString(value: string): string {
  const hasCard = [...value.matchAll(cardCandidate)].some((match) => luhn(match[0]));
  if (hasCard) return '[REDACTED_RESTRICTED_INPUT]';
  return value
    .replace(privateKeyInText, '[REDACTED_PRIVATE_KEY]')
    .replace(credentialInText, '[REDACTED_CREDENTIAL]')
    .replace(authorizationInText, '[REDACTED_CREDENTIAL]')
    .replace(jwtInText, '[REDACTED_CREDENTIAL]')
    .replace(otpInText, '[REDACTED_ONE_TIME_CODE]')
    .replace(urlInText, '[REDACTED_URL]')
    .replace(emailInText, '[REDACTED_EMAIL]')
    .replace(phoneInText, '[REDACTED_PHONE]');
}

function sanitize(value: unknown, seen: WeakSet<object>, depth: number): SafeLogValue {
  if (depth > 8) return '[MAX_DEPTH]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: sanitize(value.message, seen, depth + 1) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen, depth + 1));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const result: Record<string, SafeLogValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = sensitiveKey.test(key) ? '[REDACTED]' : sanitize(nested, seen, depth + 1);
    }
    return result;
  }
  return String(value);
}

export function sanitizeLogFields(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, SafeLogValue>> {
  return sanitize(fields, new WeakSet(), 0) as Readonly<Record<string, SafeLogValue>>;
}

function jsonLineSink(record: LogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export interface Logger {
  readonly debug: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly info: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly error: (event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly child: (fields: Readonly<Record<string, unknown>>) => Logger;
}

export function createLogger(
  options: {
    readonly level?: LogLevel;
    readonly sink?: LogSink;
    readonly base?: Readonly<Record<string, unknown>>;
    readonly clock?: () => Date;
  } = {},
): Logger {
  const minimumLevel = options.level ?? 'info';
  const sink = options.sink ?? jsonLineSink;
  const base = options.base ?? {};
  const clock = options.clock ?? (() => new Date());

  const write = (
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void => {
    if (levelRank[level] < levelRank[minimumLevel]) return;
    if (!eventName.test(event))
      throw new TypeError('Log event names must be stable, content-free identifiers');
    sink({
      timestamp: clock().toISOString(),
      level,
      event,
      fields: sanitizeLogFields({ ...base, ...fields }),
    });
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (fields) =>
      createLogger({ ...options, level: minimumLevel, sink, clock, base: { ...base, ...fields } }),
  };
}

export function createRequestId(): string {
  return randomUUID();
}
