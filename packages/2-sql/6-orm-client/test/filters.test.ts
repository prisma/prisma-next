import { describe, expect, it } from 'vitest';
import { all, and, not, or } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { createTestContract } from './helpers';

describe('filters', () => {
  const contract = createTestContract();

  it('and() composes multiple expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = and(user['name']!.eq('Alice'), user['email']!.neq('bob@example.com'));

    expect(expr).toMatchObject({
      kind: 'and',
      exprs: [
        { kind: 'bin', op: 'eq' },
        { kind: 'bin', op: 'neq' },
      ],
    });
  });

  it('or() composes multiple expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = or(user['name']!.eq('Alice'), user['name']!.eq('Bob'));

    expect(expr).toMatchObject({
      kind: 'or',
      exprs: [
        { kind: 'bin', op: 'eq' },
        { kind: 'bin', op: 'eq' },
      ],
    });
  });

  it('not() negates binary expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = not(user['name']!.eq('Alice'));

    expect(expr).toMatchObject({
      kind: 'bin',
      op: 'neq',
      left: { kind: 'col', table: 'users', column: 'name' },
      right: { kind: 'literal', value: 'Alice' },
    });
  });

  it('not() applies De Morgan for and/or expressions', () => {
    const user = createModelAccessor(contract, 'User');
    const expr = not(
      and(user['name']!.eq('Alice'), or(user['email']!.eq('a'), user['email']!.eq('b'))),
    );

    expect(expr).toMatchObject({
      kind: 'or',
      exprs: [
        { kind: 'bin', op: 'neq' },
        {
          kind: 'and',
          exprs: [
            { kind: 'bin', op: 'neq' },
            { kind: 'bin', op: 'neq' },
          ],
        },
      ],
    });
  });

  it('all() returns a tautology sentinel expression', () => {
    expect(all()).toEqual({
      kind: 'and',
      exprs: [],
    });
  });
});
