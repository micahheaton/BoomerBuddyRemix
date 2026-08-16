import { describe, expect, it } from 'vitest';
import { containsForbiddenV1RuntimeReference } from '../../scripts/verify-portability.mjs';

describe('V1 runtime isolation guard', () => {
  it('rejects static, dynamic, CommonJS, and direct runtime references across path separators', () => {
    const forbidden = [
      "import '../../../reference/boomerbuddy-v1/server/app'",
      "export { legacy } from '../../reference/boomerbuddy-v1/shared/legacy'",
      "await import('../../reference/boomerbuddy-v1/server/app')",
      String.raw`require('..\\..\\reference\\boomerbuddy-v1\\server\\app')`,
      "readFile('../reference/boomerbuddy-v1/package.json')",
      "import '../../../reference/./boomerbuddy-v1/server/app'",
      "import '../../../reference/intermediate/../boomerbuddy-v1/server/app'",
      "new URL('../../../reference/%62oomerbuddy-v1/server/app', import.meta.url)",
      String.raw`import '../../../reference/\u0062oomerbuddy-v1/server/app'`,
      "readFile('../../../reference/' + 'boomerbuddy-v1/package.json')",
      JSON.stringify('..\\..\\reference\\boomerbuddy-v1\\server\\app'),
    ];
    for (const source of forbidden) {
      expect(containsForbiddenV1RuntimeReference(source)).toBe(true);
    }
  });

  it('allows documentation language and unrelated versioned modules', () => {
    expect(containsForbiddenV1RuntimeReference('V1 remains read-only research.')).toBe(false);
    expect(containsForbiddenV1RuntimeReference("import './commerce-v1'")).toBe(false);
  });
});
