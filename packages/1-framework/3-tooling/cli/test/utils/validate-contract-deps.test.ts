import { describe, expect, it } from 'vitest';
import {
  extractPackageSpecifiers,
  validateContractDeps,
} from '../../src/utils/validate-contract-deps';

describe('extractPackageSpecifiers', () => {
  it('extracts scoped package names from import type statements', () => {
    const dts = `import type { Foo } from '@prisma-next/target-postgres/codec-types';
import type { Bar } from '@prisma-next/sql-contract/types';
import type { Contract } from '@prisma-next/contract/types';`;

    const result = extractPackageSpecifiers(dts);

    expect(result).toEqual([
      '@prisma-next/target-postgres',
      '@prisma-next/sql-contract',
      '@prisma-next/contract',
    ]);
  });

  it('returns empty array when no imports present', () => {
    const dts = 'export type Contract = { readonly models: {} };';

    expect(extractPackageSpecifiers(dts)).toEqual([]);
  });

  it('deduplicates repeated packages', () => {
    const dts = `import type { A } from '@prisma-next/contract/types';
import type { B } from '@prisma-next/contract/hashing';`;

    expect(extractPackageSpecifiers(dts)).toEqual(['@prisma-next/contract']);
  });

  it('extracts from double-quoted import specifiers', () => {
    const dts = `import type { Foo } from "@prisma-next/target-postgres/codec-types";
import type { Bar } from "@prisma-next/sql-contract/types";`;

    const result = extractPackageSpecifiers(dts);

    expect(result).toEqual(['@prisma-next/target-postgres', '@prisma-next/sql-contract']);
  });
});

describe('validateContractDeps', () => {
  it('returns no missing packages when all resolve', () => {
    const dts = `import type { Foo } from '@prisma-next/contract/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.missing).toEqual([]);
  });

  it('returns missing packages when they cannot be resolved', () => {
    const dts = `import type { Foo } from '@nonexistent-scope/fake-package/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.missing).toEqual(['@nonexistent-scope/fake-package']);
  });

  it('formats a warning message listing missing packages', () => {
    const dts = `import type { Foo } from '@nonexistent-scope/pkg-a/types';
import type { Bar } from '@nonexistent-scope/pkg-b/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.missing).toContain('@nonexistent-scope/pkg-a');
    expect(result.missing).toContain('@nonexistent-scope/pkg-b');
    expect(result.warning).toContain('@nonexistent-scope/pkg-a');
    expect(result.warning).toContain('@nonexistent-scope/pkg-b');
    expect(result.warning).toContain('Install them with your package manager');
    expect(result.warning).not.toContain('pnpm add');
  });

  it('returns no warning when all packages resolve', () => {
    const dts = `import type { Foo } from '@prisma-next/contract/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.warning).toBeUndefined();
  });
});
