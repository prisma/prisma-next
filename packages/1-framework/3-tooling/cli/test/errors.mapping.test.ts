import { describe, expect, it } from 'vitest';
import { errorDriverRequired, errorFamilyReadMarkerSqlRequired } from '../src/utils/cli-errors';

describe('CliStructuredError.toEnvelope()', () => {
  it('converts driver required error to envelope with PN-CLI-4010', () => {
    const error = errorDriverRequired();
    const envelope = error.toEnvelope();

    expect(envelope).toMatchObject({
      code: 'PN-CLI-4010',
      domain: 'CLI',
      summary: 'Driver is required for DB-connected commands',
      fix: 'Add a control-plane driver to prisma-next.config.ts (e.g. import a driver descriptor and set `driver: postgresDriver`)',
      docsUrl: 'https://prisma-next.dev/docs/cli/config',
    });
  });

  it('converts readMarker error to envelope with PN-CLI-4007', () => {
    const error = errorFamilyReadMarkerSqlRequired();
    const envelope = error.toEnvelope();

    expect(envelope).toMatchObject({
      code: 'PN-CLI-4007',
      domain: 'CLI',
      summary: 'Family readMarker() is required',
      fix: 'Ensure family.verify.readMarker() is exported by your family package',
      docsUrl: 'https://prisma-next.dev/docs/cli/db-verify',
    });
  });
});
