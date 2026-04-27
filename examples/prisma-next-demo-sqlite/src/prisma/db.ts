import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import sqlite from '@prisma-next/sqlite/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const db = sqlite<Contract>({
  contractJson,
  middleware: [createTelemetryMiddleware()],
});
