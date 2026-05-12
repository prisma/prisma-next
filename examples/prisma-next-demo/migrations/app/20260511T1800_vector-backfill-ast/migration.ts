#!/usr/bin/env -S node
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import postgres from '@prisma-next/postgres/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = validateContract<Contract>(endContractJson, emptyCodecLookup);
const db = postgres<Contract>({ contractJson: endContractJson, extensions: [pgvector] });

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:6cee6146eaf257ce236bf1144efb238a1087e45a62e04a8104a55d490d9029f4',
      to: 'sha256:6cee6146eaf257ce236bf1144efb238a1087e45a62e04a8104a55d490d9029f4',
    };
  }

  override get operations() {
    return [
      this.dataTransformAst(endContract, 'vector-backfill', {
        check: () =>
          db.sql.post
            .select('id')
            .where((f, fns) => fns.eq(f.embedding, null))
            .limit(1),
        run: () =>
          db.sql.post
            .update({ embedding: new Array(1536).fill(0) })
            .where((f, fns) => fns.eq(f.embedding, null)),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
