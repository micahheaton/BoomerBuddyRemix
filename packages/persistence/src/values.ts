import { randomUUID } from 'node:crypto';

export interface IdFactory {
  next(prefix: string): string;
}

export const randomIdFactory: IdFactory = {
  next: (prefix) => `${prefix}_${randomUUID()}`,
};

export function asDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid database timestamp: ${field}`);
  return date;
}

export function stringArray(value: unknown, field: string): readonly string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new TypeError(`Invalid database string array: ${field}`);
  }
  return parsed;
}

export function jsonValue(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export function jsonParameter(value: unknown): string {
  return JSON.stringify(value);
}

export function placeholders(start: number, count: number): string {
  if (count < 1) throw new TypeError('At least one placeholder is required');
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(', ');
}
