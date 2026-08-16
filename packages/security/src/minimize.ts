export const restrictedInputClasses = [
  'private_key',
  'payment_card',
  'authorization_credential',
  'one_time_code',
] as const;
export type RestrictedInputClass = (typeof restrictedInputClasses)[number];

export type MinimizedInput =
  | {
      readonly status: 'accepted';
      readonly minimized: string;
      readonly detected: readonly RestrictedInputClass[];
    }
  | {
      readonly status: 'rejected';
      readonly detected: readonly RestrictedInputClass[];
      readonly reason: 'restricted_input';
    };

const PRIVATE_KEY =
  /-----BEGIN [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [^\r\n-]*PRIVATE KEY(?: BLOCK)?-----/iu;
const AUTHORIZATION =
  /(?:authorization\s*:\s*(?:bearer|basic)|bearer\s+|api[_ -]?key\s*[:=]|access[_ -]?token\s*[:=]|refresh[_ -]?token\s*[:=]|session[_ -]?token\s*[:=]|pass(?:word|code)\s*[:=])\s*[A-Za-z0-9._~+/@$!%-]{4,}/iu;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u;
const CONTEXTUAL_OTP =
  /\b(?:otp|one[- ]time (?:code|password)|verification code|security code)\D{0,16}\d{4,8}\b/iu;
const CARD_CANDIDATE = /(?:\d[ -]?){13,19}/gu;
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

export function detectRestrictedInput(input: string): readonly RestrictedInputClass[] {
  const detected = new Set<RestrictedInputClass>();
  if (PRIVATE_KEY.test(input)) detected.add('private_key');
  if (AUTHORIZATION.test(input) || JWT_LIKE.test(input)) {
    detected.add('authorization_credential');
  }
  if (CONTEXTUAL_OTP.test(input)) detected.add('one_time_code');
  for (const match of input.matchAll(CARD_CANDIDATE)) {
    if (passesLuhn(match[0])) {
      detected.add('payment_card');
      break;
    }
  }
  if (/^https?:\/\//iu.test(input)) {
    try {
      const parsed = new URL(input);
      if (parsed.username !== '' || parsed.password !== '')
        detected.add('authorization_credential');
      for (const [key, value] of parsed.searchParams) {
        if (value !== '' && SENSITIVE_URL_KEY.test(key)) detected.add('authorization_credential');
      }
      const fragment = new URLSearchParams(parsed.hash.replace(/^#/u, ''));
      for (const [key, value] of fragment) {
        if (value !== '' && SENSITIVE_URL_KEY.test(key)) detected.add('authorization_credential');
      }
    } catch {
      // Invalid URL input is handled by the fraud URL validator. Do not derive a
      // secret classification from parsing failure alone.
    }
  }
  return [...detected];
}

export function minimizeRestrictedInput(input: string, maximumBytes = 16_384): MinimizedInput {
  const normalized = input.normalize('NFKC').replace(/\r\n?/gu, '\n').trim();
  if (Buffer.byteLength(normalized, 'utf8') > maximumBytes) {
    throw new RangeError('Input exceeds the configured byte limit');
  }
  const detected = detectRestrictedInput(normalized);
  if (detected.length > 0) return { status: 'rejected', detected, reason: 'restricted_input' };
  return {
    status: 'accepted',
    minimized: normalized.replace(/[\t\f\v ]+/gu, ' ').replace(/\n{3,}/gu, '\n\n'),
    detected,
  };
}
