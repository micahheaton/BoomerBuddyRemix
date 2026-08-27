import { describe, expect, it } from 'vitest';
import { validatedOfficialSourceUrl } from './official-source';

describe('mobile official learning sources', () => {
  it('allows credential-free HTTPS government sources', () => {
    expect(validatedOfficialSourceUrl('https://consumer.ftc.gov/articles/how-avoid-scam')).toBe(
      'https://consumer.ftc.gov/articles/how-avoid-scam',
    );
    expect(validatedOfficialSourceUrl('https://oag.ca.gov/news/example')).toBe(
      'https://oag.ca.gov/news/example',
    );
    expect(validatedOfficialSourceUrl('https://www.identitytheft.gov/')).toBe(
      'https://www.identitytheft.gov/',
    );
  });

  it('rejects lookalikes, credentials, ports, fragments, and non-HTTPS sources', () => {
    for (const value of [
      'http://consumer.ftc.gov/example',
      'https://consumer.ftc.gov.example.com/example',
      'https://user@consumer.ftc.gov/example',
      'https://consumer.ftc.gov:444/example',
      'https://consumer.ftc.gov/example#private',
      'not a URL',
    ]) {
      expect(validatedOfficialSourceUrl(value)).toBeUndefined();
    }
  });
});
