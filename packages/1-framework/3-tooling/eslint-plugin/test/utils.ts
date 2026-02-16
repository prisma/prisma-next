import * as fs from 'node:fs';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { ESLint } from 'eslint';

export function loadContract<Contract extends SqlContract>(name: string): Contract {
  const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

export type CaseCategory = 'valid' | 'invalid' | 'ignored';

export interface TestCase {
  path: string;
  category: CaseCategory;
  fileName: string;
  expectedToPass: boolean;
  expectedToTriggerRule: boolean;
}

export interface LintDiagnostic {
  filePath: string;
  errorCount: number;
  warningCount: number;
  messages: Array<{
    ruleId: string | null;
    severity: number;
    message: string;
    line?: number;
    column?: number;
  }>;
}

/**
 * ESLint test runner for validating plugin rules
 */
export class LintTestRunner {
  private readonly casesDir: string;

  constructor(testDir: string) {
    this.casesDir = path.resolve(testDir, 'lints');
  }

  /**
   * Discover all test cases in the cases directory
   */
  discoverAllCases(): TestCase[] {
    const cases: TestCase[] = [];
    const categories: CaseCategory[] = ['valid', 'invalid', 'ignored'];

    for (const category of categories) {
      const categoryPath = path.join(this.casesDir, category);

      if (!fs.existsSync(categoryPath)) {
        continue;
      }

      const files = fs
        .readdirSync(categoryPath)
        .filter((file) => file.endsWith('.ts'))
        .sort();

      for (const fileName of files) {
        cases.push({
          path: path.join(category, fileName),
          category,
          fileName,
          expectedToPass: category === 'valid',
          expectedToTriggerRule: category === 'invalid',
        });
      }
    }

    return cases;
  }

  /**
   * Create ESLint instance with plugin configuration
   */
  async createESLint(testDir: string, customRuleOptions?: unknown[]): Promise<ESLint> {
    const plugin = await import('../src/index.js');

    return new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts', '**/*.js'],
          languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            parser: await import('@typescript-eslint/parser'),
            parserOptions: {
              project: path.resolve(testDir, 'lints', 'tsconfig.json'),
              tsconfigRootDir: testDir,
            },
          },
          plugins: {
            '@prisma-next': plugin.default,
          },
          rules: {
            '@prisma-next/lint-build-call': ['error', ...(customRuleOptions || [])],
          },
        },
      ],
    });
  }

  /**
   * Lint a case file and return normalized results
   */
  async lintCase(testCase: TestCase, testDir: string): Promise<LintDiagnostic> {
    const eslint = await this.createESLint(testDir);
    const fullPath = path.resolve(this.casesDir, testCase.path);

    const results = await eslint.lintFiles([fullPath]);
    const result = results[0]!;

    return {
      filePath: path.basename(result.filePath),
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      messages: result.messages.map((msg) => ({
        ruleId: msg.ruleId,
        severity: msg.severity,
        message: msg.message,
        line: msg.line,
        column: msg.column,
      })),
    };
  }

  /**
   * Validate a test case against expected behavior
   */
  validateCase(testCase: TestCase, diagnostic: LintDiagnostic): void {
    const hasOurRuleViolation = diagnostic.messages.length > 0;

    switch (testCase.category) {
      case 'valid':
        if (diagnostic.errorCount !== 0 || diagnostic.warningCount !== 0) {
          throw new Error(
            `Expected ${testCase.fileName} to pass validation, but got ${diagnostic.errorCount} errors and ${diagnostic.warningCount} warnings`,
          );
        }
        if (hasOurRuleViolation) {
          throw new Error(
            `Expected ${testCase.fileName} to not trigger our rule, but got: ${diagnostic.messages.map((m) => m.message).join(', ')}`,
          );
        }
        break;

      case 'invalid':
        if (diagnostic.errorCount === 0) {
          throw new Error(`Expected ${testCase.fileName} to have validation errors, but got none`);
        }
        if (!hasOurRuleViolation) {
          throw new Error(`Expected ${testCase.fileName} to trigger our rule, but it didn't`);
        }
        break;

      case 'ignored':
        if (hasOurRuleViolation) {
          throw new Error(
            `Expected ${testCase.fileName} to be ignored by our rule, but got: ${diagnostic.messages.map((m) => m.message).join(', ')}`,
          );
        }
        break;

      default:
        throw new Error(`Unknown case category: ${testCase.category}`);
    }
  }
}
