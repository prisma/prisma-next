import { describe, expect, it } from 'vitest';
import { sqlContractCanonicalizationHooks } from '../src/canonicalization-hooks';

describe('sqlContractCanonicalizationHooks.shouldPreserveEmpty', () => {
  it('preserves a column default literal payload (false / empty-array defaults)', () => {
    // `{ kind: 'literal', value: false }` reaches the default-omission walk
    // as a default value; without this veto the emitted contract fails its
    // own validation on the next read (PN-CLI-4003 on Boolean @default(false)).
    expect(
      sqlContractCanonicalizationHooks.shouldPreserveEmpty([
        'storage',
        'namespaces',
        'unbound',
        'entries',
        'table',
        'task',
        'columns',
        'done',
        'default',
        'value',
      ]),
    ).toBe(true);
  });

  it('does not preserve arbitrary domain-side values', () => {
    expect(
      sqlContractCanonicalizationHooks.shouldPreserveEmpty([
        'domain',
        'namespaces',
        'unbound',
        'models',
        'Task',
        'fields',
        'done',
      ]),
    ).toBe(false);
  });
});
