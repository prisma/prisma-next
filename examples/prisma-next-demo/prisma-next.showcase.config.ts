import { defineConfig } from '@prisma-next/postgres/config';

// Showcase fixture config — a deliberately comprehensive migration graph that
// exercises every shape the `migration graph` renderer handles: a linear spine,
// diamond divergence/convergence, a forward cross-link, adjacent and
// node-skipping routed rollbacks, a self-edge, and a disjoint cyclic component.
//
// Explore it from the CLI:
//   pnpm exec prisma-next migration graph --config ./prisma-next.showcase.config.ts
export default defineConfig({
  contract: './showcase-contract/showcase.prisma',
  db: {
    connection: 'postgresql://showcase:showcase@localhost:5432/showcase',
  },
  migrations: {
    dir: './migration-fixtures/showcase',
  },
});
