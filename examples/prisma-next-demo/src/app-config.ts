import { type as arktype } from 'arktype';

const appConfigSchema = arktype({
  DATABASE_URL: 'string',
});

export function loadAppConfig() {
  const result = appConfigSchema({
    DATABASE_URL: process.env['DATABASE_URL'],
  });
  if (result instanceof arktype.errors) {
    const message = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid app configuration: ${message}`);
  }
  const parsed = result as { DATABASE_URL: string };
  return { databaseUrl: parsed.DATABASE_URL };
}
