import { describe, expect, it } from 'vitest';
import { errorPostgresMigrationStackMissing } from '../src/core/errors';

describe('errorPostgresMigrationStackMissing', () => {
  it('renders under the stable PN-MIG-2007 code', () => {
    expect(errorPostgresMigrationStackMissing('createTable').toEnvelope().code).toBe('PN-MIG-2007');
  });

  it('names the operation that failed in summary, why, and meta', () => {
    const envelope = errorPostgresMigrationStackMissing('dropColumn').toEnvelope();
    expect(envelope.summary).toContain('dropColumn');
    expect(envelope.why).toContain('dropColumn');
    expect(envelope.meta).toEqual({ operation: 'dropColumn' });
  });

  it('reports each operation distinctly rather than always naming one', () => {
    const createTable = errorPostgresMigrationStackMissing('createTable').toEnvelope().summary;
    const dropColumn = errorPostgresMigrationStackMissing('dropColumn').toEnvelope().summary;
    expect(createTable).not.toBe(dropColumn);
  });
});
