import 'dotenv/config';
import { createServer } from 'node:http';
import { createYoga, type Plugin } from 'graphql-yoga';
import { type CapturedExecution, withCapture } from './prisma/capture';
import { db } from './prisma/db';
import { buildSchema } from './schema';

const PORT = Number(process.env['PORT'] ?? 4000);
const SQLITE_PATH = process.env['SQLITE_PATH'] ?? './pothos-demo.db';

const capturePlugin: Plugin = {
  onExecute({ setExecuteFn, executeFn }) {
    setExecuteFn(async (args) => {
      const captures: CapturedExecution[] = [];
      return withCapture(captures, async () => {
        const result = await executeFn(args);
        const out = result as { extensions?: Record<string, unknown> } & Record<string, unknown>;
        out.extensions = {
          ...(out.extensions ?? {}),
          prismaNext: {
            executions: captures.map((c) => ({
              sql: c.sql,
              params: c.params,
              rowCount: c.rowCount,
              latencyMs: c.latencyMs,
            })),
            executionCount: captures.length,
          },
        };
        // eslint-disable-next-line no-console
        console.log(
          `[pothos-integration] request executed ${captures.length} SQL ${
            captures.length === 1 ? 'query' : 'queries'
          }`,
        );
        return result;
      });
    });
  },
};

async function main() {
  const runtime = await db.connect({ path: SQLITE_PATH });
  const schema = buildSchema(runtime);

  const yoga = createYoga({
    schema,
    graphiql: true,
    plugins: [capturePlugin],
  });

  const server = createServer(yoga);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[pothos-integration] GraphiQL playground at http://localhost:${PORT}/graphql`);
  });

  process.on('SIGINT', async () => {
    server.close();
    await runtime.close();
    process.exit(0);
  });
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[pothos-integration] failed to start:', err);
  process.exitCode = 1;
});
