import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';
import { createCipherstashRuntimeDescriptor } from '@prisma-next/extension-cipherstash/runtime';
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };
import { createDemoSdk } from './sdk';

const sdk = createDemoSdk();

export const db = postgres<Contract>({
  contractJson,
  extensions: [createCipherstashRuntimeDescriptor({ sdk })],
  middleware: [bulkEncryptMiddleware(sdk)],
});
