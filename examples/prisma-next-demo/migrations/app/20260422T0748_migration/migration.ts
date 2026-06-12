#!/usr/bin/env -S node
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import postgres from '@prisma-next/postgres/runtime';
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = new SqlContractSerializer().deserializeContract(endContractJson) as Contract;
const db = postgres<Contract>({ contractJson: endContractJson, extensions: [pgvector] });

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:a12e04d6c0659fefdb8f5082a555117c88092bd11fd66221d634c75ef9c0a1bc',
      to: 'sha256:7c31c2e1119a16c7cc438e6fd132c34f0872d70bfbc3d2a888a4d5d44730d07b',
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
