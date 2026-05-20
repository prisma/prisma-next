# AC13 — PII-zero audit checklist

> Manual code-review pass over the `@prisma-next/cli-telemetry` client and its CLI integration, signed off as part of the cli-telemetry close-out (M3.2).

## Subject under audit

- **Source under review:** the `cli-telemetry-m3` bookmark at commit `0b8a1ec8` (m3.1 docs commit), inclusive of all m3.0 testing-gap commits (`eaf1debb`, `45a79740`, `a5a58e6c`) and the underlying `main` baseline where the m2 epic-saga landed.
- **Files audited (full read):**
  - `packages/1-framework/3-tooling/cli-telemetry/src/payload.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/enrich.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/sender.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/spawn.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/sanitize.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/detect-agent.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/gating.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/user-config.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/endpoint.ts`
  - `packages/1-framework/3-tooling/cli-telemetry/src/exports/index.ts`
  - `packages/1-framework/3-tooling/cli/src/utils/telemetry.ts`
  - `packages/1-framework/3-tooling/cli/src/cli.ts` — `preAction` hook only (lines around `program.hook('preAction', …)`)
  - `packages/1-framework/3-tooling/cli/src/commands/init/inputs.ts` — `TELEMETRY_CONSENT_MESSAGE` definition and `resolveTelemetryConsent` body only
- **Files audited (partial — wire/schema only):**
  - `apps/telemetry-backend/src/schema.ts` — to confirm the receiving shape matches the client-sent shape exactly.
- **Spec reference:** the project's NFR4 and AC13, recorded at audit time in `projects/cli-telemetry/spec.md`. The contract is "no field derived from MAC address, machine ID, hostname, username, IP, or any system identifier is collected or transmitted".

## Grep results

All patterns were run with `grep -rnE` against the scope
`packages/1-framework/3-tooling/cli-telemetry/src/**` plus the parent-side bridge file
`packages/1-framework/3-tooling/cli/src/utils/telemetry.ts`.

| Pattern | Hits | Classification |
| --- | --- | --- |
| `os\.hostname\|HOSTNAME\|COMPUTERNAME` | 0 | not used |
| `os\.userInfo\|process\.env\.(USER\|USERNAME\|LOGNAME)` | 0 | not used |
| `networkInterfaces\|getmac\|macaddress\|mac-address\|MACAddress` | 0 | not used |
| `machine-id\|machineId\|MachineGuid\|IOPlatformUUID\|IORegistry\|node-machine-id\|getMachineId` | 0 | not used |
| `dns\.lookup\|node:dns\|process\.env\.SSH_CONNECTION` | 0 | not used |
| `randomUUID\|node:crypto` | 2 | `user-config.ts:1` (`import { randomUUID } from 'node:crypto'`) and `user-config.ts:101` (`merged['installationId'] = randomUUID()`). **This is the only identifier-mint site, and it is `crypto.randomUUID()` (v4 random).** |
| `homedir\|os\.homedir\|XDG_CONFIG_HOME\|APPDATA\|USERPROFILE` | 7 | all in `user-config.ts:1–58`, all in the `configDir()` helper that locates the local config file. **None of these values is transmitted.** The path itself stays inside the client process for the duration of the file read/write. |
| `npm_config_user_agent\|userAgent` | 4 | `enrich.ts:62–69, 120` — `parsePackageManager` reads `env.env['npm_config_user_agent']` and returns only the leading whitespace-separated token (e.g. `"pnpm/10.27.0"`). The remaining tokens of the user-agent string (which include `node/v…`, `darwin`, `arm64` and may include host identifiers) **are dropped**. |
| `child\.send\|\.send(payload` | 1 | `spawn.ts:99` — the single IPC site, carries a `ParentToSenderPayload` and nothing else. |
| `JSON\.stringify` | 2 | `user-config.ts:109` (local file write of `{ enableTelemetry, installationId, …unknown }`) and `sender.ts:43` (`body: JSON.stringify(event)` — the wire). |
| `readFile\|readFileSync\|writeFileSync\|node:fs` | 5 | `user-config.ts` (read/write local config); `enrich.ts:1, 141` (read project `package.json` for `tsVersion`). No other filesystem touch. |
| `fetch\(\|node:http\|new URL\(` | 6 | `endpoint.ts` (URL composition), `sender.ts:40` (the single POST), plus `senderModuleUrl`/`senderPath` URL constructions for the fork target. No outbound HTTP other than the backend POST. |
| `process\.env\[\|process\.env\.` | 6 | `detect-agent.ts:9` (doc-comment); `user-config.ts:43, 49` (`APPDATA`, `XDG_CONFIG_HOME` for path resolution); `spawn.ts:100, 108` and `sender.ts:27` (`PRISMA_NEXT_DEBUG` debug-mode gating). **All env-var reads accounted for; none of these values is transmitted.** |

The agent-detector also reads env vars (`AGENT_MARKERS`), but only via the indexed lookup `env[marker.envVar]` inside `detectAgent` — the *value* is passed only to `isTruthyMarker` for the truthy/empty/`'0'`/`'false'` check, and what flows to the wire is the static `marker.agent` label (e.g. `"Claude Code"`) from the allowlist, not the env-var value.

## Identifier-derivation analysis

- **Installation UUID** — `user-config.ts:101`: `merged['installationId'] = randomUUID()`, imported from `'node:crypto'`. This is Node's [`crypto.randomUUID()`](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions), which produces an RFC 4122 v4 random UUID. The value depends on `crypto.getRandomValues`, which is OS-CSPRNG-backed, not on any system identifier. The UUID is minted exactly once — on the first persist of `enableTelemetry: true` — and is never rotated by the client (see `user-config.ts:99–101`: the guard `merged['installationId'] === undefined` prevents overwriting an existing value). **Conforms.**
- **No MAC address read** — zero hits in scope. **Conforms.**
- **No machine-id read** — zero hits in scope. No imports of `node-machine-id`, no reads of `/etc/machine-id`, no `IORegistry` calls, no `MachineGuid` registry probes. **Conforms.**
- **No hostname read** — zero hits in scope. `os.hostname` is never imported; `process.env.HOSTNAME` / `COMPUTERNAME` are never read. **Conforms.**
- **No username read** — zero hits in scope. `os.userInfo` is never imported; `process.env.USER` / `USERNAME` / `LOGNAME` are never read. **Conforms.**
- **No IP address read** — zero hits in scope. `os.networkInterfaces` is never imported; `node:dns` is never imported; no SSH-connection or other transport-info env vars are read. The transport-level client-IP exposure of the HTTPS POST itself (which Node's fetch reveals to the backend) is out of scope for this audit — the backend's proxy-trust posture handles that side and is covered by ADR 216 / 217 and backend hardening notes. **Conforms (client-side transmitted-field surface).**
- **No file paths read from user input** reach the wire. The path uses of `process.env.XDG_CONFIG_HOME` / `process.env.APPDATA` / `os.homedir()` are confined to `user-config.ts`'s `configDir()` function, which composes a path used only for local `readFileSync` / `writeFileSync`. Tracing: `configDir()` is called by `userConfigPath()`, which is called only by `readUserConfig` / `writeUserConfig` — neither of which returns a path or transmits a path. The single field that flows from `readUserConfig()` into the IPC payload is `config.installationId` (see `spawn.ts:84`); the file's path never leaves the process. **Conforms.**
- **No env-var values transmitted in raw form**:
  - `XDG_CONFIG_HOME`, `APPDATA`, `USERPROFILE` — used to derive local file paths only.
  - `PRISMA_NEXT_DISABLE_TELEMETRY`, `DO_NOT_TRACK` — read by `resolveGating` to produce a `GatingResolution`; the values themselves never enter the payload.
  - `npm_config_user_agent` — only the **leading whitespace-token** (the `<pm>/<version>` prefix) is extracted via `parsePackageManager`; the remainder is dropped.
  - `PRISMA_NEXT_DEBUG` — only the boolean `=== '1'` is consulted; the value is not propagated.
  - `PRISMA_NEXT_TELEMETRY_ENDPOINT` — used by `resolveTelemetryEndpoint` to override the backend URL for integration testing; the value resolves to a URL the client posts to, never appearing inside the payload.
  - `AGENT_MARKERS` env vars — only truthy/falsy presence is consulted; the static `marker.agent` label is what flows to the wire.

  **Conforms.**

## Wire-shape analysis

The wire payload is the `TelemetryEvent` interface in `payload.ts`. The sender's `JSON.stringify(event)` (`sender.ts:43`) serialises exactly the object returned by `buildTelemetryEvent` (`enrich.ts:105–122`), whose return-type annotation is `TelemetryEvent`. TypeScript's exact-return enforcement plus the interface's `readonly` fields would surface any extra-field leak as a compile error.

Per-field source attribution:

| Wire field | Source in client | Notes |
| --- | --- | --- |
| `installationId` | `payload.installationId` (`enrich.ts:108`), originally `config.installationId` (`spawn.ts:84`), originally `randomUUID()` in `user-config.ts:101` | v4 random; non-derived |
| `version` | `payload.version` (`enrich.ts:110`), originally `CLI_VERSION` imported from `cli/package.json` via `cli/src/utils/telemetry.ts:11` | This CLI's own version; not the user's project version |
| `command` | `payload.command` (`enrich.ts:111`), originally `sanitised.command` (`spawn.ts:86`), from `sanitizeCommanderResult(...).command` | Space-joined subcommand path; root program name dropped (`sanitize.ts:79`) |
| `flags` | `payload.flags` (`enrich.ts:112`), originally `sanitised.flags` (`spawn.ts:87`), from `sanitizeCommanderResult(...).flags` | Long flag names only, `cli` source only (`sanitize.ts:80–84`) |
| `runtimeName` | `runtime.name` (`enrich.ts:113`), from `resolveRuntime` (`enrich.ts:46–57`) — keys off `process.versions.bun`/`.deno`/`.node` presence | Literal `'node' \| 'bun' \| 'deno'` |
| `runtimeVersion` | `runtime.version` (`enrich.ts:114`), from `process.versions[runtime.name]` | Runtime version number only |
| `os` | `env.platform` (`enrich.ts:115`), originally `process.platform` (`enrich.ts:134`) | Literal `'darwin' \| 'linux' \| 'win32' \| …` — not host-specific |
| `arch` | `env.arch` (`enrich.ts:116`), originally `process.arch` (`enrich.ts:135`) | Literal `'arm64' \| 'x64' \| …` |
| `packageManager` | `parsePackageManager(env.env['npm_config_user_agent'])` (`enrich.ts:117`) | Leading whitespace-token only, e.g. `"pnpm/10.27.0"`; tail dropped |
| `databaseTarget` | `payload.databaseTarget` (`enrich.ts:118`), originally `config.target.targetId` from the project's `prisma-next.config.ts` (`cli/src/utils/telemetry.ts:86–89`) | Project-config target id; `null` on any failure to load |
| `tsVersion` | `readTsVersionFromPackageJson(env.readProjectPackageJson())` (`enrich.ts:119`), which `readFileSync(<projectRoot>/package.json)` and parses `devDependencies.typescript` or `dependencies.typescript` | Leading `^`/`~` stripped (`enrich.ts:91`); `null` on any failure |
| `agent` | `detectAgent(env.env)` (`enrich.ts:120`) | Static label from the `AGENT_MARKERS` allowlist, never the env-var value |
| `extensions` | `payload.extensions` (`enrich.ts:121`), originally `extensionPacks.map((pack) => pack.id)` from the project's `prisma-next.config.ts` (`cli/src/utils/telemetry.ts:90–96`) | Author-declared `.id` strings only |

The 13 wire fields above match the `TelemetryEvent` interface keys (`payload.ts:62–76`) one-to-one. The backend's arktype schema (`apps/telemetry-backend/src/schema.ts`) lists the same 13 keys with `'+': 'delete'` (unknown-field drop) — but as a defense-in-depth check, the client constructs the event object via a single `return { … }` literal in `buildTelemetryEvent` with no spread of any unaudited record. **No extra fields can be smuggled into the payload.**

## Sanitiser analysis

`sanitize.ts` — read end-to-end.

- **Positional arguments are never read.** `CommanderResultShape.positionalArgs` is declared in the input interface (so call sites can't pretend they didn't think about positionals), but `sanitizeCommanderResult`'s body does not reference `input.positionalArgs`. Verified by reading the function body (`sanitize.ts:75–88`). **Conforms.**
- **Only `source === 'cli'` options are emitted.** `sanitize.ts:81` guards `if (option.source !== 'cli') return [];`. Defaulted options, `env`-sourced options, and `config`-sourced options are dropped. **Conforms.**
- **Only the long flag name is emitted.** `flagNameFromLongName` (`sanitize.ts:53–57`) takes `option.longName`, requires it to start with `--`, and returns the suffix without the prefix. Short names, attribute names (camelCase), and option values never enter this path. **Conforms.**
- **Output shape is `{ command: string; flags: string[] }`.** The function's return-type annotation is `SanitisedCommand` (`sanitize.ts:44–47`); no other fields appear in the return literal. **Conforms.**

## Sender analysis

`sender.ts` — read end-to-end.

- **Inputs:** the sender consumes exactly the IPC message validated by `isParentToSenderPayload` (`sender.ts:65`) and its own `process` snapshot via `buildTelemetryEventFromProcess` (`enrich.ts:128–144`). No other inputs.
- **HTTP request:** `sender.ts:40–47` — `fetch(payload.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), signal: controller.signal })`. **The only request header explicitly set is `content-type: application/json`.** The `User-Agent` header is whatever Node's undici-backed fetch defaults to (typically the bare token `node`, which is a runtime identifier, not a user identifier).
- **Request body:** `JSON.stringify(event)` where `event: TelemetryEvent` — exactly the 13 audited wire fields.
- **No retry logic, no body-shape transformation, no header customisation.** A debug-mode `process.stderr.write` is gated behind `PRISMA_NEXT_DEBUG === '1'` (`sender.ts:27`); under default env, no output reaches stdout/stderr (this property is independently pinned by the integration suite in `test/integration.test.ts`'s "failure modes are silent" block).

**Conforms.**

## Parent-side analysis

`cli/src/utils/telemetry.ts` — read end-to-end.

The parent constructs exactly one IPC payload via `runTelemetry({ … })` (`fireTelemetryWithFields` at `telemetry.ts:115–130`), forwarding:

- `command` — `commanderSnapshotForTelemetry(actionCommand)` — produces only `commandPath` (array of names), `positionalArgs` (passed for type-shape only, never read by the sanitiser), and `options` (`attributeName`, `longName`, `source` per option) (`telemetry.ts:42–62`).
- `version` — `CLI_VERSION` from `cli/package.json`.
- `databaseTarget` — from `loadConfigForTelemetry()`'s `config.target.targetId` projection.
- `extensions` — from `loadConfigForTelemetry()`'s `extensionPacks.map(pack => pack.id)` projection.
- `projectRoot` — `process.cwd()`. Used by the **child** to read `<projectRoot>/package.json` for `tsVersion` (local file read; the path is never transmitted by the child either, see the wire-shape table above).
- `senderPath` — the resolved path to the compiled sender entry. Local-machine path; used only as the fork target.
- `isCI` — boolean from `ci-info`.
- `env` — `process.env` passed for **read-only consultation** by `resolveGating` and `resolveTelemetryEndpoint`. Inspected for the gate signals and `npm_config_user_agent` only; never serialised into the payload object as a whole.
- `userConfig` — cached `UserConfig` whose only audited path to the wire is `config.installationId`.

Inside `runTelemetry` (`spawn.ts:62–115`), the IPC payload object literal (`spawn.ts:83–93`) names exactly 8 fields — `installationId`, `version`, `command`, `flags`, `databaseTarget`, `extensions`, `projectRoot`, `endpoint` — matching `ParentToSenderPayload` (`payload.ts:14–26`). The TypeScript annotation on the literal would surface any extra-field leak as a compile error. **No extra parent-side data flows into IPC.**

The `cli.ts` preAction hook (`cli.ts:80–84`) does nothing but `void fireTelemetryFromPreAction(actionCommand).catch(() => {})`; it adds no fields and no inputs.

The init consent prompt (`inputs.ts:247–273`) writes `enableTelemetry: boolean` to the local config file via `writeUserConfig` and never crosses the wire on its own. The subsequent `fireTelemetryAfterInitConsent` path (`telemetry.ts:159–172`) constructs a `RunTelemetryInputs` with `databaseTarget` from the init's resolved input and an empty `extensions: []`; same 8-field IPC payload, no extras.

**Conforms.**

## Findings

**None.** No PII-class identifier is collected or transmitted by the client. The installation UUID is generated by `crypto.randomUUID()` and stored locally; the wire payload is exactly the 13 audited fields of `TelemetryEvent` and no more; env-var values are read only to consult gates and parse the package-manager token, never serialised whole; file paths reach the wire nowhere.

## Sign-off

I have personally read each of the files listed in [Subject under audit](#subject-under-audit) and confirm that:

1. **No system-identifier read reaches the wire.** The grep table above documents the zero-hit patterns for hostname, username, MAC address, machine-id, DNS, and network-interface enumeration in the audit scope.
2. **The transmitted wire payload is exactly the 13 fields of `TelemetryEvent` and no more.** Each field's origin is traced in the wire-shape analysis; the construction site is a single object literal whose TypeScript type annotation forbids extra keys, and the JSON serialisation is `JSON.stringify(event)` with no augmentation.
3. **No env-var value, file path, hostname, username, MAC address, machine ID, IP address, or other PII-class identifier is collected or transmitted by the client.** Env vars and file paths are consulted locally for gating and path resolution only; their values do not leave the process.
4. **The installation UUID is a cryptographically random v4 UUID** generated by Node's `crypto.randomUUID()` in `user-config.ts:101`, stored locally in `$XDG_CONFIG_HOME/prisma-next/config.json` (or the Windows equivalent), and never derived from any system input.

Signed: m3.2 implementer (`@cursor-agent`), against `cli-telemetry-m3` bookmark advanced by this audit-commit (the audit-commit SHA is recorded in the bookmark log after this commit lands).
