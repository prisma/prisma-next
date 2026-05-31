# Known issues

## Upstream: `@cursor/sdk@1.0.15` ships unresolvable TypeScript types

**Status:** open upstream (Cursor SDK). Worked around here — see "Impact" below.
**Affected version:** `@cursor/sdk@1.0.15` (latest at time of writing).
**Where to file:** Cursor SDK has no public issue tracker — `@cursor/sdk`'s `package.json` names `repository: github.com/cursor/cursor` (Issues disabled) and no `bugs` URL. Report via the Cursor forum (<https://forum.cursor.com>) or your Cursor support channel.

### Summary

The published package runs (its runtime is bundled), but its published `.d.ts` files re-export from internal `@anysphere/*` packages that are **neither declared as dependencies nor published to npm**. Any TypeScript consumer that imports a type from `@cursor/sdk` gets unresolved-module / missing-member errors. In particular, `TurnEndedUpdate` — the documented carrier for per-turn token `usage` — is one of the unresolvable types.

### Reproduction

```bash
pnpm add -D @cursor/sdk            # installs 1.0.15
# probe.ts:
#   import { Agent } from '@cursor/sdk';
#   import type { TurnEndedUpdate } from '@cursor/sdk';
tsc --noEmit probe.ts              # nodenext resolution, skipLibCheck:false
```

### Evidence

1. **`@cursor/sdk`'s declared dependencies contain no `@anysphere/*` entry:**
   `@bufbuild/protobuf`, `@connectrpc/connect`, `@connectrpc/connect-node`, `@statsig/js-client`, `sqlite3`, `zod`.

2. **The published `.d.ts` files reference ~10 distinct `@anysphere/*` module paths**, e.g.:
   - `@anysphere/cursor-sdk-shared` (`/delta-types`, `/tool-call-types`, `/message-schemas`, `/core-adapter`)
   - `@anysphere/cursor-sdk-local-runtime` (`/run-store`)
   - `@anysphere/agent-kv`, `@anysphere/agent-client`, `@anysphere/analytics-client`, `@anysphere/context`
   - `@anysphere/proto/agent/v1/agent_pb.js`, `@anysphere/proto/aiserver/v1/privacy_mode_pb.js`

3. **Those packages are unpublished** — `pnpm view @anysphere/cursor-sdk-shared` and `pnpm view @anysphere/agent-kv` both return npm `E404`.

4. **`tsc` confirms the breakage** (representative, with `skipLibCheck:false`):
   - `TS2305: Module './types/delta-types.js' has no exported member 'TurnEndedUpdate'` (and every other delta-update type — the re-export from `@anysphere/cursor-sdk-shared/delta-types` resolves to nothing).
   - `TS2307: Cannot find module '@anysphere/agent-kv'`.
   - `TS2307: Cannot find module '@anysphere/proto/agent/v1/agent_pb.js'`.

   (`skipLibCheck:true` masks errors that live *inside* the SDK's own `.d.ts`, but does **not** rescue a consumer that names an affected type directly — e.g. `import type { TurnEndedUpdate }` — because the member genuinely does not resolve.)

### Suggested fix (upstream)

Ship self-contained declarations: either inline the `@anysphere/*` type sources into the published `dist/**/*.d.ts` (bundle the types, as the runtime is already bundled), or publish + declare the `@anysphere/*` packages as real dependencies.

### Impact on this harness

The token-usage signal this harness needs comes from `TurnEndedUpdate.usage`, which is exactly one of the unresolvable types. We therefore:

- import `@cursor/sdk` for its **runtime value** (`Agent`) only, never its broken type surface, and
- read the per-turn `usage` field through a small, explicitly-bounded structural view in `sdk-adapter.ts` (guarded at runtime; no bare casts) rather than a fabricated full mirror of the SDK's types.

When upstream ships resolvable types, replace that structural view with the real `TurnEndedUpdate` import and delete the workaround.

## 2. The local runtime emits no token-usage signal at all

Distinct from (and more fundamental than) the type-resolution gap above: even at **runtime**, the `@cursor/sdk` *local* runtime never emits a usage signal, so there is nothing to read regardless of types.

Confirmed by a probe (spike `projects/drive-judge-harness/spikes/2026-05-31-sdk-token-usage-retrieval.md`) against `@cursor/sdk@1.0.15`:

- The local `run.stream()` yields only `status` and `assistant` messages — **no `turnEnded`/`usage` event** (that update is streamed only by the *cloud* runtime).
- The `run.wait()` outcome (`{ id, status, result, model, durationMs }`) carries wall-clock but **no tokens**.
- The cloud `getRun → V1Run` (`{ id, agentId, status, createdAt, updatedAt, durationMs?, result?, git? }`), `RunResultMetadata`, and the `analytics` surface (emit-only `trackSdkRun*`; props carry `turn_count`/latency/`end_reason`) all carry **no token counts**.

### Impact on this harness

For local runs, `tokens` is `null` (with a manifest note), and **`wall_clock_ms` (the outcome's `durationMs`) is the primary efficiency metric.** `accumulateUsage` remains wired, so usage flows automatically if a cloud run (which does stream `turnEnded`) is used, or once a non-SDK local token source exists.

### Suggested fix (upstream)

Stream `turnEnded` (with `usage`) from the local runtime as the cloud runtime already does, or expose per-run token counts on the run outcome / a queryable usage API.
