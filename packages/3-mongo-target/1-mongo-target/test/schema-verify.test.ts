import type { MongoContract, MongoStorageCollection } from '@prisma-next/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@prisma-next/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { verifyMongoSchema } from '../src/core/schema-verify/verify-mongo-schema';

function buildContract(
  collections: Record<string, MongoStorageCollection>,
  overrides?: Partial<MongoContract>,
): MongoContract {
  // String → branded hash casts: MongoContract uses branded `StorageHashBase` and
  // `ProfileHashBase` types that this fixture supplies as plain strings.
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    models: {},
    storage: {
      storageHash: 'sha256:test',
      collections,
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: 'sha256:profile',
    meta: {},
    ...overrides,
  } as unknown as MongoContract;
}

function ir(collections: MongoSchemaCollection[]): MongoSchemaIR {
  return new MongoSchemaIR(collections);
}

function coll(
  name: string,
  opts?: {
    indexes?: MongoSchemaIndex[];
    validator?: MongoSchemaValidator;
    options?: MongoSchemaCollectionOptions;
  },
): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: opts?.indexes ?? [],
    ...(opts?.validator ? { validator: opts.validator } : {}),
    ...(opts?.options ? { options: opts.options } : {}),
  });
}

function idx(
  keys: Array<{ field: string; direction: 1 | -1 }>,
  opts?: { unique?: boolean },
): MongoSchemaIndex {
  return new MongoSchemaIndex({ keys, ...opts });
}

describe('verifyMongoSchema', () => {
  describe('happy path', () => {
    it('passes for an empty contract against an empty live schema', () => {
      const result = verifyMongoSchema({
        contract: buildContract({}),
        schema: ir([]),
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.code).toBeUndefined();
      expect(result.schema.issues).toEqual([]);
      expect(result.schema.counts.fail).toBe(0);
      expect(result.contract.storageHash).toBe('sha256:test');
      expect(result.contract.profileHash).toBe('sha256:profile');
      expect(result.target.expected).toBe('mongo');
      expect(result.meta?.strict).toBe(true);
      expect(typeof result.timings.total).toBe('number');
    });

    it('passes when live schema mirrors the contract', () => {
      const contract = buildContract({
        users: {
          indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }],
        },
      });
      const liveSchema = ir([
        coll('users', {
          indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })],
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toEqual([]);
      expect(result.schema.counts.fail).toBe(0);
    });
  });

  describe('drift detection', () => {
    it('fails when a contract collection is missing from the live schema', () => {
      const result = verifyMongoSchema({
        contract: buildContract({ users: { indexes: [] } }),
        schema: ir([]),
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('PN-RUN-3010');
      expect(result.schema.counts.fail).toBeGreaterThan(0);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'missing_table', table: 'users' }),
      );
    });

    it('fails when a contract index is missing from a live collection', () => {
      const contract = buildContract({
        users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
      });
      const liveSchema = ir([coll('users')]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('PN-RUN-3010');
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'index_mismatch', table: 'users' }),
      );
    });

    it('fails on an extra live index in strict mode', () => {
      const contract = buildContract({ users: { indexes: [] } });
      const liveSchema = ir([
        coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.counts.fail).toBeGreaterThan(0);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'extra_index', table: 'users' }),
      );
    });

    it('warns (without failing) on an extra live index in non-strict mode', () => {
      const contract = buildContract({ users: { indexes: [] } });
      const liveSchema = ir([
        coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: false,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.code).toBeUndefined();
      expect(result.schema.counts.fail).toBe(0);
      expect(result.schema.counts.warn).toBeGreaterThan(0);
      expect(result.meta?.strict).toBe(false);
    });

    it('fails when the contract requires a validator that the live schema does not have', () => {
      const contract = buildContract({
        users: {
          indexes: [],
          validator: {
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const liveSchema = ir([coll('users')]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'type_missing', table: 'users' }),
      );
    });

    it('fails on an extra live validator in strict mode', () => {
      const contract = buildContract({ users: { indexes: [] } });
      const liveSchema = ir([
        coll('users', {
          validator: new MongoSchemaValidator({
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'extra_validator', table: 'users' }),
      );
    });

    it('fails when the validator differs between contract and live schema', () => {
      const contract = buildContract({
        users: {
          indexes: [],
          validator: {
            jsonSchema: { bsonType: 'object', required: ['email'] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      });
      const liveSchema = ir([
        coll('users', {
          validator: new MongoSchemaValidator({
            jsonSchema: { bsonType: 'object' },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'type_mismatch', table: 'users' }),
      );
    });

    it('fails on collection-options mismatches', () => {
      const contract = buildContract({
        events: {
          indexes: [],
          options: { capped: { size: 1024 } },
        },
      });
      const liveSchema = ir([
        coll('events', {
          options: new MongoSchemaCollectionOptions({ capped: { size: 2048 } }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({ kind: 'type_mismatch', table: 'events' }),
      );
    });
  });

  describe('envelope', () => {
    it('threads context.contractPath and context.configPath into meta', () => {
      const result = verifyMongoSchema({
        contract: buildContract({}),
        schema: ir([]),
        strict: true,
        frameworkComponents: [],
        context: { contractPath: '/tmp/contract.json', configPath: '/tmp/cfg.ts' },
      });

      expect(result.meta?.contractPath).toBe('/tmp/contract.json');
      expect(result.meta?.configPath).toBe('/tmp/cfg.ts');
      expect(result.meta?.strict).toBe(true);
    });

    it('omits profileHash when the contract has no profileHash', () => {
      // ProfileHashBase is a branded string; the cast scopes the override to the field.
      const contract = buildContract(
        {},
        { profileHash: '' as unknown as MongoContract['profileHash'] },
      );
      const result = verifyMongoSchema({
        contract,
        schema: ir([]),
        strict: false,
        frameworkComponents: [],
      });

      expect(result.contract.profileHash).toBeUndefined();
    });
  });

  describe('introspection canonicalization (F2 regression)', () => {
    // The reviewer reproduced 10 integration-test failures across 5 MongoDB
    // feature families — text indexes, collation collection options, timeseries,
    // clusteredIndex, and `changeStreamPreAndPostImages` — where
    // `contractToMongoSchemaIR` and `introspectSchema` produce different
    // canonical IR shapes for server-applied defaults. These tests feed
    // introspection-shaped IRs (mirroring what `introspectSchema` actually
    // returns from MongoDB) and contract-shaped IRs (what
    // `contractToMongoSchemaIR` produces) and assert that `verifyMongoSchema`
    // returns `ok` after canonicalization strips the server-applied defaults.

    describe('text indexes', () => {
      it('matches contract-shaped text keys against introspected _fts/_ftsx keys via weights', () => {
        const contract = buildContract({
          articles: {
            indexes: [
              {
                keys: [
                  { field: 'title', direction: 'text' },
                  { field: 'body', direction: 'text' },
                ],
                weights: { title: 10, body: 5 },
                default_language: 'english',
                language_override: 'idioma',
              },
            ],
          },
        });
        const liveSchema = ir([
          coll('articles', {
            indexes: [
              new MongoSchemaIndex({
                keys: [
                  { field: '_fts', direction: 'text' },
                  { field: '_ftsx', direction: 1 },
                ],
                weights: { title: 10, body: 5 },
                default_language: 'english',
                language_override: 'idioma',
              }),
            ],
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('matches a contract text index that omits weights against an introspected index with default weights', () => {
        // PSL `@@textIndex([title, body])` without `weights:` lowers to a
        // contract index whose `weights` is undefined. MongoDB defaults
        // server-side weights to a uniform `{title: 1, body: 1}` and returns
        // them from `listIndexes`. The canonicalizer must strip the live
        // weights so the lookup key matches the contract.
        const contract = buildContract({
          article: {
            indexes: [
              {
                keys: [
                  { field: 'title', direction: 'text' },
                  { field: 'body', direction: 'text' },
                ],
              },
            ],
          },
        });
        const liveSchema = ir([
          coll('article', {
            indexes: [
              new MongoSchemaIndex({
                keys: [
                  { field: '_fts', direction: 'text' },
                  { field: '_ftsx', direction: 1 },
                ],
                weights: { body: 1, title: 1 },
                default_language: 'english',
                language_override: 'language',
              }),
            ],
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('strips server-default text-index fields the contract did not specify', () => {
        const contract = buildContract({
          articles: {
            indexes: [
              {
                keys: [{ field: 'body', direction: 'text' }],
                weights: { body: 1 },
              },
            ],
          },
        });
        const liveSchema = ir([
          coll('articles', {
            indexes: [
              new MongoSchemaIndex({
                keys: [
                  { field: '_fts', direction: 'text' },
                  { field: '_ftsx', direction: 1 },
                ],
                weights: { body: 1 },
                default_language: 'english',
                language_override: 'language',
              }),
            ],
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });
    });

    describe('index collation', () => {
      it('strips server-only collation fields the contract did not specify', () => {
        const contract = buildContract({
          users: {
            indexes: [
              {
                keys: [{ field: 'name', direction: 1 }],
                collation: { locale: 'en', strength: 2 },
              },
            ],
          },
        });
        const liveSchema = ir([
          coll('users', {
            indexes: [
              new MongoSchemaIndex({
                keys: [{ field: 'name', direction: 1 }],
                collation: {
                  locale: 'en',
                  strength: 2,
                  alternate: 'non-ignorable',
                  backwards: false,
                  caseFirst: 'off',
                  caseLevel: false,
                  maxVariable: 'punct',
                  normalization: false,
                  numericOrdering: false,
                  version: '57.1',
                },
              }),
            ],
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });
    });

    describe('collection options collation', () => {
      it('strips server-only collation fields the contract did not specify', () => {
        const contract = buildContract({
          posts: {
            indexes: [],
            options: {
              collation: { locale: 'en', strength: 2 },
            },
          },
        });
        const liveSchema = ir([
          coll('posts', {
            options: new MongoSchemaCollectionOptions({
              collation: {
                locale: 'en',
                strength: 2,
                alternate: 'non-ignorable',
                backwards: false,
                caseFirst: 'off',
                caseLevel: false,
                maxVariable: 'punct',
                normalization: false,
                numericOrdering: false,
                version: '57.1',
              },
            }),
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });
    });

    describe('timeseries collection options', () => {
      it('strips bucketMaxSpanSeconds from live when contract did not specify it', () => {
        const contract = buildContract({
          metrics: {
            indexes: [],
            options: {
              timeseries: { timeField: 'ts', granularity: 'hours' },
            },
          },
        });
        const liveSchema = ir([
          coll('metrics', {
            options: new MongoSchemaCollectionOptions({
              timeseries: {
                timeField: 'ts',
                granularity: 'hours',
              },
            }),
          }),
        ]);
        // Force a server-default extra field to live via cast (the IR's
        // declared shape is narrower than what introspection actually returns
        // from MongoDB; tests must mirror the wide shape).
        const liveWithBucket = ir([
          coll('metrics', {
            options: new MongoSchemaCollectionOptions({
              timeseries: {
                timeField: 'ts',
                granularity: 'hours',
                // `bucketMaxSpanSeconds` is server-applied; the IR's declared
                // type doesn't expose it, so cast to inject.
                bucketMaxSpanSeconds: 2592000,
              } as unknown as { timeField: string; granularity: 'hours' },
            }),
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveWithBucket,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);

        // Sanity check: the canonical-already shape also passes.
        const sanity = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });
        expect(sanity.ok).toBe(true);
      });
    });

    describe('clusteredIndex collection options', () => {
      it('strips key, unique, v from live when contract did not specify them', () => {
        const contract = buildContract({
          clustered: {
            indexes: [],
            options: {
              clusteredIndex: { name: 'myCluster' },
            },
          },
        });
        const liveSchema = ir([
          coll('clustered', {
            options: new MongoSchemaCollectionOptions({
              // Server-applied extras (`key`, `unique`, `v`) are not in the IR's
              // declared shape; cast to inject them as introspection would.
              clusteredIndex: {
                name: 'myCluster',
                key: { _id: 1 },
                unique: true,
                v: 2,
              } as unknown as { name: string },
            }),
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });
    });

    describe('changeStreamPreAndPostImages collection options', () => {
      it('treats contract {enabled: false} and live undefined as equivalent', () => {
        const contract = buildContract({
          events: {
            indexes: [],
            options: {
              changeStreamPreAndPostImages: { enabled: false },
            },
          },
        });
        const liveSchema = ir([coll('events')]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('treats contract undefined and live {enabled: false} as equivalent', () => {
        const contract = buildContract({ events: { indexes: [] } });
        const liveSchema = ir([
          coll('events', {
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: false },
            }),
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('preserves {enabled: true} on both sides (still detects mismatches)', () => {
        const contract = buildContract({
          events: {
            indexes: [],
            options: { changeStreamPreAndPostImages: { enabled: true } },
          },
        });
        const liveSchema = ir([
          coll('events', {
            options: new MongoSchemaCollectionOptions({
              changeStreamPreAndPostImages: { enabled: true },
            }),
          }),
        ]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('still fails when contract wants {enabled: true} but live has {enabled: false}', () => {
        const contract = buildContract({
          events: {
            indexes: [],
            options: { changeStreamPreAndPostImages: { enabled: true } },
          },
        });
        const liveSchema = ir([coll('events')]);

        const result = verifyMongoSchema({
          contract,
          schema: liveSchema,
          strict: true,
          frameworkComponents: [],
        });

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
      });
    });
  });

  describe('synthetic-contract opt-out (F1 regression)', () => {
    // Locks in the minimum well-formed shape that synthetic-contract test
    // fixtures must use when they pair with `strictVerification: false` to
    // opt out of post-apply verification. The reviewer found three fixtures
    // (in test/integration and examples/) that supplied `{}` as the
    // contract; `contractToMongoSchemaIR` reads `contract.storage.collections`
    // unconditionally, so the runner crashed with `TypeError` before the
    // strict flag was consulted.
    function minimalContract(): MongoContract {
      // Mirrors the documented minimum shape: synthetic fixtures cannot
      // construct a fully-typed MongoContract, so they bypass the type
      // system with a single-purpose `as unknown as` cast and supply only
      // the `storage` shape `contractToMongoSchemaIR` actually reads.
      return {
        storage: { storageHash: 'sha256:authoring-test', collections: {} },
      } as unknown as MongoContract;
    }

    it('does not throw when contract has empty storage.collections', () => {
      expect(() =>
        verifyMongoSchema({
          contract: minimalContract(),
          schema: ir([coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] })]),
          strict: false,
          frameworkComponents: [],
        }),
      ).not.toThrow();
    });

    it('returns ok with strict: false even when live schema has extra collections/indexes', () => {
      const result = verifyMongoSchema({
        contract: minimalContract(),
        schema: ir([
          coll('users', { indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })] }),
          coll('posts'),
        ]),
        strict: false,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.counts.fail).toBe(0);
    });
  });
});
