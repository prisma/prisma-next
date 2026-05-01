# [Project Plan] Prisma Next on Cloudflare Workers with Hyperdrive

## Summary

_To be drafted via `drive-create-plan` after the spec is approved._

**Spec:** [`projects/cloudflare-hyperdrive-runtime/spec.md`](./spec.md)

## Milestones

_Pending. The plan will likely be structured as:_

1. **Workers compatibility audit** — read-only investigation that gates the driver topology decision (open question 1 in the spec).
2. **Driver / wrapper changes** — implement whichever option (a/b/c) the audit recommends.
3. **Example Worker app** — `examples/prisma-next-cloudflare-worker` with `wrangler dev` story.
4. **Tests** — unit + `vitest-pool-workers` integration.
5. **Docs** — new "Deploying to Cloudflare Workers with Hyperdrive" page.
6. **Verification** — manual `wrangler deploy` smoke test against real Hyperdrive + Postgres origin.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`spec.md`](./spec.md)
- [ ] Migrate long-lived docs into `docs/` (the deployment guide; any ADR if a new one is needed)
- [ ] Strip repo-wide references to `projects/cloudflare-hyperdrive-runtime/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/cloudflare-hyperdrive-runtime/`
