import { describe, expect, it } from 'vitest';
import { postgresColumnsCompatible } from '../src/core/column-type-compatibility';

describe('postgresColumnsCompatible', () => {
  it('treats identical types as compatible', () => {
    expect(postgresColumnsCompatible('text', 'text')).toBe(true);
    expect(postgresColumnsCompatible('int4', 'int4')).toBe(true);
    expect(postgresColumnsCompatible('character varying(255)', 'character varying(255)')).toBe(
      true,
    );
  });

  it('treats a non-identical, non-listed pair as incompatible', () => {
    expect(postgresColumnsCompatible('character varying(255)', 'text')).toBe(false);
    expect(postgresColumnsCompatible('int4', 'int8')).toBe(false);
    expect(postgresColumnsCompatible('text', 'varchar')).toBe(false);
  });
});
