import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { resolveDbIntrospectOutputPath } from '../../src/commands/db-introspect-paths';

describe('resolveDbIntrospectOutputPath', () => {
  it('uses explicit output when provided', () => {
    expect(
      resolveDbIntrospectOutputPath(
        { output: './prisma/custom-schema.prisma' },
        './output/contract.json',
      ),
    ).toBe(resolve(process.cwd(), './prisma/custom-schema.prisma'));
  });

  it('writes schema.prisma alongside the configured contract output', () => {
    expect(resolveDbIntrospectOutputPath({}, './output/contract.json')).toBe(
      resolve(process.cwd(), './output/schema.prisma'),
    );
  });

  it('falls back to schema.prisma in cwd', () => {
    expect(resolveDbIntrospectOutputPath({}, undefined)).toBe(
      resolve(process.cwd(), 'schema.prisma'),
    );
  });
});
