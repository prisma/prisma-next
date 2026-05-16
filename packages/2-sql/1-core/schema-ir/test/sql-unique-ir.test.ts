import { describe, expect, it } from 'vitest';

import { SqlUniqueIR } from '../src/ir/sql-unique-ir';

describe('SqlUniqueIR', () => {
  it('does not alias caller-owned column arrays', () => {
    const columns: string[] = ['a', 'b'];
    const unique = new SqlUniqueIR({ columns });
    columns.push('c');
    expect(unique.columns).toEqual(['a', 'b']);
  });
});
