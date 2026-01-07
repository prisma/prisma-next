import { describe, expect, it } from 'vitest';
import { LintTestRunner } from './utils.ts';

describe('ESLint Plugin Rule Validation', () => {
  const runner = new LintTestRunner(__dirname);
  const allCases = runner.discoverAllCases();

  it.each(allCases)('should handle $category case: $fileName', async (testCase) => {
    const diagnostic = await runner.lintCase(testCase, __dirname);
    runner.validateCase(testCase, diagnostic);
    expect(diagnostic).toMatchSnapshot(
      `${testCase.category}-${testCase.fileName.replace('.ts', '')}`,
    );
  });
});
