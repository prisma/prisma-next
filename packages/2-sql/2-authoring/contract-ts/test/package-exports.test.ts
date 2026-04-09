import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readPackageJson(): {
  readonly exports?: Record<string, string>;
} {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as {
    readonly exports?: Record<string, string>;
  };
}

describe('package exports', () => {
  it('exports the SQL contract JSON schema via ./schema-sql', () => {
    const packageJson = readPackageJson();

    expect(packageJson.exports?.['./schema-sql']).toBe('./schemas/data-contract-sql-v1.json');

    const schemaUrl = new URL('../schemas/data-contract-sql-v1.json', import.meta.url);
    expect(existsSync(schemaUrl)).toBe(true);
  });
});
