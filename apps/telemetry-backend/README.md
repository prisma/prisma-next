# `@prisma-next/telemetry-backend`

A Bun HTTP service that receives Prisma Next CLI telemetry events, validates
them with arktype, and inserts them into Postgres through Prisma Next itself
(dogfooded). The service is unauthenticated by design — events are anonymous —
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
| `400` | Payload was not JSON, or did not include `installationId`, `version`, and `command`. |
| `404` | Path other than `/events`. |
| `405` | Method other than `POST`. |
| `429` | Per-IP rate limit exceeded. |

### Wire format

The accepted payload shape (described as a TypeScript signature; arktype
enforces the same at runtime in `src/schema.ts`):

```ts
interface TelemetryEventPayload {
  installationId: string;   // required, non-empty
  version: string;          // required, non-empty
  command: string;          // required, non-empty
  flags?: string[];         // defaults to []
  runtimeName?: string;     // defaults to 'unknown'
  runtimeVersion?: string;  // defaults to 'unknown'
  os?: string;              // defaults to 'unknown'
  arch?: string;            // defaults to 'unknown'
  packageManager?: string | null;
  databaseTarget?: string | null;
  tsVersion?: string | null;
  agent?: string | null;
  extensions?: string[];    // defaults to []
}
```

Forward compatibility: any keys outside this shape are silently
dropped before persistence — newer clients can introduce fields without
a backend update.

Backward compatibility: optional and nullable fields tolerate omission
(see defaults above). Only `installationId`, `version`, and `command`
are critical enough to reject when missing.

## Configuration

The service is configured exclusively through environment variables:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection string (`postgres://` or `postgresql://`). |
| `PORT` | no | `8080` | TCP port for `Bun.serve`. |
| `RATE_LIMIT_RPM` | no | `120` | Requests/minute/IP. The token-bucket capacity is set to this value (i.e. it doubles as the burst budget). |

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

To start a local server against a Postgres of your choice:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/telemetry \
  PORT=8080 \
  pnpm --filter @prisma-next/telemetry-backend start
```

The repository ships a `docker-compose.yaml` at its root that exposes
Postgres on `localhost:5433` for local-dev use.

## Deploy hand-off

This package builds nothing — `bun run src/server.ts` executes the
TypeScript directly. There is therefore no `dist/` artefact to publish;
the deploy unit is the package directory tree (or the repo, scoped by
the workspace filter).

For Prisma Compute, the assigned `*.prisma.build` URL becomes the
build-time constant the CLI client embeds. The deploy itself is out of
scope for this milestone — when ready, push the package directory,
provision a Postgres database, set the environment variables above,
and `pnpm --filter @prisma-next/telemetry-backend start` (or its
container equivalent — `bun run src/server.ts`) takes over.

Post-deploy verification:

```bash
curl -i -X POST https://<url>/events \
  -H 'content-type: application/json' \
  -d '{"installationId":"smoke-test","version":"0.0.0","command":"smoke","runtimeName":"node","runtimeVersion":"24","os":"linux","arch":"x64"}'
# expect: HTTP/2 202
```
