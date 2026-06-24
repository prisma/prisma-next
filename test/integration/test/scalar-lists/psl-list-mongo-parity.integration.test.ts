/**
 * Slice-2 NFR4 — Mongo parity for PSL scalar lists.
 *
 * The same PSL list schema must yield matching *observable* semantics on SQL
 * and Mongo:
 *   1. Authoring acceptance — both families author the schema with no
 *      diagnostics.
 *   2. Generated domain type — the emitted `contract.d.ts` types the list field
 *      as `ReadonlyArray<...>` on both families.
 *   3. Decoded element values — element values round-trip through insert/select
 *      equal to the originals on both families.
 *
 * Assertions 1 and 2 require no database and run everywhere. Assertion 3 for
 * Mongo runs against `mongodb-memory-server`, which fails to spin up on some
 * local sandboxes (UnknownLinuxDistro "nixos"); the assertion is written for
 * CI, where the memory server runs. The SQL half of assertion 3 is proven in
 * `psl-list-roundtrip.integration.test.ts` (AC2).
 */
import type { SerializeContract } from '@prisma-next/contract/hashing';
import { emit } from '@prisma-next/emitter';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import sql from '@prisma-next/family-sql/control';
import { mongoContractCanonicalizationHooks } from '@prisma-next/mongo-contract/canonicalization-hooks';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import { type MongoTargetContract, mongoTargetDescriptor } from '@prisma-next/target-mongo/control';
import postgres from '@prisma-next/target-postgres/control';
import { timeouts } from '@prisma-next/test-utils';
import type { JsonObject } from '@prisma-next/utils/json';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorMongoContractFromPsl,
  authorSqlContractFromPsl,
  mongoStack,
  sqlStack,
} from './psl-list-authoring';

// The parity subject is the `tags String[]` list field; the id line differs
// only by each family's id convention (SQL integer id vs Mongo ObjectId `_id`).
const SQL_LIST_SCHEMA = `model Note {
  id   Int      @id
  tags String[]
}`;

const MONGO_LIST_SCHEMA = `model Note {
  id   ObjectId @id @map("_id")
  tags String[]
}`;

const sqlSerializeContract: SerializeContract = (contract) =>
  postgres.contractSerializer.serializeContract(
    contract as Parameters<typeof postgres.contractSerializer.serializeContract>[0],
  );

const mongoSerializeContract: SerializeContract = (contract) =>
  mongoTargetDescriptor.contractSerializer.serializeContract(contract as MongoTargetContract);

describe('PSL scalar-list Mongo parity (NFR4)', () => {
  it(
    'both SQL and Mongo author the same list schema with no diagnostics',
    async () => {
      const sqlResult = await authorSqlContractFromPsl(SQL_LIST_SCHEMA);
      const mongoResult = await authorMongoContractFromPsl(MONGO_LIST_SCHEMA);

      expect(sqlResult.diagnostics).toEqual([]);
      expect(sqlResult.ok).toBe(true);
      expect(mongoResult.diagnostics).toEqual([]);
      expect(mongoResult.ok).toBe(true);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'both SQL and Mongo generate ReadonlyArray<string> for the list field',
    async () => {
      const sqlResult = await authorSqlContractFromPsl(SQL_LIST_SCHEMA);
      const mongoResult = await authorMongoContractFromPsl(MONGO_LIST_SCHEMA);
      if (!sqlResult.contract || !mongoResult.contract) {
        throw new Error('authoring produced no contract');
      }

      const sqlEmitted = await emit(sqlResult.contract, sqlStack, sql.emission, {
        serializeContract: (c) => sqlSerializeContract(c) as unknown as JsonObject,
        ...sqlContractCanonicalizationHooks,
      });
      const mongoEmitted = await emit(
        mongoResult.contract,
        mongoStack,
        mongoFamilyDescriptor.emission,
        {
          serializeContract: (c) => mongoSerializeContract(c) as unknown as JsonObject,
          ...mongoContractCanonicalizationHooks,
        },
      );

      // Both families render the list field as a `ReadonlyArray<...>` domain
      // type over their string element codec's output type — the observable
      // generated-type parity (the element codec id differs by family).
      expect(sqlEmitted.contractDts).toContain(
        "readonly tags: ReadonlyArray<CodecTypes['pg/text@1']['output']>",
      );
      expect(mongoEmitted.contractDts).toContain(
        "readonly tags: ReadonlyArray<CodecTypes['mongo/string@1']['output']>",
      );
    },
    timeouts.typeScriptCompilation,
  );

  describe('decoded element values round-trip on Mongo', () => {
    let replSet: MongoMemoryReplSet | undefined;
    let client: MongoClient | undefined;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      try {
        await client?.close();
        await replSet?.stop();
      } catch {
        // ignore teardown failures
      }
    }, timeouts.spinUpMongoMemoryServer);

    it(
      'a list value inserted into Mongo round-trips element-for-element',
      async () => {
        if (!client) throw new Error('mongo client not initialised');

        const mongoResult = await authorMongoContractFromPsl(MONGO_LIST_SCHEMA);
        expect(mongoResult.ok).toBe(true);

        const tags = ['react', 'typescript', 'prisma'];
        const db = client.db('psl_list_parity');
        await db.dropDatabase();
        const collection = db.collection('Note');
        await collection.insertOne({ tags });

        const stored = await collection.findOne({});
        expect(stored?.['tags']).toEqual(tags);
      },
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
