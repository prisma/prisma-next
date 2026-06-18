# Customer Onboarding Workflow

This example shows a second Prisma Workflow shape: a product event triggers CRM, billing, and identity enrichment; high-risk enterprise accounts wait for Sales Ops approval; approved accounts are provisioned and summarized in Slack.

Run it:

```bash
pnpm --filter @prisma-next/example-workflow-customer-onboarding workflow:generate
pnpm --filter @prisma-next/example-workflow-customer-onboarding test
pnpm --filter @prisma-next/example-workflow-customer-onboarding workflow:test
pnpm --filter @prisma-next/example-workflow-customer-onboarding exec prisma-next workflow dev --schema src/schema.prisma
```

The `generator workflows` block in `src/schema.prisma` writes artifacts to `src/generated/workflows` and uses `_prisma_workflows` for the durable Postgres schema. `workflow:test` loads the step modules in `src/steps/*` and those modules call mocked CRM, billing, identity, provisioning, and Slack providers. The generated Studio preview lives at `studio/workflows.html`, and the canvas SVG lives at `studio/onboarding-risk-review.svg`.
