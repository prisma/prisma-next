import { describe, expect, it } from 'vitest';
import {
  bm25ExprField,
  bm25Field,
  bm25Index,
  col,
  contract,
  fk,
  index,
  model,
  pk,
  storage,
  table,
  unique,
} from '../src/factories';

describe('SQL contract factories', () => {
  describe('col', () => {
    it('creates a StorageColumn with nativeType, codecId and nullable', () => {
      const column = col('int4', 'pg/int4@1', false);
      expect(column).toEqual({
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      });
    });

    it('defaults nullable to false', () => {
      const column = col('text', 'pg/text@1');
      expect(column).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
    });

    it('creates nullable column', () => {
      const column = col('text', 'pg/text@1', true);
      expect(column).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: true,
      });
    });
  });

  describe('pk', () => {
    it('creates a PrimaryKey with columns', () => {
      const primaryKey = pk('id');
      expect(primaryKey).toEqual({
        columns: ['id'],
      });
    });

    it('creates composite primary key', () => {
      const primaryKey = pk('id', 'tenantId');
      expect(primaryKey).toEqual({
        columns: ['id', 'tenantId'],
      });
    });

    it('creates primary key with name', () => {
      const primaryKey = pk('id');
      expect(primaryKey.columns).toEqual(['id']);
      // name is optional and can be set via object spread if needed
      const withName = { ...primaryKey, name: 'user_pkey' };
      expect(withName.name).toBe('user_pkey');
    });
  });

  describe('unique', () => {
    it('creates a UniqueConstraint with columns', () => {
      const uniqueConstraint = unique('email');
      expect(uniqueConstraint).toEqual({
        columns: ['email'],
      });
    });

    it('creates composite unique constraint', () => {
      const uniqueConstraint = unique('userId', 'postId');
      expect(uniqueConstraint).toEqual({
        columns: ['userId', 'postId'],
      });
    });
  });

  describe('index', () => {
    it('creates an Index with columns', () => {
      const idx = index('email');
      expect(idx).toEqual({
        columns: ['email'],
      });
    });

    it('creates composite index', () => {
      const idx = index('userId', 'createdAt');
      expect(idx).toEqual({
        columns: ['userId', 'createdAt'],
      });
    });
  });

  describe('fk', () => {
    it('creates a ForeignKey', () => {
      const foreignKey = fk(['userId'], 'user', ['id']);
      expect(foreignKey).toEqual({
        columns: ['userId'],
        references: {
          table: 'user',
          columns: ['id'],
        },
        constraint: true,
        index: true,
      });
    });

    it('creates foreign key with name', () => {
      const foreignKey = fk(['userId'], 'user', ['id'], { name: 'user_posts_fkey' });
      expect(foreignKey).toEqual({
        columns: ['userId'],
        references: {
          table: 'user',
          columns: ['id'],
        },
        constraint: true,
        index: true,
        name: 'user_posts_fkey',
      });
    });

    it('creates composite foreign key', () => {
      const foreignKey = fk(['tenantId', 'userId'], 'user', ['tenantId', 'id']);
      expect(foreignKey).toEqual({
        columns: ['tenantId', 'userId'],
        references: {
          table: 'user',
          columns: ['tenantId', 'id'],
        },
        constraint: true,
        index: true,
      });
    });

    it('creates foreign key with onDelete via options object', () => {
      const foreignKey = fk(['userId'], 'user', ['id'], { onDelete: 'cascade' });
      expect(foreignKey).toEqual({
        columns: ['userId'],
        references: { table: 'user', columns: ['id'] },
        onDelete: 'cascade',
        constraint: true,
        index: true,
      });
    });

    it('creates foreign key with onDelete and onUpdate', () => {
      const foreignKey = fk(['userId'], 'user', ['id'], {
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
      expect(foreignKey).toEqual({
        columns: ['userId'],
        references: { table: 'user', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'noAction',
        constraint: true,
        index: true,
      });
    });

    it('creates foreign key with name and referential actions via options', () => {
      const foreignKey = fk(['userId'], 'user', ['id'], {
        name: 'post_userId_fkey',
        onDelete: 'setNull',
        onUpdate: 'cascade',
      });
      expect(foreignKey).toEqual({
        columns: ['userId'],
        references: { table: 'user', columns: ['id'] },
        name: 'post_userId_fkey',
        onDelete: 'setNull',
        onUpdate: 'cascade',
        constraint: true,
        index: true,
      });
    });

    it.each([
      'noAction',
      'restrict',
      'cascade',
      'setNull',
      'setDefault',
    ] as const)('accepts %s as a referential action', (action) => {
      const foreignKey = fk(['userId'], 'user', ['id'], { onDelete: action });
      expect(foreignKey.onDelete).toBe(action);
    });

    it('omits undefined referential actions from output', () => {
      const foreignKey = fk(['userId'], 'user', ['id'], { onDelete: 'cascade' });
      expect(foreignKey).not.toHaveProperty('onUpdate');
    });
  });

  describe('table', () => {
    it('creates a StorageTable with columns', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      expect(userTable.columns).toEqual({
        id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      });
      expect(userTable.uniques).toEqual([]);
      expect(userTable.indexes).toEqual([]);
      expect(userTable.foreignKeys).toEqual([]);
    });

    it('creates table with primary key', () => {
      const userTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          email: col('text', 'pg/text@1'),
        },
        { pk: pk('id') },
      );
      expect(userTable.primaryKey).toEqual({ columns: ['id'] });
    });

    it('creates table with unique constraints', () => {
      const userTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          email: col('text', 'pg/text@1'),
        },
        { uniques: [unique('email')] },
      );
      expect(userTable.uniques).toEqual([{ columns: ['email'] }]);
    });

    it('creates table with indexes', () => {
      const userTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          email: col('text', 'pg/text@1'),
        },
        { indexes: [index('email')] },
      );
      expect(userTable.indexes).toEqual([{ columns: ['email'] }]);
    });

    it('creates table with foreign keys', () => {
      const postTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          userId: col('int4', 'pg/int4@1'),
        },
        { fks: [fk(['userId'], 'user', ['id'])] },
      );
      expect(postTable.foreignKeys).toEqual([
        {
          columns: ['userId'],
          references: { table: 'user', columns: ['id'] },
          constraint: true,
          index: true,
        },
      ]);
    });

    it('creates table with all constraints', () => {
      const postTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          userId: col('int4', 'pg/int4@1'),
          title: col('text', 'pg/text@1'),
        },
        {
          pk: pk('id'),
          uniques: [unique('title')],
          indexes: [index('userId')],
          fks: [fk(['userId'], 'user', ['id'])],
        },
      );
      expect(postTable.primaryKey).toEqual({ columns: ['id'] });
      expect(postTable.uniques).toEqual([{ columns: ['title'] }]);
      expect(postTable.indexes).toEqual([{ columns: ['userId'] }]);
      expect(postTable.foreignKeys).toEqual([
        {
          columns: ['userId'],
          references: { table: 'user', columns: ['id'] },
          constraint: true,
          index: true,
        },
      ]);
    });
  });

  describe('bm25Field', () => {
    it('creates a column-based field config with defaults', () => {
      const field = bm25Field('description');
      expect(field).toEqual({ column: 'description' });
    });

    it('creates a field config with tokenizer', () => {
      const field = bm25Field('description', { tokenizer: 'simple' });
      expect(field).toEqual({ column: 'description', tokenizer: 'simple' });
    });

    it('creates a field config with tokenizer and params', () => {
      const field = bm25Field('description', {
        tokenizer: 'ngram',
        tokenizerParams: { min: 2, max: 5 },
      });
      expect(field).toEqual({
        column: 'description',
        tokenizer: 'ngram',
        tokenizerParams: { min: 2, max: 5 },
      });
    });

    it('creates a field config with alias for multi-tokenizer', () => {
      const field = bm25Field('description', {
        tokenizer: 'simple',
        alias: 'description_simple',
      });
      expect(field).toEqual({
        column: 'description',
        tokenizer: 'simple',
        alias: 'description_simple',
      });
    });

    it('omits undefined optional fields', () => {
      const field = bm25Field('category', {});
      expect(field).toEqual({ column: 'category' });
      expect(field).not.toHaveProperty('tokenizer');
      expect(field).not.toHaveProperty('tokenizerParams');
      expect(field).not.toHaveProperty('alias');
    });
  });

  describe('bm25ExprField', () => {
    it('creates an expression-based field config', () => {
      const field = bm25ExprField("description || ' ' || category", {
        alias: 'concat',
        tokenizer: 'simple',
      });
      expect(field).toEqual({
        expression: "description || ' ' || category",
        alias: 'concat',
        tokenizer: 'simple',
      });
    });

    it('creates expression field with tokenizer params', () => {
      const field = bm25ExprField("(metadata->>'color')", {
        alias: 'meta_color',
        tokenizer: 'ngram',
        tokenizerParams: { min: 2, max: 3 },
      });
      expect(field).toEqual({
        expression: "(metadata->>'color')",
        alias: 'meta_color',
        tokenizer: 'ngram',
        tokenizerParams: { min: 2, max: 3 },
      });
    });

    it('creates expression field without tokenizer', () => {
      const field = bm25ExprField('rating + 1', { alias: 'rating_plus' });
      expect(field).toEqual({
        expression: 'rating + 1',
        alias: 'rating_plus',
      });
    });
  });

  describe('bm25Index', () => {
    it('creates a BM25 index with column-based fields', () => {
      const idx = bm25Index({
        keyField: 'id',
        fields: [bm25Field('description'), bm25Field('category')],
      });
      expect(idx).toEqual({
        columns: ['description', 'category'],
        using: 'bm25',
        keyField: 'id',
        fieldConfigs: [{ column: 'description' }, { column: 'category' }],
      });
    });

    it('creates a named BM25 index', () => {
      const idx = bm25Index({
        keyField: 'id',
        fields: [bm25Field('description')],
        name: 'search_idx',
      });
      expect(idx.name).toBe('search_idx');
      expect(idx.using).toBe('bm25');
    });

    it('creates BM25 index with mixed field types', () => {
      const idx = bm25Index({
        keyField: 'id',
        fields: [
          bm25Field('description', { tokenizer: 'simple' }),
          bm25Field('rating'),
          bm25ExprField("(metadata->>'color')", {
            alias: 'meta_color',
            tokenizer: 'ngram',
            tokenizerParams: { min: 2, max: 3 },
          }),
        ],
      });
      expect(idx.columns).toEqual(['description', 'rating', 'meta_color']);
      expect(idx.fieldConfigs).toHaveLength(3);
      expect(idx.fieldConfigs![2]).toEqual({
        expression: "(metadata->>'color')",
        alias: 'meta_color',
        tokenizer: 'ngram',
        tokenizerParams: { min: 2, max: 3 },
      });
    });

    it('round-trips through JSON serialization', () => {
      const idx = bm25Index({
        keyField: 'id',
        fields: [
          bm25Field('description', { tokenizer: 'ngram', tokenizerParams: { min: 2, max: 5 } }),
          bm25ExprField("description || ' ' || category", { alias: 'concat', tokenizer: 'simple' }),
        ],
        name: 'search_idx',
      });
      const roundTripped = JSON.parse(JSON.stringify(idx));
      expect(roundTripped).toEqual(idx);
    });

    it('creates a table with BM25 index alongside plain indexes', () => {
      const t = table(
        {
          id: col('int4', 'pg/int4@1'),
          description: col('text', 'pg/text@1'),
          email: col('text', 'pg/text@1'),
        },
        {
          pk: pk('id'),
          indexes: [
            index('email'),
            bm25Index({
              keyField: 'id',
              fields: [bm25Field('description')],
              name: 'search_idx',
            }),
          ],
        },
      );
      expect(t.indexes).toHaveLength(2);
      expect(t.indexes[0]).toEqual({ columns: ['email'] });
      expect(t.indexes[1]).toMatchObject({ using: 'bm25', keyField: 'id', name: 'search_idx' });
    });
  });

  describe('model', () => {
    it('creates a ModelDefinition', () => {
      const userModel = model('user', {
        id: { column: 'id' },
        email: { column: 'email' },
      });
      expect(userModel).toEqual({
        storage: { table: 'user' },
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
        relations: {},
      });
    });

    it('creates model with relations', () => {
      const userModel = model(
        'user',
        {
          id: { column: 'id' },
        },
        {
          posts: { kind: 'oneToMany', model: 'Post', foreignKey: 'userId' },
        },
      );
      expect(userModel.storage.table).toBe('user');
      expect(userModel.fields).toEqual({ id: { column: 'id' } });
      expect(userModel.relations).toEqual({
        posts: { kind: 'oneToMany', model: 'Post', foreignKey: 'userId' },
      });
    });
  });

  describe('storage', () => {
    it('creates SqlStorage from tables', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      const s = storage({ user: userTable });
      expect(s.tables).toEqual({
        user: userTable,
      });
    });
  });

  describe('contract', () => {
    it('creates a SqlContract with minimal options', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
      });
      expect(c.target).toBe('postgres');
      expect(c.targetFamily).toBe('sql');
      expect(c.storageHash).toBe('sha256:abc123');
      expect(c.storage).toEqual(s);
      expect(c.models).toEqual({});
      expect(c.relations).toEqual({});
      expect(c.schemaVersion).toBe('1');
    });

    it('creates contract with models', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      const s = storage({ user: userTable });
      const m = {
        User: model('user', {
          id: { column: 'id' },
          email: { column: 'email' },
        }),
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        models: m,
      });
      expect(c.models).toEqual(m);
    });

    it('creates contract with relations', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const relations = {
        user: {
          posts: { kind: 'oneToMany', model: 'Post', foreignKey: 'userId' },
        },
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        relations,
      });
      expect(c.relations).toEqual(relations);
    });

    it('creates contract with profileHash', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        profileHash: 'sha256:def456',
        storage: s,
      });
      expect(c.profileHash).toBe('sha256:def456');
    });

    it('creates contract with capabilities', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const capabilities = {
        postgres: {
          returning: true,
          lateral: true,
          jsonAgg: true,
        },
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        capabilities,
      });
      expect(c.capabilities).toEqual(capabilities);
    });

    it('creates contract with extension packs', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const extensionPacks = {
        postgres: {
          id: 'postgres',
          version: '0.0.1',
        },
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        extensionPacks,
      });
      expect(c.extensionPacks).toEqual(extensionPacks);
    });

    it('creates contract with meta', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const meta = {
        generated: true,
        timestamp: '2024-01-01T00:00:00Z',
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        meta,
      });
      expect(c.meta).toEqual(meta);
    });

    it('creates contract with sources', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const sources = {
        userView: {
          kind: 'view',
          sql: 'SELECT * FROM "user"',
        },
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        sources,
      });
      expect(c.sources).toEqual(sources);
    });

    it('creates contract with mappings', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
      });
      const s = storage({ user: userTable });
      const mappings = {
        modelToTable: { User: 'user' },
        tableToModel: { user: 'User' },
        codecTypes: {
          'pg/int4@1': { output: 'number' },
        },
        operationTypes: {},
      };
      const c = contract({
        target: 'postgres',
        storageHash: 'sha256:abc123',
        storage: s,
        mappings,
      });
      expect(c.mappings).toEqual(mappings);
    });
  });
});
