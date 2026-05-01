import 'dotenv/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const HYPERDRIVE_VAR = 'WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';

// vitest-pool-workers' parseCustomPoolOptions calls wrangler's
// `unstable_getMiniflareWorkerOptions` BEFORE the `cloudflareTest` callback
// runs, so wrangler must already see the Hyperdrive env var when the config
// is parsed. Mirror it under both names since wrangler 4.87 deprecated the
// WRANGLER_* prefix in favour of CLOUDFLARE_*.
const databaseUrl = process.env[HYPERDRIVE_VAR];
if (!databaseUrl) {
  throw new Error(
    `[vitest.config] ${HYPERDRIVE_VAR} not set. Run \`pnpm db:up\` and copy \`.env.example\` to \`.env\`.`,
  );
}
process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] ??= databaseUrl;

export default defineConfig({
  plugins: [
    cloudflareTest(({ inject }) => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityFlags: ['nodejs_compat'],
        compatibilityDate: '2025-07-18',
        hyperdrives: {
          HYPERDRIVE: inject('database-url'),
        },
      },
    })),
  ],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Pre-bundle pg and friends so vitest-pool-workers' module-fallback server
    // (which currently mis-resolves dual ESM/CJS exports under Vite 8 — see
    // cloudflare/workers-sdk#12984 and #13037) doesn't see them as bare
    // node_modules at workerd-load time.
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['pg', 'pg-protocol', 'pg-connection-string', 'pg-cursor', 'pg-cloudflare'],
          rolldownOptions: {
            external: [
              'net',
              'events',
              'util',
              'tls',
              'path',
              'fs',
              'dns',
              'crypto',
              'stream',
              'string_decoder',
              'os',
              'buffer',
              'url',
            ],
          },
        },
      },
    },
  },
});
