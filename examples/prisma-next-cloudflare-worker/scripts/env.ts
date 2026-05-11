import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const HYPERDRIVE_VAR = 'WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
export const CLOUDFLARE_HYPERDRIVE_VAR = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';

export function loadLocalEnv(root = process.cwd()): void {
  const envPath = resolve(root, '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}
