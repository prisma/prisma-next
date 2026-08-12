import { describe, expect, it, vi } from 'vitest';
import { findLeaks, isLeak, runCheck } from './check-publish-deps.mjs';

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

describe('runCheck', () => {
  function makeIo(overrides = {}) {
    const rm = vi.fn();
    return {
      rm,
      io: {
        listPublishablePackageDirs: () => [],
        mkdtemp: () => '/tmp/pn-publish-check-fake',
        rm,
        readdirSync: () => [],
        readPackageJson: () => ({ name: '@scope/x', version: '1.0.0' }),
        readPackedManifest: () => ({}),
        packAll: () => 0,
        stdoutWrite: () => {},
        stderrWrite: () => {},
        ...overrides,
      },
    };
  }

  it('removes the tmpdir even when packAll fails (acceptance: failure-path cleanup)', () => {
    const { io, rm } = makeIo({ packAll: () => 2 });
    const exit = runCheck({ argv: [], io });
    expect(exit).toBe(2);
    expect(rm).toHaveBeenCalledWith('/tmp/pn-publish-check-fake');
  });

  it('removes the tmpdir even when scanning throws (defence in depth)', () => {
    const { io, rm } = makeIo({
      readdirSync: () => {
        throw new Error('scan exploded');
      },
    });
    expect(() => runCheck({ argv: [], io })).toThrow('scan exploded');
    expect(rm).toHaveBeenCalledWith('/tmp/pn-publish-check-fake');
  });

  it('returns 0 and removes the tmpdir on a clean run', () => {
    const { io, rm } = makeIo();
    expect(runCheck({ argv: [], io })).toBe(0);
    expect(rm).toHaveBeenCalledTimes(1);
  });

  it('returns 1 when offenders are found and still removes the tmpdir', () => {
    const { io, rm } = makeIo({
      listPublishablePackageDirs: () => ['packages/foo'],
      readdirSync: () => ['scope-foo-1.0.0.tgz'],
      readPackageJson: () => ({ name: '@scope/foo', version: '1.0.0' }),
      readPackedManifest: () => ({
        dependencies: { bad: 'workspace:*' },
      }),
    });
    expect(runCheck({ argv: [], io })).toBe(1);
    expect(rm).toHaveBeenCalledTimes(1);
  });

  it('emits structured JSON when --json is passed', () => {
    const stdoutWrite = vi.fn();
    const { io, rm } = makeIo({
      listPublishablePackageDirs: () => ['packages/foo'],
      readdirSync: () => ['scope-foo-1.0.0.tgz'],
      readPackageJson: () => ({ name: '@scope/foo', version: '1.0.0' }),
      readPackedManifest: () => ({
        dependencies: { bad: 'workspace:*' },
      }),
      stdoutWrite,
    });

    expect(runCheck({ argv: ['--json'], io })).toBe(1);
    expect(stdoutWrite).toHaveBeenCalledTimes(1);

    const payload = JSON.parse(stdoutWrite.mock.calls[0][0]);
    expect(payload.ok).toBe(false);
    expect(payload.offenders).toHaveLength(1);
    expect(payload.offenders[0]).toMatchObject({
      pkg: '@scope/foo',
      tarball: 'scope-foo-1.0.0.tgz',
      leaks: [{ field: 'dependencies', name: 'bad', spec: 'workspace:*' }],
    });
    expect(rm).toHaveBeenCalledTimes(1);
  });
});
