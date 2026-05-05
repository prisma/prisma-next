import SchemaBuilder from '@pothos/core';
import type { Runtime } from '@prisma-next/sql-runtime';
import { contract } from '../prisma/contract';
import PrismaNextPlugin from './plugin';
import type { Contract } from './prisma/contract';
import { createOrmClient, type OrmClient } from './prisma/orm';

export interface AppContext {
  runtime: Runtime;
  db: OrmClient;
}

export function createBuilder(runtime: Runtime) {
  const db = createOrmClient(runtime);
  const builder = new SchemaBuilder<{
    Context: AppContext;
    PrismaNextContract: Contract;
  }>({
    plugins: [PrismaNextPlugin],
    prismaNext: {
      contract: contract as unknown as Contract,
      db: db as never,
    },
  });

  return { builder, db };
}
