import { describe, expect, it } from 'vitest';
import { mapRowToRecord } from '../src/core/row-mapper';

describe('mapRowToRecord', () => {
  it('skips undefined slots in the columns array (defensive branch)', () => {
    // PPG's typed contract says `columns` is a dense readonly array of
    // `{ name: string }`, but the helper carries a runtime guard for the
    // pathological case where the array carries an undefined slot (a sparse
    // array, or an upstream typing bug). Construct that case explicitly and
    // assert the undefined slot is skipped without producing a stray key.
    const columns = [{ name: 'a' }, undefined, { name: 'b' }] as ReadonlyArray<{ name: string }>;
    const ppgRow = { values: [1, 'middle', 3] };

    const record = mapRowToRecord<Record<string, unknown>>(ppgRow, columns);

    expect(record).toEqual({ a: 1, b: 3 });
    expect(Object.keys(record)).toEqual(['a', 'b']);
  });
});
