import { describe, expect, it } from 'vitest';
import { createLogger, sanitizeLogFields, type LogRecord } from './index';

describe('redacted observability', () => {
  it('redacts sensitive keys, credentials, errors and cycles', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const fields = sanitizeLogFields({
      requestId: 'request_001',
      content: 'must not survive',
      nested: { authorization: 'must not survive either' },
      note: 'Bearer generated_test_credential',
      error: new Error('failed for https://private.example/path'),
      circular,
    });
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain('must not survive');
    expect(serialized).not.toContain('generated_test_credential');
    expect(serialized).not.toContain('private.example');
    expect(serialized).toContain('[CIRCULAR]');
    expect(fields.requestId).toBe('request_001');
  });

  it('redacts restricted values even beneath innocuous keys and in arrays', () => {
    const generatedCard = ['4242', '4242', '4242', '4242'].join(' ');
    const generatedKey = [
      '-----BEGIN ' + 'PRIVATE KEY-----',
      'generated-body',
      '-----END ' + 'PRIVATE KEY-----',
    ].join('\n');
    const output = sanitizeLogFields({
      detail: generatedKey,
      values: [generatedCard, 'verification code ' + String(100_000 + 2345), 'person@example.test'],
    });
    const serialized = JSON.stringify(output);
    for (const forbidden of [generatedKey, generatedCard, '102345', 'person@example.test']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('filters levels, adds child context and rejects content-like event names', () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      level: 'info',
      sink: (record) => records.push(record),
      base: { service: 'api' },
      clock: () => new Date('2026-01-01T00:00:00Z'),
    });
    logger.debug('request.debug');
    logger.child({ requestId: 'request_001' }).info('request.completed', { statusCode: 200 });
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      event: 'request.completed',
      fields: { service: 'api', requestId: 'request_001', statusCode: 200 },
    });
    expect(() => logger.info('raw user sentence is unsafe')).toThrow(TypeError);
  });
});
