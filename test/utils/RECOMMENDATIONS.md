# Recommendations

## Observations
- The package currently exposes dev database helpers, async iterable collectors, and timeouts, but other suites still re-implement runtime/context adapters because this package has no adapters or runtime builders.
- There are no tests in the package verifying the helpers remain ESM-compatible, even though they are imported from both CJS/Vite and Vitest contexts.
- Utility documentation doesn't describe when to reach for these helpers versus the runtime-specific utilities in `@prisma-next/runtime/test/utils` or contract helpers elsewhere.

## Suggested Actions
- Add reusable helpers for creating runtime contexts/adapters so integration and e2e suites can share the same boilerplate instead of duplicating it in every test.
- Add Vitest tests that import the helpers via the package's own compiled entrypoints (e.g., `dist/exports/index.d.ts`) to ensure the helpers remain usable in ESM contexts.
- Expand the README with clear guidance on when to use these utilities versus the runtime- or contract-specific test utils scattered elsewhere.

## Vitest Import Pattern (Critical)

**When adding new test utilities that import `vitest` directly:**

1. **Do NOT re-export from main index**: Utilities that import `vitest` must NOT be exported from `src/exports/index.ts` to avoid circular dependencies when Vitest loads config files.

2. **Create separate export path**: Add a dedicated export path in `package.json`:
   ```json
   {
     "exports": {
       "./new-utility": {
         "types": "./dist/exports/new-utility.d.ts",
         "import": "./dist/exports/new-utility.js"
       }
     }
   }
   ```

3. **Add to build config**: Add as a separate entry point in `tsup.config.ts`:
   ```typescript
   entry: {
     'new-utility': 'src/new-utility.ts',
   },
   external: ['vitest', ...], // Ensure vitest is marked as external
   ```

4. **Document the pattern**: Update README.md to explain why the utility uses a separate export path.

**Why this matters:**
- Vitest config files import from `@prisma-next/test-utils` (main export)
- If the main export includes utilities that import `vitest`, it creates a circular dependency
- This causes "Vitest failed to access its internal state" errors
- Separate export paths allow config files to import non-vitest utilities while test files can import vitest-dependent utilities

**Examples:**
- ✅ `timeouts` - No vitest import, safe in main export
- ✅ `typed-expectations` - Imports vitest, uses separate export path
- ❌ Don't add `export * from '../typed-expectations'` to `src/exports/index.ts`
