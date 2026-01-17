import { type as arktype } from 'arktype';

const runtimeConfigSchema = arktype({
  DATABASE_URL: 'string',
});

export function loadRuntimeConfig() {
  const result = runtimeConfigSchema({
    DATABASE_URL: process.env['DATABASE_URL'],
  });
  if (result instanceof arktype.errors) {
    const message = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid runtime configuration: ${message}`);
  }
  const parsed = result as { DATABASE_URL: string };
  return { databaseUrl: parsed.DATABASE_URL };
}
