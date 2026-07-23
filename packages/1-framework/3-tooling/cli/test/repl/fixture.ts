/**
 * Minimal contract JSON fixture for REPL unit tests. Mirrors the shape of an
 * emitted contract (roots + domain + storage planes) with two tables, two
 * models, one relation, and one enum.
 */
export const replContractFixture = {
  schemaVersion: 'contract/v1',
  targetFamily: 'sql',
  target: 'postgres',
  roots: {
    user: { model: 'User', namespace: 'public' },
    post: { model: 'Post', namespace: 'public' },
  },
  domain: {
    namespaces: {
      public: {
        enum: {
          Priority: {
            codecId: 'pg/text@1',
            members: [
              { name: 'Low', value: 'low' },
              { name: 'High', value: 'high' },
            ],
          },
        },
        models: {
          User: {
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/uuid@1' } },
              email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              createdAt: { nullable: false, type: { kind: 'scalar', codecId: 'pg/timestamptz@1' } },
            },
            relations: {
              posts: {
                cardinality: '1:N',
                on: { localFields: ['id'], targetFields: ['userId'] },
                to: { model: 'Post', namespace: 'public' },
              },
            },
            storage: {
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
                createdAt: { column: 'createdAt' },
              },
              namespaceId: 'public',
              table: 'user',
            },
          },
          Post: {
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/uuid@1' } },
              title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              userId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/uuid@1' } },
            },
            relations: {
              user: {
                cardinality: 'N:1',
                on: { localFields: ['userId'], targetFields: ['id'] },
                to: { model: 'User', namespace: 'public' },
              },
            },
            storage: {
              fields: {
                id: { column: 'id' },
                title: { column: 'title' },
                userId: { column: 'userId' },
              },
              namespaceId: 'public',
              table: 'post',
            },
          },
        },
        valueObjects: {},
      },
    },
  },
  storage: {
    storageHash: 'test-hash',
    namespaces: {
      public: {
        id: 'public',
        kind: 'sql',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                createdAt: {
                  codecId: 'pg/timestamptz@1',
                  nativeType: 'timestamptz',
                  nullable: false,
                },
              },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              indexes: [],
              uniques: [],
            },
            post: {
              columns: {
                id: { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                userId: { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              indexes: [],
              uniques: [],
            },
          },
          valueSet: {
            Priority: {},
          },
        },
      },
    },
  },
  execution: { executionHash: 'x', mutations: { defaults: [] } },
  capabilities: { sql: { returning: true } },
  extensionPacks: {},
  meta: {},
} as const;
