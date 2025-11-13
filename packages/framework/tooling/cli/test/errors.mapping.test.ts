import { describe, expect, it } from 'vitest';
import { mapErrorToCliEnvelope } from '../src/utils/errors';

describe('mapErrorToCliEnvelope', () => {
  it('maps queryRunnerFactory error to PN-CLI-4006', () => {
    const error = new Error(
      'Config.db.queryRunnerFactory is required for db verify. Provide a factory function that returns a query runner.',
    );
    const envelope = mapErrorToCliEnvelope(error);

    expect(envelope.code).toBe('PN-CLI-4006');
    expect(envelope.exitCode).toBe(2);
    expect(envelope.summary).toBe('Query runner factory is required');
    expect(envelope.fix).toBe('Add db.queryRunnerFactory to prisma-next.config.ts');
    expect(envelope.docsUrl).toBe('https://prisma-next.dev/docs/cli/db-verify');
  });

  it('maps readMarkerSql error to PN-CLI-4007', () => {
    const error = new Error(
      'Family verify.readMarkerSql is required for db verify. The family must provide a readMarkerSql() function.',
    );
    const envelope = mapErrorToCliEnvelope(error);

    expect(envelope.code).toBe('PN-CLI-4007');
    expect(envelope.exitCode).toBe(2);
    expect(envelope.summary).toBe('Family readMarkerSql() is required');
    expect(envelope.fix).toBe(
      'Ensure family.verify.readMarkerSql() is exported by your family package',
    );
    expect(envelope.docsUrl).toBe('https://prisma-next.dev/docs/cli/db-verify');
  });
});
