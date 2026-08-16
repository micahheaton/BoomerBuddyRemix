export const restrictedInputClasses = [
  'private_key',
  'payment_card',
  'authorization_credential',
  'one_time_code',
] as const;
export type RestrictedInputClass = (typeof restrictedInputClasses)[number];

export const restrictedInputPlaceholders = {
  payment_card: '[PAYMENT_CARD]',
  authorization_credential: '[AUTH_CREDENTIAL]',
  one_time_code: '[ONE_TIME_CODE]',
} as const;
export type RestrictedInputPlaceholder =
  (typeof restrictedInputPlaceholders)[keyof typeof restrictedInputPlaceholders];

export const sensitiveSafetyFlags = [
  'contained_payment_card',
  'contained_authorization_credential',
  'contained_one_time_code',
] as const;
export type SensitiveSafetyFlag = (typeof sensitiveSafetyFlags)[number];

export interface SafeRedaction {
  readonly class: Exclude<RestrictedInputClass, 'private_key'>;
  readonly placeholder: RestrictedInputPlaceholder;
  readonly count: number;
}

export type MinimizedInput =
  | {
      readonly status: 'accepted';
      readonly minimized: string;
      readonly detected: readonly RestrictedInputClass[];
      readonly redactions: readonly SafeRedaction[];
      readonly safetyFlags: readonly SensitiveSafetyFlag[];
    }
  | {
      readonly status: 'rejected';
      readonly detected: readonly RestrictedInputClass[];
      readonly reason:
        | 'restricted_input'
        | 'ambiguous_credential'
        | 'unsafe_url_secret'
        | 'overlapping_sensitive_spans'
        | 'unusable_after_redaction';
    };

interface SensitiveSpan {
  readonly start: number;
  readonly end: number;
  readonly class: Exclude<RestrictedInputClass, 'private_key'>;
  readonly placeholder: RestrictedInputPlaceholder;
}

const PRIVATE_KEY =
  /-----BEGIN [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----/iu;
const CLEAR_AUTHORIZATION =
  /(?:authorization\s*:\s*(?:bearer|basic)\s+|bearer\s+|api[_ -]?key\s*[:=]\s*|access[_ -]?token\s*[:=]\s*|refresh[_ -]?token\s*[:=]\s*|session[_ -]?token\s*[:=]\s*|pass(?:word|code)\s*[:=]\s*)([A-Za-z0-9._~+/@$!%=-]{4,})/giu;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const PREFIXED_CREDENTIAL =
  /(?:\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b|\bAIza[A-Za-z0-9_-]{20,}\b)/gu;
const CONTEXTUAL_OTP =
  /\b(?:otp|one[- ]time (?:code|password)|verification code|security code)\D{0,16}(\d{4,8})\b/giu;
const CARD_CANDIDATE = /(?:\d[ -]?){13,19}/gu;
const URL_CANDIDATE = /https?:\/\/[^\s<>"']+/giu;
const SENSITIVE_URL_KEY =
  /^(?:pass(?:word|code)?|pwd|auth(?:orization)?|access_?token|refresh_?token|id_?token|token|key|code|api_?key|session(?:_?id|_?token)?|otp|one_?time_?code|verification_?code|security_?code)$/iu;

function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/gu, '');
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

function capturedSpan(
  match: RegExpMatchArray,
  captured: string,
  className: SensitiveSpan['class'],
  placeholder: RestrictedInputPlaceholder,
): SensitiveSpan | undefined {
  const matchIndex = match.index;
  if (matchIndex === undefined) return undefined;
  const offset = match[0].lastIndexOf(captured);
  if (offset < 0) return undefined;
  return {
    start: matchIndex + offset,
    end: matchIndex + offset + captured.length,
    class: className,
    placeholder,
  };
}

function safeSpans(input: string): readonly SensitiveSpan[] {
  const spans: SensitiveSpan[] = [];
  for (const match of input.matchAll(CLEAR_AUTHORIZATION)) {
    const captured = match[1];
    if (captured === undefined) continue;
    const span = capturedSpan(
      match,
      captured,
      'authorization_credential',
      restrictedInputPlaceholders.authorization_credential,
    );
    if (span !== undefined) spans.push(span);
  }
  for (const match of input.matchAll(CONTEXTUAL_OTP)) {
    const captured = match[1];
    if (captured === undefined) continue;
    const span = capturedSpan(
      match,
      captured,
      'one_time_code',
      restrictedInputPlaceholders.one_time_code,
    );
    if (span !== undefined) spans.push(span);
  }
  for (const match of input.matchAll(CARD_CANDIDATE)) {
    if (!passesLuhn(match[0]) || match.index === undefined) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      class: 'payment_card',
      placeholder: restrictedInputPlaceholders.payment_card,
    });
  }
  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
}

function unsafeUrlSecret(input: string): boolean {
  for (const match of input.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(/[),.;!?]+$/gu, '');
    try {
      const parsed = new URL(candidate);
      if (parsed.username !== '' || parsed.password !== '') return true;
      for (const [key, value] of parsed.searchParams) {
        if (value !== '' && SENSITIVE_URL_KEY.test(key)) return true;
      }
      const fragment = new URLSearchParams(parsed.hash.replace(/^#/u, ''));
      for (const [key, value] of fragment) {
        if (value !== '' && SENSITIVE_URL_KEY.test(key)) return true;
      }
    } catch {
      // URL syntax is validated by the caller. Parsing failure alone does not
      // establish that a secret is present.
    }
  }
  return false;
}

function containsUncoveredCredential(input: string, spans: readonly SensitiveSpan[]): boolean {
  for (const pattern of [JWT_LIKE, PREFIXED_CREDENTIAL]) {
    pattern.lastIndex = 0;
    for (const match of input.matchAll(pattern)) {
      if (match.index === undefined) return true;
      const start = match.index;
      const end = start + match[0].length;
      if (!spans.some((span) => span.start <= start && span.end >= end)) return true;
    }
  }
  return false;
}

function hasOverlap(spans: readonly SensitiveSpan[]): boolean {
  return spans.some((span, index) => {
    const next = spans[index + 1];
    return next !== undefined && span.end > next.start;
  });
}

function detectedClasses(input: string, spans: readonly SensitiveSpan[]): RestrictedInputClass[] {
  const detected = new Set<RestrictedInputClass>();
  if (PRIVATE_KEY.test(input)) detected.add('private_key');
  for (const span of spans) detected.add(span.class);
  if (containsUncoveredCredential(input, spans) || unsafeUrlSecret(input)) {
    detected.add('authorization_credential');
  }
  return [...detected];
}

function redactSpans(input: string, spans: readonly SensitiveSpan[]): string {
  let redacted = '';
  let cursor = 0;
  for (const span of spans) {
    redacted += `${input.slice(cursor, span.start)}${span.placeholder}`;
    cursor = span.end;
  }
  return `${redacted}${input.slice(cursor)}`;
}

function redactionSummary(spans: readonly SensitiveSpan[]): SafeRedaction[] {
  const counts = new Map<SensitiveSpan['class'], number>();
  for (const span of spans) counts.set(span.class, (counts.get(span.class) ?? 0) + 1);
  return [...counts.entries()].map(([className, count]) => ({
    class: className,
    placeholder: restrictedInputPlaceholders[className],
    count,
  }));
}

function flagsFor(spans: readonly SensitiveSpan[]): SensitiveSafetyFlag[] {
  return [...new Set(spans.map((span) => `contained_${span.class}` as SensitiveSafetyFlag))];
}

export function detectRestrictedInput(input: string): readonly RestrictedInputClass[] {
  const normalized = input.normalize('NFKC');
  return detectedClasses(normalized, safeSpans(normalized));
}

export function minimizeRestrictedInput(
  input: string,
  maximumBytes = 16_384,
  mode: 'reject' | 'redact_safe' = 'reject',
): MinimizedInput {
  const normalized = input.normalize('NFKC').replace(/\r\n?/gu, '\n').trim();
  if (Buffer.byteLength(normalized, 'utf8') > maximumBytes) {
    throw new RangeError('Input exceeds the configured byte limit');
  }
  const spans = safeSpans(normalized);
  const detected = detectedClasses(normalized, spans);
  if (mode === 'reject' && detected.length > 0) {
    return { status: 'rejected', detected, reason: 'restricted_input' };
  }
  if (PRIVATE_KEY.test(normalized)) {
    return { status: 'rejected', detected, reason: 'restricted_input' };
  }
  if (unsafeUrlSecret(normalized)) {
    return { status: 'rejected', detected, reason: 'unsafe_url_secret' };
  }
  if (containsUncoveredCredential(normalized, spans)) {
    return { status: 'rejected', detected, reason: 'ambiguous_credential' };
  }
  if (hasOverlap(spans)) {
    return { status: 'rejected', detected, reason: 'overlapping_sensitive_spans' };
  }
  const minimized = redactSpans(normalized, spans)
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n');
  const meaningfulRemainder = minimized
    .replace(/\[(?:PAYMENT_CARD|AUTH_CREDENTIAL|ONE_TIME_CODE)\]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (spans.length > 0 && meaningfulRemainder.length < 4) {
    return { status: 'rejected', detected, reason: 'unusable_after_redaction' };
  }
  return {
    status: 'accepted',
    minimized,
    detected,
    redactions: redactionSummary(spans),
    safetyFlags: flagsFor(spans),
  };
}

export function redactSensitiveInput(input: string, maximumBytes = 16_384): MinimizedInput {
  return minimizeRestrictedInput(input, maximumBytes, 'redact_safe');
}
