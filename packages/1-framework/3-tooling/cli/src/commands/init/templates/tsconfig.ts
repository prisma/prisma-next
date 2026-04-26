/**
 * Compiler options the scaffolded `prisma-next.config.ts` and `db.ts` need
 * to typecheck:
 *
 * - `module: 'preserve'` + `moduleResolution: 'bundler'` align with how
 *   modern bundlers (and `tsdown`) consume our facade packages.
 * - `resolveJsonModule` lets `db.ts` import `contract.json with { type:
 *   'json' }` — the runtime path the facades document (FR4).
 *
 * `types: ['node']` is FR2.2 territory and lives in
 * `REQUIRED_COMPILER_OPTIONS_TYPES` because TS only honours an _array_
 * here, and a string-keyed merge would clobber any user-specified entries.
 * Merge handling preserves any extra `types` the user added.
 */
export const REQUIRED_COMPILER_OPTIONS: Record<string, string | boolean> = {
  module: 'preserve',
  moduleResolution: 'bundler',
  resolveJsonModule: true,
};

/**
 * Types that must be present in `compilerOptions.types` for the scaffold
 * to typecheck. With `moduleResolution: 'bundler'`, TypeScript does not
 * implicitly include all `@types/*` packages — `process.env` only resolves
 * when `node` is in this array (or `types` is omitted, but then any other
 * type listed here would force the same behaviour). Listing `node`
 * explicitly is the documented escape hatch (FR2.2).
 */
export const REQUIRED_COMPILER_OPTIONS_TYPES: readonly string[] = ['node'];

export function defaultTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        ...REQUIRED_COMPILER_OPTIONS,
        types: [...REQUIRED_COMPILER_OPTIONS_TYPES],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        outDir: 'dist',
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  );
}

export function mergeTsConfig(existing: string): string {
  const config = JSON.parse(existing) as Record<string, unknown>;
  const compilerOptions = (config['compilerOptions'] ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
    compilerOptions[key] = value;
  }

  compilerOptions['types'] = mergeTypesArray(compilerOptions['types']);

  config['compilerOptions'] = compilerOptions;
  return JSON.stringify(config, null, 2);
}

/**
 * Merges `REQUIRED_COMPILER_OPTIONS_TYPES` into the user's existing
 * `compilerOptions.types` array. Preserves order and dedupes. If the
 * user has no `types` array (or has set it to a non-array), we replace
 * with the required minimum — overwriting a non-array `types` is the
 * correct fix because anything other than a string array is invalid TS
 * config.
 */
function mergeTypesArray(existing: unknown): readonly string[] {
  const result: string[] = [];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string' && !result.includes(item)) {
        result.push(item);
      }
    }
  }
  for (const required of REQUIRED_COMPILER_OPTIONS_TYPES) {
    if (!result.includes(required)) {
      result.push(required);
    }
  }
  return result;
}
