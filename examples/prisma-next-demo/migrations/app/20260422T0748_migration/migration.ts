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
      from: 'sha256:1ba85eb0c552251d354c5a6c23fe9b4cd8a6cf6675d0ef9e86427c85d2c23e28',
      to: 'sha256:952a6fea5fded63c48b879dea555718a803e320203f02f52165c0ce6765a0509',
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
