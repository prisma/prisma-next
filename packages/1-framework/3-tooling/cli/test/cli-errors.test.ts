import { describe, expect, it } from 'vitest';
import { errorDriverRequired, errorFamilyReadMarkerSqlRequired } from '../src/utils/cli-errors';

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
