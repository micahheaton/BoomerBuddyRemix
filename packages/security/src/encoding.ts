import { timingSafeEqual } from 'node:crypto';

export function lengthPrefixed(parts: readonly (string | Uint8Array)[]): Buffer {
  const encoded = parts.map((part) =>
    typeof part === 'string' ? Buffer.from(part, 'utf8') : Buffer.from(part),
  );
  const total = encoded.reduce((sum, part) => sum + 4 + part.byteLength, 0);
  const output = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const part of encoded) {
    output.writeUInt32BE(part.byteLength, offset);
    offset += 4;
    part.copy(output, offset);
    offset += part.byteLength;
  }
  return output;
}

export function constantTimeEqual(left: string | Uint8Array, right: string | Uint8Array): boolean {
  const leftBytes = typeof left === 'string' ? Buffer.from(left) : Buffer.from(left);
  const rightBytes = typeof right === 'string' ? Buffer.from(right) : Buffer.from(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    const padded = Buffer.alloc(leftBytes.byteLength);
    rightBytes.copy(padded, 0, 0, Math.min(rightBytes.byteLength, padded.byteLength));
    timingSafeEqual(leftBytes, padded);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

export function decodeBase64Key(value: string, expectedLength = 32): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.byteLength !== expectedLength ||
    decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
  ) {
    throw new TypeError(`Key must be canonical base64 encoding of ${expectedLength} bytes`);
  }
  return decoded;
}
