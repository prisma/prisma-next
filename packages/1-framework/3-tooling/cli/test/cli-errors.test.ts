import { describe, expect, it } from 'vitest';
import type { MigrationApplyFailure } from '../src/control-api/types';
import {
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorPathUnreachable,
} from '../src/utils/cli-errors';

describe('CliStructuredError.toEnvelope()', () => {
  it('converts driver required error to envelope with PN-CLI-4010', () => {
    const error = errorDriverRequired();
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('PN-CLI-4010');
    expect(envelope.domain).toBe('CLI');
    expect(envelope.summary).toBe('Driver is required for DB-connected commands');
    expect(envelope.fix).toBe(
      'Add a control-plane driver to prisma-next.config.ts (e.g. import a driver descriptor and set `driver: postgresDriver`)',
    );
    expect(envelope.docsUrl).toBe('https://prisma-next.dev/docs/cli/config');
  });

  it('converts readMarker error to envelope with PN-CLI-4007', () => {
    const error = errorFamilyReadMarkerSqlRequired();
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('PN-CLI-4007');
    expect(envelope.domain).toBe('CLI');
    expect(envelope.summary).toBe('Family readMarker() is required');
    expect(envelope.fix).toBe(
      'Ensure family.verify.readMarker() is exported by your family package',
    );
    expect(envelope.docsUrl).toBe('https://prisma-next.dev/docs/cli/db-verify');
  });
});

describe('errorPathUnreachable', () => {
  const targetHash = `sha256:${'a'.repeat(64)}`;
  const fromHash = `sha256:${'b'.repeat(64)}`;

  it('emits a fully-qualified --from --to fix line for the pathUnreachable runner kind', () => {
    const failure: MigrationApplyFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'Current contract has no planned migration path',
      why: 'Cannot reach target.',
      meta: { spaceId: 'app', kind: 'pathUnreachable', fromHash, targetHash },
    };
    const envelope = errorPathUnreachable(failure).toEnvelope();
    expect(envelope.meta?.['code']).toBe('MIGRATION.PATH_UNREACHABLE');
    expect(envelope.fix).toContain(
      `prisma-next migration plan --from ${fromHash} --to ${targetHash}`,
    );
    expect(envelope.fix).toContain('prisma-next migration list');
    expect(envelope.fix).toContain('prisma-next migration show');
  });

  it('omits the --from clause when the runner kind is neverPlanned (no fromHash in meta)', () => {
    const failure: MigrationApplyFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'No on-disk migrations for contract space "app"',
      why: 'migrate is replay-only.',
      meta: { spaceId: 'app', kind: 'neverPlanned', target: targetHash },
    };
    const envelope = errorPathUnreachable(failure).toEnvelope();
    expect(envelope.fix).toContain(`prisma-next migration plan --to ${targetHash}`);
    expect(envelope.fix).not.toContain('--from');
    expect(envelope.fix).not.toContain('<unknown>');
  });

  it('falls back to a bare `migration plan` suggestion when both hashes are absent', () => {
    const failure: MigrationApplyFailure = {
      code: 'MIGRATION_PATH_NOT_FOUND',
      summary: 'Migration runner reported an unreachable target',
      why: 'No detail available.',
      meta: { spaceId: 'app' },
    };
    const envelope = errorPathUnreachable(failure).toEnvelope();
    expect(envelope.fix).toContain(
      'Run `prisma-next migration plan` to introduce the missing path.',
    );
    expect(envelope.fix).not.toContain('--from');
    expect(envelope.fix).not.toContain('--to');
    expect(envelope.fix).not.toContain('<unknown>');
  });
});
