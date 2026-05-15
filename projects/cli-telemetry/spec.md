# Summary

Add lightweight, anonymous CLI usage telemetry to Prisma Next so the team can track adoption (MAU) and answer downstream product questions (runtime/target distribution, agent vs human, extension usage). Telemetry runs in a detached subprocess spawned at command start, never blocks or delays the CLI, collects no PII, is off by default, and is gated on explicit per-user opt-in via the interactive `prisma-next init` consent prompt; two env-var opt-outs (`PRISMA_NEXT_DISABLE_TELEMETRY`, `DO_NOT_TRACK`) and a per-user config file (`enableTelemetry` field) are the runtime gates. Error/crash reporting is in scope for the project but deferred to Phase 2 because its isolation contract and sensitive-data surface differ from telemetry's.

# Context

## At a glance

Telemetry is off by default; the user explicitly enables it during the interactive `prisma-next init` consent prompt, and the answer is persisted to a per-user JSON config file at `$XDG_CONFIG_HOME/prisma-next/config.json`. When enabled, the parent process forks a detached child at command **start** (not at exit) and continues with its real work in parallel. The child collects system metadata, reads what it needs from the project (TS version from `package.json`), and POSTs a small JSON event to the telemetry backend. The parent never blocks on the child; if the child fails for any reason, the user never sees it.

```text
┌───────────────────────────────────────────────────┐
│  prisma-next migration-new --name=foo --dry-run   │
└──────────────────────────┬────────────────────────┘
                           │ argv parsed → telemetry hook fires
                           ├──────────────────────────┐
                           │                          │ child.send(payload)
                           │                          ▼
                           │            ┌──────────────────────────┐
                           │            │ detached child (fork())  │
                           │            │  - probes system         │
                           │            │  - reads TS version      │
                           │            │  - POSTs to backend      │
                           │            │  - swallows all errors   │
                           │            └────────────┬─────────────┘
                           │                         │ HTTPS POST
                           │                         ▼
                           │            ┌──────────────────────────┐
                           │            │ telemetry-backend (Bun)  │
                           │            │ uses Prisma Next to      │
                           │            │ INSERT into Postgres     │
                           │            └──────────────────────────┘
                           │
                           ▼ parent continues with migration-new — never blocks
```

_Illustrative event shape — exact field names and schema details are plan-phase concerns:_

```ts
interface TelemetryEvent {
  installationId: string;        // random UUID stored in $XDG_CONFIG_HOME/prisma-next/config.json
  version: string;               // Prisma Next version, from this package's package.json
  command: string;               // 'migration-new'
  flags: string[];               // ['name', 'dry-run'] — names only, never values
  runtime: { name: 'node' | 'bun' | 'deno'; version: string };
  os: 'darwin' | 'linux' | 'win32' | string;
  arch: 'arm64' | 'x64' | string;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | null;
  databaseTarget: string;        // config.target.targetId, e.g. 'postgres'
  tsVersion: string | null;      // from project package.json; null if unavailable
  agent: string | null;          // 'Claude Code' | 'Cursor' | ... | null
  extensions: string[];          // declared IDs from config.extensionPacks, e.g. ['pgvector']
  // ingestion timestamp is added server-side; no client clock
}
```

## Problem

There is no CLI telemetry in Prisma Next today. The runtime SPI defines a `RuntimeTelemetryEvent` interface at `packages/2-sql/5-runtime/src/runtime-spi.ts`, but that's a query-execution observability hook for internal SPI consumers — it does not phone home and does not answer product-level questions about adoption or feature usage. The only CI-environment detection in the codebase is a single `process.env.CI` check at `packages/1-framework/3-tooling/cli/src/utils/global-flags.ts:74`, used to disable terminal colour; it misses Buildkite, Drone, Jenkins, Bitbucket Pipelines, Azure Pipelines, AWS CodeBuild and other providers that don't set `CI=true`.

Without CLI telemetry the team cannot answer the EA-stage load-bearing question — *how many people are using Prisma Next?* — nor downstream product questions (drop Node 24?, Bun/Deno adoption?, first-party vs community target maintenance?, agent vs human CLI usage?). Shipping the EA milestone with no observability of adoption forces decisions to be made on community-anecdote rather than data.

The privacy / trust framing is non-trivial. OSS data tooling has a recurring failure mode where opt-outable-but-undisclosed telemetry produces backlash threads months after launch. The design must therefore (a) collect strictly the minimum useful, (b) never transmit identifying values (including via stack traces or unsanitised CLI flag values), (c) disclose collection at first-run, (d) provide multiple opt-out paths, (e) honour the community-standard `DO_NOT_TRACK=1` env var, and (f) be implementable in a way that single-instance failures of the telemetry path cannot affect CLI UX.

## Approach

A **detached-subprocess** model decouples the telemetry path from the CLI lifecycle by construction. The parent process collects only what it has naturally in hand (parsed command, flag names, already-loaded config) and forks a child via `child_process.fork()` immediately after argument parsing. The child inherits the parent's runtime (Node, Bun, or Deno) — same-runtime is a correctness requirement, not a stylistic one, because Bun users frequently don't have Node installed. The parent sends a payload to the child over IPC, calls `disconnect()` and `unref()`, and continues with its real work. The child does any work that requires I/O — system probes, the project `package.json` read for TS version, the HTTPS POST — and exits when finished. All errors in the child are swallowed; nothing is ever written to the parent's stderr.

A per-user JSON config file at `$XDG_CONFIG_HOME/prisma-next/config.json` on Unix (defaulting to `~/.config/...` when the env var is unset, per the XDG Base Directory Specification) — and the platform-equivalent path under `%APPDATA%` on Windows — stores both the opt-in marker (`enableTelemetry: boolean`) and the per-installation random UUID (`installationId: string`). The UUID is the dedup key for MAU; it is generated together with the first persist of `enableTelemetry: true`, is never derived from any system identifier, and is never rotated. Consent and identifier live in one file so that env-var opt-out doesn't have to mutate disk state, and so an opt-in → stored-opt-out → opt-in cycle returns the same UUID (correct for MAU continuity). The CLI never deletes or rotates this file in response to a settings change.

Disclosure happens through the interactive `prisma-next init` flow. As the last question of the prompt sequence, `init` asks the user whether to enable anonymous usage telemetry; the answer is persisted to `config.json` as `enableTelemetry: true | false`. The prompt is only shown when `enableTelemetry` is currently undefined (file missing or field absent) and `init` is running interactively (not under `--yes` auto-accept and not in a non-TTY environment). Until the user has answered explicitly, telemetry stays **off by default**; the CLI never collects data without prior disclosure. Two env-var opt-out signals override the stored preference at runtime: `PRISMA_NEXT_DISABLE_TELEMETRY` (project-specific) and `DO_NOT_TRACK=1` (community convention). Telemetry is intentionally a per-user choice, never per-project: there is no `prisma-next.config.ts` option, because one developer enabling telemetry should not enrol their teammates. CI detection is replaced wholesale by the `ci-info` package, exposed as a single `isCI()` helper that the existing colour-output check also adopts; CI environments never emit telemetry and never see the init consent prompt.

The telemetry backend is a Bun service deployed to Prisma Compute that uses Prisma Next itself to INSERT events into Postgres. This is a deliberate dogfooding choice. The architectural framing that makes it safe: the **network API** between CLI and backend is the stable contract (backward compatible across all client versions); backend internals are opaque to clients. Backend and Prisma Next are tightly version-coupled by construction, and that coupling produces a useful side effect: every Prisma Next release is smoke-tested against the backend before being published. The backend lives outside the `framework` domain boundary in `architecture.config.json` (it consumes the full product including SQL lane, runtime, adapters), so two packages: a **client** under `packages/1-framework/3-tooling/` and a **backend service** under a top-level apps directory.

The project ships in two phases. **Phase 1** (this v1 implementation) is CLI telemetry as described. **Phase 2** is error/crash reporting, deferred because its isolation contract (synchronous flush before exit, the opposite of telemetry's fire-and-forget), its sensitive-data surface (stack traces with `/Users/<username>/...` paths, env-var values, error message strings), and its consent shape (a user might accept crash reports but not usage telemetry, or vice versa) all differ enough that coupling them in the same PR would lock in design assumptions that are wrong for at least one of them.

# Requirements

## Functional Requirements

### Telemetry client (Phase 1)

- **FR1.** A per-user JSON config file is stored at a stable config-directory path. On Unix this resolves to `$XDG_CONFIG_HOME/prisma-next/config.json` (with `$XDG_CONFIG_HOME` defaulting to `$HOME/.config` when unset, per the XDG Base Directory Specification); on Windows the equivalent path under `%APPDATA%`. The file holds an `enableTelemetry: boolean` consent field and an `installationId: string` v4 random UUID. Both fields are persisted together the first time `enableTelemetry: true` is written (typically from the `init` consent prompt's affirmative answer). The UUID is the dedup key for MAU and is not derived from any system identifier. Readers tolerate unknown fields for forward compatibility; writers preserve them when merging.
- **FR2.** When telemetry is gated off (see FR3) no event is sent and the telemetry subprocess is not spawned. The CLI never deletes, rotates, or implicitly mutates the user-level config file in response to env-var-driven opt-out; the file is mutated only on explicit user-initiated actions (the `init` consent prompt, or a user manually editing the file).
- **FR3.** Telemetry is gated by three signals, evaluated in this order: (a) **env-var override** — if `PRISMA_NEXT_DISABLE_TELEMETRY` (any truthy value) or `DO_NOT_TRACK=1` is set in the environment, telemetry is disabled regardless of the stored preference; (b) **stored preference** — `enableTelemetry: false` in `$XDG_CONFIG_HOME/prisma-next/config.json` disables telemetry; (c) **default-off when undefined** — if the file does not exist or `enableTelemetry` is undefined (the user has not been asked, or skipped the prompt), telemetry is disabled. Telemetry is enabled only when no env-var override is active **and** the file's `enableTelemetry` is explicitly `true`. There is intentionally no per-project (`prisma-next.config.ts`) opt-in/-out: telemetry is a per-user choice.
- **FR4.** The disclosure-and-consent surface is the interactive `prisma-next init` prompt. After the existing init questions (target, authoring, schema path, optional `.env` write, optional facade-removal on re-init), `init` adds a final `clack.confirm` prompt asking the user whether to enable anonymous usage telemetry. The prompt appears iff (i) the resolved value of `enableTelemetry` in the user-level config file is undefined (file missing or field absent), (ii) `init` is in interactive mode (`canPrompt === true`), and (iii) `--yes` is not auto-accepting prompts (consent must be a deliberate keystroke, not a side effect of automation). Proposed wording (refine at implementation time): _"Help us prioritize features by sharing anonymous usage data?"_ with a default of **Yes** (`initialValue: true`, matching ecosystem precedent in similar OSS tooling such as Next.js and Astro). The user's response is persisted to `config.json` as `enableTelemetry: true | false`; on an affirmative answer, the `installationId` UUID is generated and persisted in the same write. The prompt is never re-shown once `enableTelemetry` is set; changing the answer later requires editing the file (or, as a future improvement out of Phase 1 scope, a dedicated `prisma-next telemetry` command). No other CLI command shows a telemetry banner or prompt.
- **FR5.** CI environments do not emit telemetry. CI detection uses the `ci-info` npm package, exposed as a single `isCI()` helper. The existing `process.env.CI` check at `cli/src/utils/global-flags.ts:74` is replaced to use this helper.
- **FR6.** Each event carries the fields enumerated in the `At a glance` payload sketch: installation ID, product version (the version of this `prisma-next` package, transmitted as the bare `version` field — the surrounding payload context establishes which product it refers to, and the bare name is forward-compatible with future product renames), command name, flag names (no values, no positionals), runtime + version, OS, CPU architecture, package manager (derived from `npm_config_user_agent`), database target (from `config.target.targetId`), TypeScript version (from the project's `package.json` if readable; null on failure), agent identifier (best-effort from a known env-var allowlist; null on no match), the list of declared extension-pack IDs from the loaded config (a flat `string[]`; see FR10), and a server-side ingestion timestamp.
- **FR7.** Command sanitization rule: the parent contributes the command name and the set of flag names that were parsed by commander. Flag *values*, positional arguments, raw `argv`, and any unparsed/unknown tokens are never collected or transmitted.
- **FR8.** The telemetry path runs in a detached child process spawned via `child_process.fork()` (same-runtime guaranteed). The fork happens *at command start*, immediately after argument parsing and before main command execution begins. The parent sends the payload via IPC, calls `child.disconnect()` and `child.unref()`, then proceeds. The child does any required I/O (system probes, `package.json` read for TS version, HTTPS POST), swallows all errors, and exits.
- **FR9.** Agent detection uses an env-var allowlist of known AI-coding tools (starting from but improving on Prisma ORM's `detectAiAgent` — fixing the macOS-only CodexCLI check and normalising the comparison shape). If no marker is set, `agent` is `null`. The detector lives in the child process.
- **FR10.** The extensions field is a flat `string[]` containing the `.id` of each entry in the loaded config's `extensionPacks` (equivalent to the keys of `contract.extensionPacks`). These are author-declared component identifiers — distinct from the npm package name that publishes the extension — and are public, low-entropy strings (e.g. `'pgvector'`, `'paradedb'`); they are not sensitive. All declared extensions are reported regardless of first-party-vs-community status; any official-vs-community classification is performed downstream at analysis time. This avoids the stale-allowlist failure mode (a hardcoded client-side allowlist would ship out-of-date the moment the official set changes), preserves adoption signal for community packs, and keeps the client implementation a one-liner over `config.extensionPacks`.
- **FR11.** User-facing documentation describes: what fields are collected on the wire; the user-level config file location, structure, and how to edit `enableTelemetry`; the two env-var opt-out signals and the `enableTelemetry: false` stored signal; the `init` consent prompt (proposed wording, default value, when it appears, why it isn't re-shown); the default-off behaviour when `enableTelemetry` is undefined; the rationale for there being no per-project telemetry option; and the best-effort nature of agent detection.

### Telemetry backend (Phase 1)

- **FR12.** A single Bun service, deployed to Prisma Compute, receives events over HTTPS, validates them, and inserts them into Postgres using Prisma Next. The production URL is plan-phase; the default `*.prisma.build` URL Prisma Compute assigns is acceptable for the EA milestone.
- **FR13.** The backend's network API is backward-compatible with all released client versions. Unknown fields from newer clients are accepted (and ignored on older backend deployments); required fields missing from older clients are tolerated. The backend never returns a non-2xx for a well-formed event regardless of client version.
- **FR14.** The backend lives in a package outside the `framework` domain in `architecture.config.json`, sibling to other apps (suggested location `apps/telemetry-backend/` — exact path is plan-phase). The telemetry **client** lives inside `packages/1-framework/3-tooling/` (or a new subpackage there) and conforms to framework-domain dependency rules.
- **FR16.** The backend Postgres schema is authored as a Prisma Next contract (the backend dogfoods Prisma Next for its own data layer per FR12). One model per accepted submission, fields matching the `TelemetryEvent` shape; indexes support the MAU and version-distribution queries the team will run against the data:

  ```prisma
  // use prisma-next

  model TelemetryEvent {
    id                         BigInt    @id @default(autoincrement())
    ingestedAt                 DateTime  @default(now())
    installationId             String
    version                    String
    command                    String
    flags                      String[]
    runtimeName                String
    runtimeVersion             String
    os                         String
    arch                       String
    packageManager             String?
    databaseTarget             String?
    tsVersion                  String?
    agent                      String?
    extensions                 String[]

    @@index([ingestedAt])
    @@index([installationId, ingestedAt])
    @@index([version])
    @@index([command])
    @@map("telemetry_event")
  }
  ```

### Phase 2 (in spec scope; deferred from Phase 1 implementation)

- **FR15.** Error/crash reporting is delivered as a separate PR with its own isolation contract, its own sensitive-data sanitization rules (stack traces, file paths, env-var values, message strings), and the option of a separate opt-out toggle distinct from telemetry. Specifics are not designed in this spec.

## Non-Functional Requirements

- **NFR1.** The telemetry path never blocks CLI exit. Time-to-exit for any CLI command must be indistinguishable (within measurement noise) between telemetry-enabled and telemetry-disabled runs.
- **NFR2.** The telemetry HTTPS POST has a hard timeout of 1–2 seconds. After timeout, the child aborts and exits without retry.
- **NFR3.** No telemetry-originating output is ever written to the parent's stdout or stderr in normal operation. Debug logging is gated behind `PRISMA_NEXT_DEBUG=1` only.
- **NFR4.** No PII is collected. No IP-derived geographic data, no hostname, no username, no file paths from user input, no flag values, no positional arguments. The installation UUID is random — not derived from MAC address, machine ID, hostname, or any other system identifier.
- **NFR5.** Telemetry failure modes (no network, slow DNS, corporate proxy, backend down, malformed response) must not affect the CLI's exit code, output, or perceived performance.
- **NFR6.** Events that fail to send are lost. No on-disk queueing, no retries, no resumable state. The system is robust to bounded loss at MAU granularity.
- **NFR7.** Test runs short-circuit the telemetry path entirely (no fork, no events) by setting `PRISMA_NEXT_DISABLE_TELEMETRY=1` once at test-harness setup, reusing the standard opt-out mechanism rather than introducing a test-only env var.
- **NFR8.** Agent detection is best-effort: false positives must be negligible (a marker present ⇒ confidently an agent); false negatives are expected and documented.

## Non-goals

- **Crash/error reporting in Phase 1.** Deferred to Phase 2.
- **System-derived machine fingerprints** (MAC hashes, `/etc/machine-id`, Windows MachineGuid, IORegistry UUIDs). The installation UUID is a random value, not a system identifier.
- **On-disk event queue / persistence / retry.** Bounded event loss is acceptable.
- **Reading project files in the parent process.** All such reads (TS version, etc.) happen in the child.
- **Locale, timezone, IP-derived country, hostname.** Excluded for privacy reasons.
- **Schema/model count or other project-size proxies in Phase 1.** Would require contract reads on the telemetry path; defer until specifically needed.
- **Client-side timestamps.** Server-side ingestion time is authoritative.
- **Per-flag value allowlist.** The "no values, ever" rule is intentionally rigid.
- **Inheriting Prisma ORM's `detectAiAgent` verbatim.** We borrow the precedent but fix its known issues at port time.
- **Per-project telemetry config in `prisma-next.config.ts`.** Telemetry is a per-user choice; a project-level toggle would let one developer enrol their teammates (or opt them out) without their knowledge.
- **First-run banner on arbitrary CLI commands.** Disclosure happens through the `init` consent prompt only; users who never run `init` stay in the default-off state and never see a telemetry-related stderr line. A future `prisma-next telemetry` subcommand for in-CLI inspect/toggle is possible but out of Phase 1 scope.

# Acceptance Criteria

- [ ] **AC1** (FR1, FR2, FR3, FR4, FR12) — On a fresh machine with no user-level config file: (a) running an arbitrary non-init CLI command (e.g. `prisma-next --help`) emits no telemetry event and does not create the config file (default-off until consent); (b) running `prisma-next init` interactively and answering yes to the telemetry prompt creates `config.json` with `enableTelemetry: true` and a v4 `installationId`, and the init run itself emits exactly one telemetry event observable in the backend; (c) subsequent CLI commands reuse the same `installationId` and emit one event each.
- [ ] **AC2** (FR2, FR3) — Each opt-out signal independently suppresses event emission: (i) `PRISMA_NEXT_DISABLE_TELEMETRY=1`, (ii) `DO_NOT_TRACK=1`, (iii) `enableTelemetry: false` in `$XDG_CONFIG_HOME/prisma-next/config.json`, (iv) `enableTelemetry` undefined / file missing (default-off). With an existing `config.json` whose `enableTelemetry` is `true`, setting either env var disables telemetry for that invocation without modifying the file on disk (byte-identical before and after).
- [ ] **AC3** (FR5) — In an environment where `ci-info` reports CI=true (verified by running under at least three different CI providers in fixtures or mocked env vars: GitHub Actions, Buildkite, Jenkins), no telemetry events are emitted.
- [ ] **AC4** (FR4) — On a fresh machine (no `config.json`), running `prisma-next init` interactively presents the telemetry consent prompt as the final question of the prompt sequence with a default of Yes; the user's answer is persisted to `config.json`. A subsequent `prisma-next init` run on the same machine does not re-show the prompt (because `enableTelemetry` is no longer undefined). Non-init CLI commands never show a telemetry banner or prompt. `init` run under `--yes` or in a non-interactive shell suppresses the prompt and leaves `enableTelemetry` undefined (still default-off).
- [ ] **AC5** (FR8, NFR1, NFR5) — A test that runs `prisma-next --help` with the telemetry backend unreachable (e.g. invalid DNS, blackhole IP) shows no perceptible runtime regression vs the same command with telemetry disabled; no stderr output from telemetry; exit code unaffected.
- [ ] **AC6** (FR8) — A command that intentionally crashes mid-execution still results in a telemetry event being recorded in the backend (because the fork happens at command start). The event has no outcome field (Phase 1 has no outcome-dependent fields).
- [ ] **AC7** (FR7) — Running a command with sensitive flag values (e.g. `--connection-string="postgres://user:pass@host"`, `--name="customer-acme-payments"`, `--config=/Users/alice/secrets/x.toml`) results in an event that contains the flag *names* but none of the values, paths, or positional arguments. Verified by inspecting the recorded event.
- [ ] **AC8** (NFR3) — Across all telemetry failure modes (no network, DNS timeout, 5xx from backend, malformed response), no telemetry-originating output appears on stdout or stderr in normal mode; output appears only under `PRISMA_NEXT_DEBUG=1`.
- [ ] **AC9** (FR5) — The single consolidated `isCI()` helper drives both telemetry-skip decisions and the existing colour-output check at `cli/src/utils/global-flags.ts:74`. No parallel CI-detection logic exists in the codebase after the change.
- [ ] **AC10** (FR6, FR10) — A run with N extensions declared in `prisma-next.config.ts`'s `extensionPacks` (mixing first-party and user-authored packs) produces an event whose `extensions` field is a `string[]` of length N containing each declared `.id`. No official/third-party split, no allowlist filtering, no count-only fallback; community-pack IDs are reported verbatim.
- [ ] **AC11** (FR9, NFR8) — Setting one of the known agent env vars (`CLAUDECODE=1`, `CURSOR_AGENT=1`, etc.) results in an event whose `agent` field is the corresponding agent name. With no marker set, `agent` is `null`.
- [ ] **AC12** (FR13) — The backend accepts and stores events from a client that sends a superset of fields (forward compat) and from a client that omits non-critical fields (backward compat). Both round-trip cleanly without 4xx/5xx.
- [ ] **AC13** (NFR4) — A manual code-review pass over the client confirms no field derived from MAC address, machine ID, hostname, username, IP, or any system identifier is collected or transmitted.

# Other Considerations

## Security

The telemetry endpoint is internet-facing, unauthenticated (events are anonymous by design), and rate-limited at the backend to mitigate abuse. The client uses HTTPS only. The installation UUID is a v4 random value with no derivation from system state, so it cannot serve as a tracking identifier across product surfaces or correlate with external systems. The backend stores events in Postgres with no join key to any identity system. Access to raw event data on the backend is restricted to the product team; aggregated metrics may be more broadly shared.

## Cost

EA-stage volume is expected to be low (tens to hundreds of events per day initially). At that volume the backend operating cost is order-of-magnitude $10s/month. Scales linearly with adoption; a 100× growth would still sit comfortably under $1000/month given the simplicity of the storage layer (single Postgres table with periodic aggregation).

## Observability

The team-facing observability story is *the project itself* — telemetry is the observability mechanism for Prisma Next adoption. Internal observability of the telemetry backend itself (ingestion rate, latency, error rate, anomaly detection for sudden drops or spikes) is standard service operability and deferred to the plan.

## Data Protection

No personal data is collected — see NFR4 and AC13. The installation UUID is not a personal identifier (it identifies an installation, not a user, and is resettable by deleting one file). No GDPR DPIA is required because no personal data is processed; this conclusion should be reviewed by legal before EA launch. Raw event retention is **indefinite for now** — the data volume at EA scale is low enough that storage cost is not a forcing function, and richer historical context is more valuable than a retention horizon. The policy is revisitable if storage growth becomes a concern or if legal review surfaces a reason to bound it.

## Analytics

This entire project *is* the analytics implementation. See the field list in `At a glance` for the events shipped in Phase 1. Phase 2 adds crash events with a separate shape.

# References

- CLI package: `packages/1-framework/3-tooling/cli/` — entry at `src/cli.ts`, config loader at `src/config-loader.ts`, current CI check at `src/utils/global-flags.ts:74`.
- Config types: `packages/1-framework/1-core/config/src/config-types.ts` — `PrismaNextConfig.target.targetId` is the source of the database-target field.
- Runtime telemetry (separate, not this project): `packages/2-sql/5-runtime/src/runtime-spi.ts` — `RuntimeTelemetryEvent` is an internal SPI for query execution observability; out of scope.
- Architecture layering: `architecture.config.json` — defines the framework domain boundary the telemetry client must respect and outside which the backend must live.
- `ci-info` npm package — adopted for CI detection.
- Prisma ORM precedent: `detectAiAgent` helper as discussed (improvements will be backported to Prisma ORM).
- DO_NOT_TRACK convention: https://consoledonottrack.com — community standard for opt-out signalling.
- [ADR 216 — CLI telemetry installation ID is a stored random UUID, not a system fingerprint](../../docs/architecture%20docs/adrs/ADR%20216%20-%20CLI%20telemetry%20installation%20ID%20is%20a%20stored%20random%20UUID%20not%20a%20system%20fingerprint.md)
- [ADR 217 — CLI telemetry runs in a detached subprocess spawned at command start](../../docs/architecture%20docs/adrs/ADR%20217%20-%20CLI%20telemetry%20runs%20in%20a%20detached%20subprocess%20spawned%20at%20command%20start.md)

# Open Questions

- **OQ1.** Production telemetry endpoint URL on Prisma Compute. The EA milestone is fine with the default `*.prisma.build` URL assigned at deploy time; a stable vanity URL (e.g. `telemetry.prisma.io`) can be added later without client changes if backward compat is maintained.
- **OQ2.** Legal review of the "no DPIA needed" conclusion before EA launch. Not a design question; an operational checkpoint before going live.
