import { describe, expect, it } from 'vitest';
import { classifyNativeEntryUrl } from '../../apps/mobile/src/navigation';

describe('mobile deep-link intake', () => {
  it.each(['boomerbuddy://check', 'boomerbuddy://check/', 'BOOMERBUDDY://CHECK'])(
    'accepts only an empty Check route signal: %s',
    (url) => {
      expect(classifyNativeEntryUrl(url)).toBe('route_only_check');
    },
  );

  it.each([
    'boomerbuddy://check?content=suspicious',
    'boomerbuddy://check#content',
    'boomerbuddy://check/path',
    'boomerbuddy://checker',
    'boomerbuddy://check\n',
    'boomerbuddy://check\t',
    'boomerbuddy://check\\payload',
    `boomerbuddy://check/${'a'.repeat(2_048)}`,
  ])('rejects Check payload material: %s', (url) => {
    expect(classifyNativeEntryUrl(url)).toBe('rejected_payload');
  });

  it.each(['https://app.boomerbuddy.net/member', 'mailto:support@boomerbuddy.net', ''])(
    'ignores unrelated entry URLs: %s',
    (url) => {
      expect(classifyNativeEntryUrl(url)).toBe('none');
    },
  );
});
