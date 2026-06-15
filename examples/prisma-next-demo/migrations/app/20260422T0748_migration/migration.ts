#!/usr/bin/env -S node
import pgvector from '@prisma-next/extension-pgvector/runtime';
import postgres from '@prisma-next/postgres/runtime';
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = new PostgresContractSerializer().deserializeContract<Contract>(endContractJson);
const db = postgres<Contract>({ contractJson: endContractJson, extensions: [pgvector] });

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:b6500906de64a9e926fe4c18e5244dc56a62af097f5936a040e7ab55b42275b3',
      to: 'sha256:ea507b09a99523f7342c82821b22974fd8984ebe5939b5c445529cc0588ca343',
    };
  }

  override get operations() {
    return [
      this.dataTransform(endContract, 'handle-nulls-user-displayName', {
        check: () =>
          db.sql.public.user
            .select('id')
            .where((f, fns) => fns.eq(f.displayName, null))
            .limit(1),
        run: () =>
          db.sql.public.user
            .update({ displayName: 'Anonymous' })
            .where((f, fns) => fns.eq(f.displayName, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'user', column: 'displayName' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
