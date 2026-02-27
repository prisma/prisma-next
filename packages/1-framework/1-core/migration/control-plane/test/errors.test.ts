import { describe, expect, it } from 'vitest';
import {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensionPacks,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDestructiveChanges,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorHashMismatch,
  errorJsonFormatNotSupported,
  errorMarkerMissing,
  errorMarkerRequired,
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorRunnerFailed,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorTargetMismatch,
  errorUnexpected,
} from '../src/errors';

describe('CliStructuredError', () => {
  it('creates error with all properties', () => {
    const error = new CliStructuredError('4001', 'Test error', {
      domain: 'CLI',
      severity: 'error',
      why: 'This is why',
      fix: 'This is how to fix',
      where: { path: '/path/to/file.ts', line: 42 },
      meta: { key: 'value' },
      docsUrl: 'https://example.com/docs',
    });

    expect(error.code).toBe('4001');
    expect(error.message).toBe('Test error');
    expect(error.domain).toBe('CLI');
    expect(error.severity).toBe('error');
    expect(error.why).toBe('This is why');
    expect(error.fix).toBe('This is how to fix');
    expect(error.where).toEqual({ path: '/path/to/file.ts', line: 42 });
    expect(error.meta).toEqual({ key: 'value' });
    expect(error.docsUrl).toBe('https://example.com/docs');
  });

  it('creates error with defaults', () => {
    const error = new CliStructuredError('4001', 'Test error');

    expect(error.code).toBe('4001');
    expect(error.message).toBe('Test error');
    expect(error.domain).toBe('CLI');
    expect(error.severity).toBe('error');
    expect(error.why).toBeUndefined();
    expect(error.fix).toBeUndefined();
    expect(error.where).toBeUndefined();
    expect(error.meta).toBeUndefined();
    expect(error.docsUrl).toBeUndefined();
  });

  it('converts to envelope with CLI code prefix', () => {
    const error = new CliStructuredError('4001', 'Test error', { domain: 'CLI' });
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('PN-CLI-4001');
    expect(envelope.domain).toBe('CLI');
    expect(envelope.summary).toBe('Test error');
  });

  it('converts to envelope with RTM code prefix', () => {
    const error = new CliStructuredError('3001', 'Test error', { domain: 'RTM' });
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('PN-RTM-3001');
    expect(envelope.domain).toBe('RTM');
    expect(envelope.summary).toBe('Test error');
  });

  describe('is() type guard', () => {
    it('returns true for CliStructuredError instances', () => {
      const error = new CliStructuredError('4001', 'Test error', { domain: 'CLI' });
      expect(CliStructuredError.is(error)).toBe(true);
    });

    it('returns true for CliStructuredError with RTM domain', () => {
      const error = new CliStructuredError('3000', 'Test error', { domain: 'RTM' });
      expect(CliStructuredError.is(error)).toBe(true);
    });

    it('returns false for non-Error values', () => {
      expect(CliStructuredError.is(null)).toBe(false);
      expect(CliStructuredError.is(undefined)).toBe(false);
      expect(CliStructuredError.is('string')).toBe(false);
      expect(CliStructuredError.is(123)).toBe(false);
      expect(CliStructuredError.is({})).toBe(false);
    });

    it('returns false for plain Error', () => {
      const error = new Error('Plain error');
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error with wrong name', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['code'] = '4001';
      error['domain'] = 'CLI';
      error['toEnvelope'] = () => ({});
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error with missing code', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['name'] = 'CliStructuredError';
      error['domain'] = 'CLI';
      error['toEnvelope'] = () => ({});
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error with wrong domain', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['name'] = 'CliStructuredError';
      error['code'] = '4001';
      error['domain'] = 'OTHER';
      error['toEnvelope'] = () => ({});
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error without toEnvelope method', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['name'] = 'CliStructuredError';
      error['code'] = '4001';
      error['domain'] = 'CLI';
      expect(CliStructuredError.is(error)).toBe(false);
    });
  });
});

describe('Config Errors', () => {
  it('errorConfigFileNotFound creates correct error', () => {
    const error = errorConfigFileNotFound('/path/to/config.ts');
    expect(error.code).toBe('4001');
    expect(error.message).toBe('Config file not found');
    expect(error.domain).toBe('CLI');
    expect(error.where?.path).toBe('/path/to/config.ts');
  });

  it('errorConfigFileNotFound with custom why', () => {
    const error = errorConfigFileNotFound('/path/to/config.ts', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorConfigFileNotFound without configPath', () => {
    const error = errorConfigFileNotFound();
    expect(error.code).toBe('4001');
    expect(error.where).toBeUndefined();
  });

  it('errorContractConfigMissing creates correct error', () => {
    const error = errorContractConfigMissing();
    expect(error.code).toBe('4002');
    expect(error.message).toBe('Contract configuration missing');
    expect(error.domain).toBe('CLI');
  });

  it('errorContractConfigMissing with custom why', () => {
    const error = errorContractConfigMissing({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorContractValidationFailed creates correct error', () => {
    const error = errorContractValidationFailed('Missing required field');
    expect(error.code).toBe('4003');
    expect(error.message).toBe('Contract validation failed');
    expect(error.why).toBe('Missing required field');
  });

  it('errorContractValidationFailed with where', () => {
    const error = errorContractValidationFailed('Invalid type', {
      where: { path: '/path/to/contract.ts', line: 10 },
    });
    expect(error.where).toEqual({ path: '/path/to/contract.ts', line: 10 });
  });

  it('errorFileNotFound creates correct error', () => {
    const error = errorFileNotFound('/path/to/file.ts');
    expect(error.code).toBe('4004');
    expect(error.message).toBe('File not found');
    expect(error.where?.path).toBe('/path/to/file.ts');
  });

  it('errorFileNotFound with custom why', () => {
    const error = errorFileNotFound('/path/to/file.ts', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorFileNotFound with custom fix and docsUrl', () => {
    const error = errorFileNotFound('/path/to/file.ts', {
      fix: 'Custom fix',
      docsUrl: 'https://example.com/docs',
    });
    expect(error.fix).toBe('Custom fix');
    expect(error.docsUrl).toBe('https://example.com/docs');
  });

  it('errorDatabaseConnectionRequired creates correct error', () => {
    const error = errorDatabaseConnectionRequired();
    expect(error.code).toBe('4005');
    expect(error.message).toBe('Database connection is required');
    expect(error.domain).toBe('CLI');
  });

  it('errorDatabaseConnectionRequired with custom why', () => {
    const error = errorDatabaseConnectionRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorQueryRunnerFactoryRequired creates correct error', () => {
    const error = errorQueryRunnerFactoryRequired();
    expect(error.code).toBe('4006');
    expect(error.message).toBe('Query runner factory is required');
    expect(error.domain).toBe('CLI');
  });

  it('errorQueryRunnerFactoryRequired with custom why', () => {
    const error = errorQueryRunnerFactoryRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorFamilyReadMarkerSqlRequired creates correct error', () => {
    const error = errorFamilyReadMarkerSqlRequired();
    expect(error.code).toBe('4007');
    expect(error.message).toBe('Family readMarker() is required');
    expect(error.domain).toBe('CLI');
  });

  it('errorFamilyReadMarkerSqlRequired with custom why', () => {
    const error = errorFamilyReadMarkerSqlRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorDriverRequired creates correct error', () => {
    const error = errorDriverRequired();
    expect(error.code).toBe('4010');
    expect(error.message).toBe('Driver is required for DB-connected commands');
    expect(error.domain).toBe('CLI');
  });

  it('errorDriverRequired with custom why', () => {
    const error = errorDriverRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMigrationPlanningFailed creates correct error', () => {
    const conflicts = [
      { kind: 'conflict-1', summary: 'Summary 1', why: 'Fix 1' },
      { kind: 'conflict-2', summary: 'Summary 2', why: 'Fix 2' },
    ];
    const error = errorMigrationPlanningFailed({ conflicts });
    expect(error.code).toBe('4020');
    expect(error.message).toBe('Migration planning failed');
    expect(error.why).toContain('Summary 1');
    expect(error.why).toContain('Summary 2');
    expect(error.fix).toContain('Fix 1');
    expect(error.fix).toContain('Fix 2');
    expect(error.meta?.['conflicts']).toEqual(conflicts);
  });

  it('errorMigrationPlanningFailed with custom why', () => {
    const conflicts = [{ kind: 'conflict-1', summary: 'Summary 1' }];
    const error = errorMigrationPlanningFailed({ conflicts, why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMigrationPlanningFailed with no conflict fixes', () => {
    const conflicts = [{ kind: 'conflict-1', summary: 'Summary 1' }];
    const error = errorMigrationPlanningFailed({ conflicts });
    expect(error.fix).toContain('db schema-verify');
  });

  it('errorTargetMigrationNotSupported creates correct error', () => {
    const error = errorTargetMigrationNotSupported();
    expect(error.code).toBe('4021');
    expect(error.message).toBe('Target does not support migrations');
    expect(error.domain).toBe('CLI');
  });

  it('errorTargetMigrationNotSupported with custom why', () => {
    const error = errorTargetMigrationNotSupported({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorJsonFormatNotSupported creates correct error', () => {
    const error = errorJsonFormatNotSupported({
      command: 'db verify',
      format: 'unknown',
      supportedFormats: ['compact', 'detailed'],
    });
    expect(error.code).toBe('4008');
    expect(error.message).toBe('Unsupported JSON format');
    expect(error.domain).toBe('CLI');
    expect(error.why).toContain('db verify');
    expect(error.why).toContain('unknown');
    expect(error.fix).toContain('compact or detailed');
    expect(error.meta?.['command']).toBe('db verify');
    expect(error.meta?.['format']).toBe('unknown');
    expect(error.meta?.['supportedFormats']).toEqual(['compact', 'detailed']);
  });

  it('errorContractMissingExtensionPacks with single pack', () => {
    const error = errorContractMissingExtensionPacks({
      missingExtensionPacks: ['pgvector'],
      providedComponentIds: ['postgres', 'postgres-adapter'],
    });
    expect(error.code).toBe('4011');
    expect(error.message).toBe('Missing extension packs in config');
    expect(error.domain).toBe('CLI');
    expect(error.why).toContain("'pgvector'");
    // Single pack uses singular "pack" not plural "packs"
    expect(error.why).toContain('extension pack');
    expect(error.meta?.['missingExtensionPacks']).toEqual(['pgvector']);
    // providedComponentIds are sorted alphabetically
    expect(error.meta?.['providedComponentIds']).toEqual(['postgres', 'postgres-adapter']);
  });

  it('errorContractMissingExtensionPacks with multiple packs', () => {
    const error = errorContractMissingExtensionPacks({
      missingExtensionPacks: ['pgvector', 'uuid-ossp'],
      providedComponentIds: ['postgres'],
    });
    expect(error.code).toBe('4011');
    expect(error.why).toContain("'pgvector'");
    expect(error.why).toContain("'uuid-ossp'");
    expect(error.meta?.['missingExtensionPacks']).toEqual(['pgvector', 'uuid-ossp']);
  });

  it('errorConfigValidation creates correct error', () => {
    const error = errorConfigValidation('family');
    expect(error.code).toBe('4009');
    expect(error.message).toBe('Config validation error');
    expect(error.why).toBe('Config must have a "family" field');
  });

  it('errorConfigValidation with custom why', () => {
    const error = errorConfigValidation('family', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });
});

describe('Runtime Errors', () => {
  it('errorMarkerMissing creates correct error', () => {
    const error = errorMarkerMissing();
    expect(error.code).toBe('3001');
    expect(error.message).toBe('Marker missing');
    expect(error.domain).toBe('RTM');
  });

  it('errorMarkerMissing with custom why and dbUrl', () => {
    const error = errorMarkerMissing({ why: 'Custom reason', dbUrl: 'postgres://localhost' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorHashMismatch creates correct error', () => {
    const error = errorHashMismatch();
    expect(error.code).toBe('3002');
    expect(error.message).toBe('Hash mismatch');
    expect(error.domain).toBe('RTM');
  });

  it('errorHashMismatch with expected and actual', () => {
    const error = errorHashMismatch({ expected: 'hash1', actual: 'hash2' });
    expect(error.meta?.['expected']).toBe('hash1');
    expect(error.meta?.['actual']).toBe('hash2');
  });

  it('errorHashMismatch with custom why', () => {
    const error = errorHashMismatch({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorHashMismatch with only expected', () => {
    const error = errorHashMismatch({ expected: 'hash1' });
    expect(error.meta?.['expected']).toBe('hash1');
    expect(error.meta?.['actual']).toBeUndefined();
  });

  it('errorHashMismatch with only actual', () => {
    const error = errorHashMismatch({ actual: 'hash2' });
    expect(error.meta?.['actual']).toBe('hash2');
    expect(error.meta?.['expected']).toBeUndefined();
  });

  it('errorTargetMismatch creates correct error', () => {
    const error = errorTargetMismatch('postgres', 'mysql');
    expect(error.code).toBe('3003');
    expect(error.message).toBe('Target mismatch');
    expect(error.domain).toBe('RTM');
    expect(error.why).toContain('postgres');
    expect(error.why).toContain('mysql');
    expect(error.meta?.['expected']).toBe('postgres');
    expect(error.meta?.['actual']).toBe('mysql');
  });

  it('errorTargetMismatch with custom why', () => {
    const error = errorTargetMismatch('postgres', 'mysql', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMarkerRequired creates correct error', () => {
    const error = errorMarkerRequired();
    expect(error.code).toBe('3010');
    expect(error.message).toBe('Marker required');
    expect(error.domain).toBe('RTM');
  });

  it('errorMarkerRequired with custom why and fix', () => {
    const error = errorMarkerRequired({ why: 'Custom reason', fix: 'Custom fix' });
    expect(error.why).toBe('Custom reason');
    expect(error.fix).toBe('Custom fix');
  });

  it('errorRunnerFailed creates correct error', () => {
    const error = errorRunnerFailed('Runner failed');
    expect(error.code).toBe('3020');
    expect(error.message).toBe('Runner failed');
    expect(error.domain).toBe('RTM');
  });

  it('errorRunnerFailed with all options', () => {
    const error = errorRunnerFailed('Runner failed', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorDestructiveChanges creates correct error', () => {
    const error = errorDestructiveChanges('Destructive changes detected');
    expect(error.code).toBe('3030');
    expect(error.message).toBe('Destructive changes detected');
    expect(error.domain).toBe('RTM');
  });

  it('errorDestructiveChanges with all options', () => {
    const error = errorDestructiveChanges('Destructive changes detected', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });

  it('errorRuntime creates correct error', () => {
    const error = errorRuntime('Something failed');
    expect(error.code).toBe('3000');
    expect(error.message).toBe('Something failed');
    expect(error.domain).toBe('RTM');
  });

  it('errorRuntime with all options', () => {
    const error = errorRuntime('Something failed', {
      why: 'Custom why',
      fix: 'Custom fix',
      meta: { key: 'value' },
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
    expect(error.meta).toEqual({ key: 'value' });
  });
});

describe('Generic Error', () => {
  it('errorUnexpected creates correct error', () => {
    const error = errorUnexpected('Unexpected error occurred');
    expect(error.code).toBe('4999');
    expect(error.message).toBe('Unexpected error');
    expect(error.domain).toBe('CLI');
    expect(error.why).toBe('Unexpected error occurred');
  });

  it('errorUnexpected with custom why and fix', () => {
    const error = errorUnexpected('Unexpected error occurred', {
      why: 'Custom why',
      fix: 'Custom fix',
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
  });
});
