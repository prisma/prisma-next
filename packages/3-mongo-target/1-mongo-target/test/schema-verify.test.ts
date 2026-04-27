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

      it('surfaces drift when live weights are non-uniform but the contract authored none', () => {
        // The canonicalizer only strips `weights` from live when the contract
        // omits them *and* the live weights match MongoDB's server default
        // (every projected text key weighted at 1). A tampered live index
        // with non-uniform weights — e.g. a relevance boost applied
        // out-of-band — must surface as drift so verify can fail.
        const contract = buildContract({
          articles: {
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
          coll('articles', {
            indexes: [
              new MongoSchemaIndex({
                keys: [
                  { field: '_fts', direction: 'text' },
                  { field: '_ftsx', direction: 1 },
                ],
                weights: { title: 5, body: 1 },
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

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
      });

      it('surfaces drift when live default_language is non-default but the contract authored none', () => {
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
                default_language: 'spanish',
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

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
      });

      it('surfaces drift when live language_override is non-default but the contract authored none', () => {
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

        expect(result.ok).toBe(false);
        expect(result.schema.counts.fail).toBeGreaterThan(0);
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

  describe('introspection canonicalization (additional coverage)', () => {
    // These tests pin down branches in the introspection canonicalizer that
    // the F2 regression suite leaves untested: optional index/options fields
    // beyond text-index defaults, contract/live counterparts that differ in
    // shape, and edge-cases in `stripUnspecifiedFields` and
    // `findExpectedIndexCounterpart`.

    it('matches live indexes that carry sparse/TTL/partial/wildcard against equivalent contract indexes', () => {
      const contract = buildContract({
        events: {
          indexes: [
            {
              keys: [{ field: 'createdAt', direction: 1 }],
              unique: true,
              sparse: true,
              expireAfterSeconds: 3600,
              partialFilterExpression: { archived: false },
              wildcardProjection: { 'meta.$**': 1 },
            },
          ],
        },
      });
      const liveSchema = ir([
        coll('events', {
          indexes: [
            new MongoSchemaIndex({
              keys: [{ field: 'createdAt', direction: 1 }],
              unique: true,
              sparse: true,
              expireAfterSeconds: 3600,
              partialFilterExpression: { archived: false },
              wildcardProjection: { 'meta.$**': 1 },
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

    it('preserves contract text-index option spreads (unique/sparse/TTL/partial/wildcard/collation)', () => {
      // The text-side canonicalizer (`canonicalizeTextIndexKeyOrder`) carries
      // every optional index field through. Authoring a contract text index
      // with the full set of optional fields exercises each conditional
      // spread on the contract side.
      const contract = buildContract({
        articles: {
          indexes: [
            {
              keys: [
                { field: 'title', direction: 'text' },
                { field: 'body', direction: 'text' },
              ],
              unique: false,
              sparse: true,
              expireAfterSeconds: 86_400,
              partialFilterExpression: { published: true },
              wildcardProjection: { tags: 1 },
              collation: { locale: 'en' },
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
              unique: false,
              sparse: true,
              expireAfterSeconds: 86_400,
              partialFilterExpression: { published: true },
              wildcardProjection: { tags: 1 },
              collation: { locale: 'en' },
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

    it('matches a capped collection authored on both sides', () => {
      // The schema-diff `options` tests already cover capped semantics, but
      // they invoke `diffMongoSchemas` directly. Routing capped through
      // `verifyMongoSchema` exercises both `canonicalizeLiveOptions` and
      // `canonicalizeExpectedOptions` capped spreads.
      const contract = buildContract({
        logs: {
          indexes: [],
          options: { capped: { size: 1024, max: 100 } },
        },
      });
      const liveSchema = ir([
        coll('logs', {
          options: new MongoSchemaCollectionOptions({ capped: { size: 1024, max: 100 } }),
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

    it('strips live index/options collation when no expected counterpart authors the field', () => {
      // `stripUnspecifiedFields` returns `undefined` when its `expected`
      // argument is undefined — i.e. the contract neither named the field
      // nor authored anything in that block. Exercise this by having live
      // collation present while the contract is silent about it.
      const contract = buildContract({ posts: { indexes: [] } });
      const liveSchema = ir([
        coll('posts', {
          indexes: [
            new MongoSchemaIndex({
              keys: [{ field: 'title', direction: 1 }],
              collation: { locale: 'en', strength: 2 },
            }),
          ],
          options: new MongoSchemaCollectionOptions({
            collation: { locale: 'en', strength: 2 },
          }),
        }),
      ]);

      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: false,
        frameworkComponents: [],
      });

      // Without strict mode, the extra index/options surface as warnings.
      // We only care that canonicalization runs to completion (no throw)
      // and that the no-match path through `findExpectedIndexCounterpart`
      // does not crash on absent expected indexes.
      expect(result.ok).toBe(true);
      expect(result.schema.counts.warn).toBeGreaterThan(0);
    });

    it('keeps the scalar prefix of a compound text index in place', () => {
      // A compound text index mixes scalar keys (e.g. `{category: 1}`) with
      // a text block. `sortTextKeys` walks the keys in order and only
      // replaces the text-direction entries — so contracts that author
      // their scalar keys as a *prefix* (mongo's `projectTextIndexKeys`
      // emits `[...scalars, ...textKeys]`) round-trip cleanly. This pins
      // the prefix-only layout and exercises both branches of the
      // text/non-text ternary inside `sortTextKeys`.
      const contract = buildContract({
        articles: {
          indexes: [
            {
              keys: [
                { field: 'category', direction: 1 },
                { field: 'priority', direction: -1 },
                { field: 'title', direction: 'text' },
                { field: 'body', direction: 'text' },
              ],
              weights: { title: 5, body: 1 },
            },
          ],
        },
      });
      const liveSchema = ir([
        coll('articles', {
          indexes: [
            new MongoSchemaIndex({
              keys: [
                { field: 'category', direction: 1 },
                { field: 'priority', direction: -1 },
                { field: '_fts', direction: 'text' },
                { field: '_ftsx', direction: 1 },
              ],
              weights: { title: 5, body: 1 },
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

    it('keeps both scalar prefix and suffix of a compound text index in place', () => {
      // Compound text indexes can interleave scalars on both sides of the
      // text block, e.g. `[category, _fts, _ftsx, priority]` from MongoDB's
      // introspected layout. Splice projected text keys back into the
      // original `_fts/_ftsx` slot so the contract-authored shape
      // `[category, ...textFields, priority]` round-trips. Flattening
      // scalars first would yield `[category, priority, ...textFields]`,
      // which `sortTextKeys` cannot recover.
      const contract = buildContract({
        articles: {
          indexes: [
            {
              keys: [
                { field: 'category', direction: 1 },
                { field: 'title', direction: 'text' },
                { field: 'body', direction: 'text' },
                { field: 'priority', direction: -1 },
              ],
              weights: { title: 5, body: 1 },
            },
          ],
        },
      });
      const liveSchema = ir([
        coll('articles', {
          indexes: [
            new MongoSchemaIndex({
              keys: [
                { field: 'category', direction: 1 },
                { field: '_fts', direction: 'text' },
                { field: '_ftsx', direction: 1 },
                { field: 'priority', direction: -1 },
              ],
              weights: { title: 5, body: 1 },
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

    it('drops contract-named collation fields that the live counterpart does not provide', () => {
      // `stripUnspecifiedFields` iterates over the *expected* keys and only
      // copies the value through when the live block also has that key.
      // Contracts that author a richer collation than the introspected one
      // exercise the "key not in live" branch — the resulting canonical
      // collation is a strict subset of what the contract requested, which
      // surfaces as drift (the test only requires that the canonicalizer
      // walks this branch without crashing).
      const contract = buildContract({
        users: {
          indexes: [
            {
              keys: [{ field: 'name', direction: 1 }],
              collation: { locale: 'en', strength: 2, caseLevel: true },
            },
          ],
        },
      });
      const liveSchema = ir([
        coll('users', {
          indexes: [
            new MongoSchemaIndex({
              keys: [{ field: 'name', direction: 1 }],
              collation: { locale: 'en', strength: 2 },
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

      // Live's collation lacks `caseLevel`; after stripping, the canonical
      // live collation is `{locale, strength}` which doesn't match the
      // contract's three-field collation, so verification surfaces drift.
      expect(result.ok).toBe(false);
      expect(result.schema.counts.fail).toBeGreaterThan(0);
    });

    it('returns live keys unchanged for a live _fts index that has no weights map', () => {
      // The contract gets to author `weights`. If the introspected index
      // happens to have `_fts/_ftsx` but no `weights` map (a degenerate
      // shape that `listIndexes` shouldn't normally return, but the
      // canonicalizer handles), `projectTextIndexKeys` falls through to
      // `liveIndex.keys`, which then doesn't match the contract-shaped key
      // list and surfaces as drift.
      const contract = buildContract({
        articles: {
          indexes: [{ keys: [{ field: 'title', direction: 'text' }] }],
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

      // The contract expects `{title: 'text'}`; without `weights` we cannot
      // project the live index back to that shape, so the contract index
      // shows as missing and the live `_fts` index as extra.
      expect(result.ok).toBe(false);
      expect(result.schema.counts.fail).toBeGreaterThan(0);
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
