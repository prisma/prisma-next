// This module is intentionally pure. All npm/dist-tag I/O and filesystem
// reads live in the callers (`scripts/determine-version.ts`,
// `scripts/bump-minor.ts`); this file is reserved for deterministic
// helpers exercised under `node --test` from `pnpm test:scripts`.

const CANONICAL_BASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses a semver-shaped version string into its numeric components.
 * Tolerant of pre-release suffixes (`0.7.0-foo` parses the same as
 * `0.7.0`); strict on the leading `major.minor.patch` shape — anything
 * else returns NaN-bearing components.
 */
export function parseVersion(version: string): ParsedVersion {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  return { major, minor, patch };
}

/**
 * Given the current version, computes the next minor's zero-patch
 * form: `0.7.0` -> `0.8.0`, `1.2.5` -> `1.3.0`. Pure / deterministic.
 * Pre-release suffixes on the input are ignored (`0.7.0-foo` -> `0.8.0`).
 */
export function computeNextMinor(current: string): string {
  const { major, minor } = parseVersion(current);
  return `${major}.${minor + 1}.0`;
}

/**
 * Asserts that a base version is canonical (`major.minor.patch`, no
 * suffix). Used to fail-fast in the publish workflow if root
 * `package.json` was edited to something other than a clean release
 * shape — without this guard, a malformed root would compose nonsense
 * publish versions like `0.7.0-foo-dev.1`.
 */
export function assertCanonicalBase(base: string): void {
  if (!CANONICAL_BASE_PATTERN.test(base)) {
    throw new Error(
      `Base version "${base}" is not canonical major.minor.patch. ` +
        'The root package.json `version` must be a clean release shape (e.g. "0.7.0"); ' +
        'no pre-release suffixes are permitted on `main`.',
    );
  }
}
