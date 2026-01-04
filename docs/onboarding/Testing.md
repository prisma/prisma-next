# Testing

- Core guide: `docs/Testing Guide.md`
- Language: `.cursor/rules/omit-should-in-tests.mdc`
- Patterns: `.cursor/rules/vitest-expect-typeof.mdc`, `.cursor/rules/test-file-organization.mdc`, `.cursor/rules/test-import-patterns.mdc`

## Test Commands

```bash
pnpm test:packages      # Unit tests for packages only
pnpm test:integration   # Integration tests
pnpm test:e2e           # End-to-end tests
pnpm test:all           # All tests (packages + examples + integration + e2e)
pnpm coverage:packages  # Coverage for packages only
```

## CI

CI runs on pull requests via GitHub Actions (`.github/workflows/ci.yml`):

- **typecheck** + **lint**: Run in parallel, no dependencies
- **build**: Compiles all packages
- **test** + **test-e2e**: Run after build, require Postgres service
- **coverage**: Generates coverage reports, uploaded as artifacts

Environment: Node 24, pnpm 10, Postgres 15. `TEST_TIMEOUT_MULTIPLIER=2` in CI.
