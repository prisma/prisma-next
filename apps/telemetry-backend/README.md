# `@prisma-next/telemetry-backend`

A telemetry HTTP service that receives Prisma Next CLI events, validates them
with arktype, and inserts them into Postgres through Prisma Next itself
(dogfooded). The production/deploy entrypoint uses `Bun.serve`; the same
handler can also run behind `node:http` for repo tests that must not require a
Bun binary. The service is unauthenticated by design — events are anonymous —
and rate-limited at the edge to mitigate abuse.

This package lives under `apps/` rather than `packages/` because the
backend is a deployable service, not a framework component. It sits
outside the framework domain boundary in `architecture.config.json` by
construction (the `packages` glob and `lint:deps` configuration both
scope to `packages/`), so it consumes the full Prisma Next stack without
violating domain layering.

## Endpoint

- `POST /events` — accept a JSON event payload.

Responses:

| Status | Meaning |
| --- | --- |
| `202` | Event validated and inserted. |
| `400` | Payload was not JSON, missed a required field, or exceeded a field/array schema bound. |
| `413` | `Content-Length` or the streamed body exceeded the 32 KiB request cap. |
| `404` | Path other than `/events`. |
| `405` | Method other than `POST`. |
| `429` | Per-IP rate limit exceeded. |

### Wire format

The accepted payload shape (described as a TypeScript signature; arktype
enforces the same at runtime in `src/schema.ts`):

```ts
interface TelemetryEventPayload {
  installationId: string;   // required, non-empty, <= 512 chars
  version: string;          // required, non-empty, <= 512 chars
  command: string;          // required, non-empty, <= 512 chars
  runtimeName: string;      // required, non-empty, <= 512 chars
  runtimeVersion: string;   // required, non-empty, <= 512 chars
  os: string;               // required, non-empty, <= 512 chars
  arch: string;             // required, non-empty, <= 512 chars
  flags?: string[];         // defaults to [], each item <= 128 chars; total payload <= 32 KiB
  packageManager?: string | null; // defaults to null, string <= 512 chars
  databaseTarget?: string | null; // defaults to null, string <= 512 chars
  tsVersion?: string | null;      // defaults to null, string <= 512 chars
  agent?: string | null;          // defaults to null, string <= 512 chars
  extensions?: string[];    // defaults to [], each item <= 128 chars; total payload <= 32 KiB
}
```

Missing any required field returns `400 Bad Request`. Optional arrays
default to `[]`; optional nullable scalars default to `null`.

Forward compatibility: any keys outside this shape are silently
dropped before persistence — newer clients can introduce fields without
a backend update.

Request-size guardrail: requests are capped at 32 KiB. If
`Content-Length` is present and exceeds the cap, the backend returns
`413 Payload Too Large` before reading the body. Requests without a
trustworthy `Content-Length` are still read through the same hard cap,
so chunked or lying clients cannot stream unbounded data.

## Configuration

The service is configured exclusively through environment variables:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection string (`postgres://` or `postgresql://`). |
| `PORT` | no | `8080` | TCP port for the HTTP server. |
| `RATE_LIMIT_RPM` | no | `120` | Requests/minute/IP. The token-bucket capacity is set to this value (i.e. it doubles as the burst budget). |
| `TELEMETRY_TRUST_FORWARDED_FOR` | no | `false` | Set to `1` / `true` / `yes` only when the backend sits behind a proxy that strips inbound `x-forwarded-for` and writes its own (e.g. Prisma Compute). When unset, the per-IP rate-limit key is taken from the socket address, because any direct caller could otherwise set the header to bypass the limit. |

The Postgres schema is the model authored in `src/prisma/contract.prisma`
(committed in `src/prisma/contract.json` / `contract.d.ts`). Use
`pnpm db init` or any equivalent migration of your choice to create the
`telemetry_event` table before pointing the service at a database.

## Local development

```bash
pnpm install
pnpm --filter @prisma-next/telemetry-backend emit       # refresh contract.json / contract.d.ts
pnpm --filter @prisma-next/telemetry-backend test       # vitest, spins up @prisma/dev Postgres
pnpm --filter @prisma-next/telemetry-backend typecheck
pnpm --filter @prisma-next/telemetry-backend lint
```

To start the Bun server against a Postgres of your choice:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/telemetry \
  PORT=8080 \
  pnpm --filter @prisma-next/telemetry-backend start
```

For Node-only test harnesses, the equivalent `node:http` entrypoint is:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/telemetry \
  PORT=8080 \
  pnpm --filter @prisma-next/telemetry-backend start:node
```

The repository ships a `docker-compose.yaml` at its root that exposes
Postgres on `localhost:5433` for local-dev use.

## Deploy hand-off

This package builds nothing for deployment — `bun run src/server.ts` executes
the Bun entrypoint TypeScript directly. There is therefore no `dist/` artefact
to publish; the deploy unit is the package directory tree (or the repo, scoped
by the workspace filter).

For Prisma Compute, the assigned `*.prisma.build` URL becomes the
build-time constant the CLI client embeds. Deployment is performed
separately: push the package directory, provision a Postgres database,
set the environment variables above, and `pnpm --filter
@prisma-next/telemetry-backend start` (or its container equivalent —
`bun run src/server.ts`) takes over.

Post-deploy verification:

```bash
curl -i -X POST https://<url>/events \
  -H 'content-type: application/json' \
  -d '{"installationId":"smoke-test","version":"0.0.0","command":"smoke","runtimeName":"node","runtimeVersion":"24","os":"linux","arch":"x64"}'
# expect: HTTP/2 202
```
