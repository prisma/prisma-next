import { describe, expect, it } from 'vitest';
import {
  errorFamilyReadMarkerSqlRequired,
  errorQueryRunnerFactoryRequired,
} from '../src/utils/cli-errors';

describe('CliStructuredError.toEnvelope()', () => {
  it('converts queryRunnerFactory error to envelope with PN-CLI-4006', () => {
    const error = errorQueryRunnerFactoryRequired();
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('PN-CLI-4006');
    expect(envelope.exitCode).toBe(2);
    expect(envelope.summary).toBe('Query runner factory is required');
    expect(envelope.fix).toBe('Add db.queryRunnerFactory to prisma-next.config.ts');
    expect(envelope.docsUrl).toBe('https://prisma-next.dev/docs/cli/db-verify');
  });

  it('converts readMarkerSql error to envelope with PN-CLI-4007', () => {
    const error = errorFamilyReadMarkerSqlRequired();
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('PN-CLI-4007');
    expect(envelope.exitCode).toBe(2);
    expect(envelope.summary).toBe('Family readMarkerSql() is required');
    expect(envelope.fix).toBe(
      'Ensure family.verify.readMarkerSql() is exported by your family package',
    );
    expect(envelope.docsUrl).toBe('https://prisma-next.dev/docs/cli/db-verify');
  });
});
