import { describe, expect, it } from 'vitest';
import { APP_SPACE_ID, readContractMarker } from '../src/sql-marker';

describe('readContractMarker', () => {
  it('binds the caller-supplied space id as the parameter', () => {
    const stmt = readContractMarker('cipherstash');
    expect(stmt.sql).toMatch(/where space = \$1/i);
    expect(stmt.params).toEqual(['cipherstash']);
  });

  it('binds APP_SPACE_ID when callers ask for the app marker explicitly', () => {
    const stmt = readContractMarker(APP_SPACE_ID);
    expect(stmt.params).toEqual([APP_SPACE_ID]);
  });
});
