import { describe, expect, it } from 'vitest';
import { findLeaks, isLeak } from './check-publish-deps.mjs';

describe('isLeak', () => {
  it('flags workspace:* specifiers', () => {
    expect(isLeak('workspace:*')).toBe(true);
    expect(isLeak('workspace:^1.2.3')).toBe(true);
  });

  it('flags catalog: specifiers (named and default)', () => {
    expect(isLeak('catalog:')).toBe(true);
    expect(isLeak('catalog:default')).toBe(true);
    expect(isLeak('catalog:react18')).toBe(true);
  });

  it('does not flag real version ranges or git/file/npm specifiers', () => {
    expect(isLeak('^1.2.3')).toBe(false);
    expect(isLeak('1.2.3')).toBe(false);
    expect(isLeak('~1.2.0')).toBe(false);
    expect(isLeak('npm:foo@^1.0.0')).toBe(false);
    expect(isLeak('git+https://github.com/foo/bar.git')).toBe(false);
    expect(isLeak('file:../local')).toBe(false);
  });

  it('returns false for non-strings (null/undefined/number/object)', () => {
    expect(isLeak(undefined)).toBe(false);
    expect(isLeak(null)).toBe(false);
    expect(isLeak(0)).toBe(false);
    expect(isLeak({})).toBe(false);
  });
});

describe('findLeaks', () => {
  it('returns an empty array for a clean manifest', () => {
    expect(
      findLeaks({
        name: '@scope/clean',
        version: '1.0.0',
        dependencies: { foo: '^1.0.0', bar: '~2.1.3' },
      }),
    ).toEqual([]);
  });

  it('returns one leak per offender, tagging the field it came from', () => {
    const leaks = findLeaks({
      name: '@scope/dirty',
      version: '1.0.0',
      dependencies: {
        clean: '^1.0.0',
        leaky: 'workspace:*',
      },
      devDependencies: {
        catty: 'catalog:',
      },
    });
    expect(leaks).toEqual([
      { field: 'dependencies', name: 'leaky', spec: 'workspace:*' },
      { field: 'devDependencies', name: 'catty', spec: 'catalog:' },
    ]);
  });

  it('walks all four pnpm dependency fields', () => {
    const leaks = findLeaks({
      dependencies: { a: 'workspace:*' },
      devDependencies: { b: 'workspace:^1.0.0' },
      peerDependencies: { c: 'catalog:' },
      optionalDependencies: { d: 'catalog:vendored' },
    });
    expect(leaks.map((l) => l.field).sort()).toEqual([
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]);
  });

  it('ignores unknown dependency-shaped fields (resolutions, overrides) by design', () => {
    const leaks = findLeaks({
      dependencies: { clean: '^1.0.0' },
      resolutions: { 'something/else': 'workspace:*' },
      overrides: { 'foo/bar': 'catalog:' },
    });
    expect(leaks).toEqual([]);
  });

  it('tolerates a malformed manifest without throwing', () => {
    expect(findLeaks({})).toEqual([]);
    expect(findLeaks({ dependencies: null })).toEqual([]);
    expect(findLeaks({ dependencies: 'not-an-object' })).toEqual([]);
  });

  it('preserves enumeration order within a field (deterministic CI output)', () => {
    const leaks = findLeaks({
      dependencies: {
        first: 'workspace:*',
        clean: '^1.0.0',
        second: 'catalog:',
      },
    });
    expect(leaks.map((l) => l.name)).toEqual(['first', 'second']);
  });
});
