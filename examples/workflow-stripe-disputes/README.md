# Stripe Dispute Evidence Workflow

This example implements the n8n-style dispute automation from the Workflow PRD with mocked Stripe, HubSpot, Shopify, Zendesk, and Slack providers.

Run it:

```bash
pnpm --filter @prisma-next/example-workflow-stripe-disputes workflow:generate
pnpm --filter @prisma-next/example-workflow-stripe-disputes test
pnpm --filter @prisma-next/example-workflow-stripe-disputes workflow:test
pnpm --filter @prisma-next/example-workflow-stripe-disputes exec prisma-next workflow dev --schema src/schema.prisma
```

The `generator workflows` block in `src/schema.prisma` writes artifacts to `src/generated/workflows` and uses `_prisma_workflows` for the durable Postgres schema. `workflow:test` loads the step modules in `src/steps/*` and those modules call mocked Stripe, HubSpot, Shopify, Zendesk, and Slack providers. The generated Studio preview lives at `studio/workflows.html`, and the canvas SVG lives at `studio/dispute-evidence.svg`.

For a production-oriented walkthrough of the full Stripe path, open `production-tour.html` in a browser. It shows how the same workflow runs as a Prisma Compute app with connector verification, durable ingest, worker execution, finance approval, external side effects, and Studio operations.
