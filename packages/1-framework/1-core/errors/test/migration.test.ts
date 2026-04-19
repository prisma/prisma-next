import { describe, expect, it } from 'vitest';
import {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
} from '../src/migration';

describe('Migration Errors', () => {
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
      message: 'Migration.plan() must return an array of operations',
      meta: { dir: '/tmp/pkg', actualValue: 'a string' },
    });
    expect(error.why).toContain('a string');
    expect(error.fix).toContain('plan()');
    expect(error.toEnvelope().code).toBe('PN-MIG-2004');
  });

  it('errorMigrationPlanNotArray omits actualValue from meta when not provided', () => {
    const error = errorMigrationPlanNotArray('/tmp/pkg');
    expect(error.meta).toEqual({ dir: '/tmp/pkg' });
  });
});
