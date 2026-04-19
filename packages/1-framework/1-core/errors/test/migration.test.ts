import { describe, expect, it } from 'vitest';
import { CliStructuredError } from '../src/control';
import {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
  errorUnfilledPlaceholder,
  placeholder,
} from '../src/migration';

describe('Migration Errors', () => {
  it('errorUnfilledPlaceholder names the slot and carries structured metadata', () => {
    const error = errorUnfilledPlaceholder('backfill-product-status:check.source');
    expect(error).toMatchObject({
      code: '2001',
      domain: 'MIG',
      message: 'Unfilled migration placeholder',
      why: 'The migration contains a placeholder that has not been filled in: backfill-product-status:check.source',
      meta: { slot: 'backfill-product-status:check.source' },
    });
    expect(error.toEnvelope().code).toBe('PN-MIG-2001');
  });

  it('placeholder throws a CliStructuredError that names the slot', () => {
    let thrown: unknown;
    try {
      placeholder('foo');
    } catch (error) {
      thrown = error;
    }

    expect(CliStructuredError.is(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: '2001',
      domain: 'MIG',
      meta: { slot: 'foo' },
    });
    expect((thrown as CliStructuredError).toEnvelope().code).toBe('PN-MIG-2001');
  });

  it('errorMigrationFileMissing names the dir and points at scaffolding commands', () => {
    const error = errorMigrationFileMissing('/tmp/migrations/20260101_x');
    expect(error).toMatchObject({
      code: '2002',
      domain: 'MIG',
      message: 'migration.ts not found',
      why: 'No migration.ts file was found at "/tmp/migrations/20260101_x"',
      meta: { dir: '/tmp/migrations/20260101_x' },
    });
    expect(error.fix).toContain('prisma-next migration new');
    expect(error.toEnvelope().code).toBe('PN-MIG-2002');
  });

  it('errorMigrationInvalidDefaultExport carries the dir and optional export description', () => {
    const error = errorMigrationInvalidDefaultExport(
      '/tmp/pkg',
      'an exported constant "undefined"',
    );
    expect(error).toMatchObject({
      code: '2003',
      domain: 'MIG',
      message: 'migration.ts default export is not a valid migration',
      meta: { dir: '/tmp/pkg', actualExport: 'an exported constant "undefined"' },
    });
    expect(error.why).toContain('an exported constant "undefined"');
    expect(error.fix).toContain('export default class extends Migration');
    expect(error.toEnvelope().code).toBe('PN-MIG-2003');
  });

  it('errorMigrationInvalidDefaultExport omits actualExport from meta when not provided', () => {
    const error = errorMigrationInvalidDefaultExport('/tmp/pkg');
    expect(error.meta).toEqual({ dir: '/tmp/pkg' });
  });

  it('errorMigrationPlanNotArray names the dir and describes the actual value', () => {
    const error = errorMigrationPlanNotArray('/tmp/pkg', 'a string');
    expect(error).toMatchObject({
      code: '2004',
      domain: 'MIG',
      message: 'Migration.operations must be an array of operations',
      meta: { dir: '/tmp/pkg', actualValue: 'a string' },
    });
    expect(error.why).toContain('a string');
    expect(error.fix).toContain('operations');
    expect(error.toEnvelope().code).toBe('PN-MIG-2004');
  });

  it('errorMigrationPlanNotArray omits actualValue from meta when not provided', () => {
    const error = errorMigrationPlanNotArray('/tmp/pkg');
    expect(error.meta).toEqual({ dir: '/tmp/pkg' });
  });
});
