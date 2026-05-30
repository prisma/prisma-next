import { describe, expect, it } from 'vitest';
import {
  createPreserveEmptyPredicate,
  matchesPathPattern,
  type PathPattern,
} from '../src/canonicalization-path-match';

describe('matchesPathPattern', () => {
  it('matches a literal path exactly', () => {
    const pattern = ['storage', 'namespaces'] as const satisfies PathPattern;
    expect(matchesPathPattern(['storage', 'namespaces'], pattern)).toBe(true);
    expect(matchesPathPattern(['storage', 'types'], pattern)).toBe(false);
  });

  it('matches a wildcard segment at any value', () => {
    const pattern = ['storage', 'namespaces', '*', 'tables'] as const satisfies PathPattern;
    expect(matchesPathPattern(['storage', 'namespaces', '__unbound__', 'tables'], pattern)).toBe(
      true,
    );
    expect(matchesPathPattern(['storage', 'namespaces', 'public', 'tables'], pattern)).toBe(true);
    expect(matchesPathPattern(['storage', 'namespaces', 'public', 'collections'], pattern)).toBe(
      false,
    );
  });

  it('rejects paths shorter or longer than the pattern', () => {
    const pattern = ['storage', 'namespaces', '*', 'tables'] as const satisfies PathPattern;
    expect(matchesPathPattern(['storage', 'namespaces'], pattern)).toBe(false);
    expect(matchesPathPattern(['storage', 'namespaces', 'a', 'tables', 'extra'], pattern)).toBe(
      false,
    );
  });

  it('matches an alternative segment list at one position', () => {
    const pattern = [
      'storage',
      'namespaces',
      '*',
      'tables',
      '*',
      ['uniques', 'indexes', 'foreignKeys'],
    ] as const satisfies PathPattern;
    expect(
      matchesPathPattern(['storage', 'namespaces', 'ns', 'tables', 'users', 'indexes'], pattern),
    ).toBe(true);
    expect(
      matchesPathPattern(['storage', 'namespaces', 'ns', 'tables', 'users', 'columns'], pattern),
    ).toBe(false);
  });
});

describe('createPreserveEmptyPredicate', () => {
  const sqlPatterns = [
    ['storage', 'namespaces', '*', 'tables'],
    ['storage', 'namespaces', '*', 'tables', '*'],
    ['storage', 'namespaces', '*', 'tables', '*', ['uniques', 'indexes', 'foreignKeys']],
    ['storage', 'namespaces', '*', 'tables', '*', 'foreignKeys', ['constraint', 'index']],
    ['storage', 'types', '*', 'typeParams'],
  ] as const satisfies readonly PathPattern[];

  const shouldPreserveEmpty = createPreserveEmptyPredicate(sqlPatterns);

  it('preserves namespace tables containers and entries', () => {
    expect(shouldPreserveEmpty(['storage', 'namespaces', '__unbound__', 'tables'])).toBe(true);
    expect(shouldPreserveEmpty(['storage', 'namespaces', '__unbound__', 'tables', 'users'])).toBe(
      true,
    );
  });

  it('preserves table uniques, indexes, and foreignKeys', () => {
    expect(shouldPreserveEmpty(['storage', 'namespaces', 'ns', 'tables', 'users', 'uniques'])).toBe(
      true,
    );
    expect(shouldPreserveEmpty(['storage', 'namespaces', 'ns', 'tables', 'users', 'indexes'])).toBe(
      true,
    );
    expect(
      shouldPreserveEmpty(['storage', 'namespaces', 'ns', 'tables', 'users', 'foreignKeys']),
    ).toBe(true);
  });

  it('preserves FK boolean fields in array-form foreignKeys', () => {
    expect(
      shouldPreserveEmpty([
        'storage',
        'namespaces',
        'ns',
        'tables',
        'posts',
        'foreignKeys',
        'constraint',
      ]),
    ).toBe(true);
    expect(
      shouldPreserveEmpty([
        'storage',
        'namespaces',
        'ns',
        'tables',
        'posts',
        'foreignKeys',
        'index',
      ]),
    ).toBe(true);
  });

  it('preserves storage.types typeParams', () => {
    expect(shouldPreserveEmpty(['storage', 'types', 'MyType', 'typeParams'])).toBe(true);
  });

  it('returns false for unrelated paths', () => {
    expect(shouldPreserveEmpty(['models'])).toBe(false);
    expect(shouldPreserveEmpty(['storage', 'namespaces', 'ns', 'collections'])).toBe(false);
  });
});
