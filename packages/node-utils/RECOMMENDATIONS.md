# Recommendations

## Observations
- `src/fs.ts` only exposes synchronous helpers and wraps errors in plain `Error`, so consumers cannot distinguish ENOENT vs syntax errors.
- No tests cover malformed JSON, permission failures, or path resolution edge cases.

## Suggested Actions
- Add async variants (promisified fs) and return structured error objects so CLI/runtime code can react appropriately.
- Write tests covering malformed JSON, permission errors, and relative path resolution.

