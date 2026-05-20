# Telemetry

The `prisma-next` CLI can send a small, anonymous usage event each time you run a command. The team uses this data to answer adoption questions — how many people are actively using Prisma Next, which databases they target, which extensions get adopted, and how often the CLI is invoked by AI coding agents versus humans.

Telemetry is **off by default**. The CLI never sends an event until you explicitly opt in.

If you've already opted in and want to turn it off, jump to [How to opt out (or back in)](#how-to-opt-out-or-back-in).

## What is collected

Every event is a single JSON object with the fields below. Nothing else is sent.

| Field | Type | Example | Source |
| --- | --- | --- | --- |
| `installationId` | string (v4 UUID) | `"7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f"` | A random UUID generated and stored locally on first opt-in |
| `version` | string | `"0.10.0"` | The version of the `prisma-next` package you're running |
| `command` | string | `"migration new"` | The CLI command name, space-separated subcommands included |
| `flags` | string[] | `["name", "dry-run"]` | The **names** of the flags you passed, with the `--` prefix stripped |
| `runtimeName` | string | `"node"` | `"node"`, `"bun"`, or `"deno"` |
| `runtimeVersion` | string | `"24.13.0"` | The runtime's reported version |
| `os` | string | `"darwin"` | From Node's `process.platform` |
| `arch` | string | `"arm64"` | From Node's `process.arch` |
| `packageManager` | string \| null | `"pnpm/10.27.0"` | Parsed from the `npm_config_user_agent` env var your package manager sets when invoking the CLI |
| `databaseTarget` | string \| null | `"postgres"` | The `target.targetId` field from your `prisma-next.config.ts`, if a config is loaded |
| `tsVersion` | string \| null | `"5.9.3"` | The TypeScript version declared in your project's `package.json`, if readable |
| `agent` | string \| null | `"Claude Code"` | The detected AI coding agent, or `null`. See [Agent detection](#agent-detection) |
| `extensions` | string[] | `["pgvector"]` | The `.id` values of the `extensionPacks` declared in your config |

A server-side ingestion timestamp is added when the backend stores the event; no client clock is transmitted.

## What is not collected

Telemetry deliberately excludes anything that could identify you, your machine, your project, or the values you pass on the command line:

- **No flag values.** Only flag names. `--connection-string="postgres://user:pass@host"` becomes `["connection-string"]` on the wire — never the URL.
- **No positional arguments.** Subcommand names are reported; positional inputs are dropped.
- **No file paths.** Not absolute paths, not relative paths, not paths embedded in flag values.
- **No usernames, hostnames, IP addresses, MAC addresses, or machine identifiers.** The installation UUID is a freshly-generated random value, never derived from anything about your system. Resetting it is as simple as deleting one file.
- **No environment variable values.** Some env vars are *read* to populate fields (`npm_config_user_agent` for the package manager string, the agent allowlist below for `agent`), but their values never leave your machine in raw form.
- **No project source code, no schema contents, no migration contents.**
- **No outcome data.** Phase 1 does not collect success/failure, exit code, or elapsed time.

## The user-level config file

Telemetry consent and the installation UUID live in a single per-user JSON file:

- **Unix (Linux, macOS):** `$XDG_CONFIG_HOME/prisma-next/config.json`, defaulting to `~/.config/prisma-next/config.json` when `$XDG_CONFIG_HOME` is unset. This follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/).
- **Windows:** `%APPDATA%\prisma-next\config.json`, falling back to `%USERPROFILE%\AppData\Roaming\prisma-next\config.json`.

After you've opted in, the file looks like this:

```json
{
  "enableTelemetry": true,
  "installationId": "7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f"
}
```

Two fields matter to the CLI:

- **`enableTelemetry`** (`boolean`) — your consent answer. `true` enables telemetry; `false` disables it; absent means "not asked yet, default off".
- **`installationId`** (`string`) — a v4 random UUID, generated locally the first time you persist `enableTelemetry: true`. The CLI never rotates it on its own.

Any other fields are tolerated and preserved across writes, so future Prisma Next versions can add new settings here without losing your existing data.

### Flipping your choice

To turn telemetry off (or back on), edit the file in any text editor and change the `enableTelemetry` value. The change takes effect on the next CLI invocation.

### Fully resetting

To start fresh — clear your installation ID and ask the consent question again — delete the file:

```bash
# Unix
rm ~/.config/prisma-next/config.json

# Windows (PowerShell)
Remove-Item "$env:APPDATA\prisma-next\config.json"
```

The next time you run `prisma-next init` interactively, the consent prompt will reappear. Until then, the CLI is back to its default-off state.

## How to opt out (or back in)

Telemetry can be disabled three independent ways. Any one is sufficient.

### 1. Environment variables (runtime-only)

Two env vars suppress telemetry without modifying any file on disk:

```bash
PRISMA_NEXT_DISABLE_TELEMETRY=1 prisma-next migrate
DO_NOT_TRACK=1 prisma-next migrate
```

- **`PRISMA_NEXT_DISABLE_TELEMETRY`** — disables telemetry when set to any truthy value. The values `""`, `"0"`, and `"false"` (case-insensitive) are treated as "not set" so an exported-but-blanked variable doesn't accidentally disable telemetry.
- **`DO_NOT_TRACK=1`** — the [community-standard opt-out signal](https://consoledonottrack.com). Disables telemetry when set to exactly `1`.

Either variable wins over the stored `enableTelemetry` value. The CLI **does not** rewrite your `config.json` in response to an env-var opt-out — your stored choice is preserved untouched, so unsetting the variable later restores whatever you had configured.

Export them in your shell profile if you want them to apply to every Prisma Next invocation.

### 2. The stored preference

Set `enableTelemetry` to `false` in your `config.json`:

```json
{
  "enableTelemetry": false
}
```

This disables telemetry on every invocation until you change it back. No `installationId` is generated when you store `false` — only an affirmative `true` ever mints a UUID.

### 3. Don't opt in

If you've never run `prisma-next init`, or you ran it under `--yes` / a non-interactive shell, or you answered "no" to the consent prompt, telemetry stays off. This is the default state on a fresh machine.

## The consent prompt

Telemetry consent is asked exactly once, as the final step of the interactive `prisma-next init` flow. The wording (verbatim) is:

> Help us prioritize features by sharing anonymous CLI usage data? The telemetry implementation is open source and fully transparent. (packages/1-framework/3-tooling/cli-telemetry and apps/telemetry-backend).

The default answer is **Yes**.

The prompt appears only when all of these are true:

- the consent answer has not been stored yet (`enableTelemetry` is absent from `config.json`, or the file doesn't exist);
- `init` is running in interactive mode (stdin is a TTY);
- you haven't passed `--yes` (or any other auto-accept flag) — consent must be a deliberate keystroke, not a side effect of automation;
- neither `PRISMA_NEXT_DISABLE_TELEMETRY` nor `DO_NOT_TRACK=1` is set;
- the CLI is not running in a CI environment.

If any of those conditions doesn't hold, the prompt is suppressed and your stored consent state is left untouched (i.e. default-off if you'd never answered before).

The prompt is **never re-shown** once `enableTelemetry` is stored — even on a subsequent `prisma-next init`. To change your answer, edit (or delete) `config.json` as described above.

No other CLI command shows a telemetry prompt or banner.

## Default-off

When `enableTelemetry` is undefined — because you haven't run `init` interactively, because the file is missing, or because the field was never written — telemetry is **disabled**. The CLI does not collect data without explicit prior consent. There is no soft default, no grace period, no "first 10 invocations" exemption.

## Per-user, not per-project

Telemetry consent lives in your user-level config file, not in your project's `prisma-next.config.ts`. There is intentionally no project-level telemetry toggle.

The reason is straightforward: one developer enabling telemetry should not enrol their teammates. A project-level setting committed to a repository would do exactly that. The per-user file means each person on a team makes their own choice, and changing it never produces a diff in version control.

## CI environments

CI environments never emit telemetry and never see the consent prompt. The CLI uses the [`ci-info`](https://www.npmjs.com/package/ci-info) package to detect dozens of CI providers (GitHub Actions, GitLab CI, CircleCI, Buildkite, Jenkins, Drone, Bitbucket Pipelines, Azure Pipelines, AWS CodeBuild, and more), so providers that don't set the standard `CI=true` marker still suppress telemetry correctly.

If you ever need to force the CLI to treat a CI environment as non-CI (e.g. to validate behaviour locally), set `CI=false` explicitly — `ci-info` short-circuits on that value.

## Agent detection

The `agent` field is populated by reading a small allowlist of well-known environment-variable markers set by AI coding tools. The current allowlist is:

| Env var | Reported agent |
| --- | --- |
| `CLAUDECODE` | `"Claude Code"` |
| `CURSOR_AGENT` | `"Cursor"` |
| `CODEX_SANDBOX` | `"Codex CLI"` |
| `GEMINI_CLI` | `"Gemini CLI"` |
| `WINDSURF` | `"Windsurf"` |
| `AIDER` | `"Aider"` |
| `CODY` | `"Cody"` |
| `CONTINUE` | `"Continue"` |

When no marker is set, `agent` is `null`. The detection is **best-effort**: it cannot identify an agent that doesn't set a recognised env var, and some tools (notably Codex CLI outside its sandboxed sessions) are inherently harder to detect than others. False negatives are expected and treated as "unknown" rather than "human". The allowlist is in [`packages/1-framework/3-tooling/cli-telemetry/src/detect-agent.ts`](../packages/1-framework/3-tooling/cli-telemetry/src/detect-agent.ts); new entries land there as new agents are recognised.

## How the data is used

Telemetry events feed a small set of product questions:

- **Is Prisma Next being used, and by how many people?** Monthly active users, computed from distinct `installationId`s.
- **Which databases do users target?** Distribution over `databaseTarget`, so target maintenance and roadmap effort can follow real usage.
- **Which extensions are adopted?** Counts over `extensions`, so first-party extension packs and community packs get visible adoption signal.
- **Which runtime and TypeScript versions are in use?** So deprecations follow actual user impact.
- **How much CLI usage flows through AI coding agents?** From the `agent` field, to inform docs and UX targeted at agent-driven workflows.

Aggregated metrics may be shared more broadly; raw event data is restricted to the product team.

## Where the implementation lives

Everything is open source. If you want to audit what gets sent, or how:

- **Client** (the part that decides whether to send and runs in your CLI): [`packages/1-framework/3-tooling/cli-telemetry/`](../packages/1-framework/3-tooling/cli-telemetry/)
- **Backend** (the service that receives events and stores them in Postgres): [`apps/telemetry-backend/`](../apps/telemetry-backend/)
- **Architectural rationale for the installation ID design:** [ADR 216 — CLI telemetry installation ID is a stored random UUID, not a system fingerprint](./architecture%20docs/adrs/ADR%20216%20-%20CLI%20telemetry%20installation%20ID%20is%20a%20stored%20random%20UUID%20not%20a%20system%20fingerprint.md)
- **Architectural rationale for the detached-subprocess design:** [ADR 217 — CLI telemetry runs in a detached subprocess spawned at command start](./architecture%20docs/adrs/ADR%20217%20-%20CLI%20telemetry%20runs%20in%20a%20detached%20subprocess%20spawned%20at%20command%20start.md)
