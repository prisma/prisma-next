## Slice 2 — TS Contract Loader and CLI Integration

### Objective

Implement TS-only contract loading and a CLI command that produces `contract.json` and `contract.d.ts` by invoking the Slice 1 emission pipeline. Avoid pulling the entire application source tree; enforce an import whitelist.

### Inputs

- TS contract entry module path (CLI flag)
- Adapter/pack manifests (see Slice 1) for canonicalization and types import info

### Outputs

- Emitted artifacts: `contract.json`, `contract.d.ts` (from Slice 1)
- Exit codes and diagnostics for CI

### Runner Approach (MVP)

- Use esbuild to bundle only the specified entry with an allowlist:
  - Allowed: `@prisma-next/*` packages; optionally expand later to a `./contract/**` subtree.
  - All other imports externalized/blocked.
- In a small Node process, dynamically import the bundle (ESM) and read the exported contract object.
- Validate it is pure JSON-serializable data; canonicalize via Slice 1 and write artifacts.

### CLI Surface (initial)

- `prisma-next emit --contract <path/to/contract.ts> --out <dir> [--target postgres]`
  - Loads TS contract via the loader, runs Slice 1, writes artifacts to `--out`.
  - Optionally prints `coreHash`/`profileHash`.

### Policies

- Import whitelist (MVP): only `@prisma-next/*` packages are allowed from the contract entry. Deny others by default. Expand later.
- No extra `contract.meta.json` for now.

### TDD & Tests

- Unit:
  - Loader: enforces allowlist; rejects disallowed imports; errors on non-serializable exports.
  - CLI flags: required flags validated; helpful errors.
- Integration:
  - Load a minimal TS contract → emit → consume with lanes (`LaneCodecTypes`) → build/execute plan; assert parity with an equivalent emit path.
  - CI task to run both TS-only and emit-path suites.

### Acceptance Criteria

- CLI emits canonical `contract.json` and `contract.d.ts` from TS input without importing app code.
- Enforced import allowlist with clear diagnostics.
- Artifacts identical (modulo hashes) to those produced when starting from the same IR.

### Open Questions

1) TS contract entry default path and CLI flag names (confirm `--contract`, `--out`).
2) Do we need a watch mode (dev) now, or only a one-shot CLI for MVP?


