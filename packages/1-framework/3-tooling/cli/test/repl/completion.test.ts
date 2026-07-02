import { describe, expect, it } from 'vitest';
import { complete } from '../../src/repl/completion';
import { extractReplSchemaInfo } from '../../src/repl/schema-info';
import { replContractFixture } from './fixture';

const schema = extractReplSchemaInfo(replContractFixture);

function labels(buffer: string, cursor = buffer.length): string[] {
  return complete(buffer, cursor, schema).items.map((i) => i.label);
}

describe('complete: top level', () => {
  it('suggests db at empty input', () => {
    expect(labels('')).toContain('db');
  });

  it('filters globals by prefix', () => {
    expect(labels('d')).toContain('db');
    expect(labels('d')).not.toContain('console');
  });

  it('completes meta commands after a leading dot', () => {
    const items = labels('.he');
    expect(items).toContain('.help');
  });

  it('completes psql-style backslash aliases', () => {
    expect(labels('\\d')).toEqual(expect.arrayContaining(['\\d', '\\dt']));
  });
});

describe('complete: db members', () => {
  it('suggests lanes after db.', () => {
    const items = labels('db.');
    expect(items).toEqual(expect.arrayContaining(['sql', 'orm', 'enums', 'raw', 'runtime']));
  });

  it('filters db members by prefix', () => {
    expect(labels('db.s')).toEqual(['sql']);
  });

  it('replaces from the start of the partial token', () => {
    const result = complete('db.or', 5, schema);
    expect(result.from).toBe(3);
    expect(result.items[0]?.label).toBe('orm');
  });
});

describe('complete: sql lane', () => {
  it('suggests namespaces after db.sql.', () => {
    expect(labels('db.sql.')).toEqual(['public']);
  });

  it('suggests tables after db.sql.public.', () => {
    expect(labels('db.sql.public.')).toEqual(['user', 'post']);
  });

  it('suggests table methods after a table', () => {
    const items = labels('db.sql.public.user.');
    expect(items).toEqual(expect.arrayContaining(['select', 'insert', 'update', 'delete', 'as']));
  });

  it('suggests chain methods after select(...)', () => {
    const items = labels("db.sql.public.user.select('id').");
    expect(items).toEqual(expect.arrayContaining(['where', 'orderBy', 'limit', 'offset', 'build']));
    expect(items).not.toContain('insert');
  });

  it('suggests columns inside select string args', () => {
    expect(labels("db.sql.public.user.select('")).toEqual(['id', 'email', 'createdAt']);
  });

  it('filters columns by partial inside string', () => {
    expect(labels("db.sql.public.user.select('e")).toEqual(['email']);
  });

  it('suggests columns in later string args of the same call', () => {
    expect(labels("db.sql.public.user.select('id', '")).toEqual(['id', 'email', 'createdAt']);
  });

  it('suggests columns inside orderBy string args', () => {
    expect(labels("db.sql.public.post.orderBy('")).toEqual(['id', 'title', 'userId']);
  });

  it('completes where-lambda field params with columns', () => {
    expect(labels("db.sql.public.user.select('id').where((f, fns) => f.")).toEqual([
      'id',
      'email',
      'createdAt',
    ]);
  });

  it('completes where-lambda fns param with expression functions', () => {
    const items = labels("db.sql.public.user.select('id').where((f, fns) => fns.");
    expect(items).toEqual(expect.arrayContaining(['eq', 'and', 'or', 'gt', 'count', 'raw']));
  });

  it('suggests mutation chain methods after insert(...)', () => {
    const items = labels('db.sql.public.user.insert([{}]).');
    expect(items).toEqual(expect.arrayContaining(['returning', 'build']));
    expect(items).not.toContain('limit');
  });
});

describe('complete: orm lane', () => {
  it('suggests namespaces after db.orm.', () => {
    expect(labels('db.orm.')).toEqual(['public']);
  });

  it('suggests models after db.orm.public.', () => {
    expect(labels('db.orm.public.')).toEqual(['User', 'Post']);
  });

  it('suggests collection methods after a model', () => {
    const items = labels('db.orm.public.User.');
    expect(items).toEqual(expect.arrayContaining(['where', 'select', 'include', 'all', 'first']));
  });

  it('suggests fields inside orm select string args', () => {
    expect(labels("db.orm.public.User.select('")).toEqual(['id', 'email', 'createdAt']);
  });

  it('suggests relations inside include string args', () => {
    expect(labels("db.orm.public.User.include('")).toEqual(['posts']);
  });

  it('completes orm where-lambda param with fields and relations', () => {
    expect(labels('db.orm.public.User.where((u) => u.')).toEqual([
      'id',
      'email',
      'createdAt',
      'posts',
    ]);
  });

  it('completes comparison methods after a lambda field', () => {
    const items = labels('db.orm.public.User.where((u) => u.email.');
    expect(items).toEqual(expect.arrayContaining(['eq', 'like', 'ilike', 'in', 'isNull']));
  });

  it('keeps chain context across chained calls', () => {
    const items = labels("db.orm.public.Post.where((p) => p.title.like('%x%')).");
    expect(items).toEqual(expect.arrayContaining(['select', 'take', 'all']));
  });
});

describe('complete: nested lambda contexts', () => {
  it('treats the include callback param as a collection of the target model', () => {
    const items = labels("db.orm.public.User.include('posts', (p) => p.");
    expect(items).toEqual(expect.arrayContaining(['select', 'where', 'orderBy', 'take', 'skip']));
    expect(items).not.toContain('email');
  });

  it('completes target-model fields inside the include callback select string', () => {
    expect(labels("db.orm.public.User.include('posts', (p) => p.select('")).toEqual([
      'id',
      'title',
      'userId',
    ]);
  });

  it('completes target-model fields in relation predicate callbacks', () => {
    expect(labels('db.orm.public.User.where((u) => u.posts.some((p) => p.')).toEqual([
      'id',
      'title',
      'userId',
      'user',
    ]);
  });

  it('keeps outer params resolvable inside nested callbacks', () => {
    const items = labels('db.orm.public.User.where((u) => u.posts.some((p) => p.title.');
    expect(items).toEqual(expect.arrayContaining(['eq', 'ilike']));
  });

  it('completes where-callback fields inside an include callback chain', () => {
    expect(labels("db.orm.public.User.include('posts', (p) => p.where((x) => x.")).toEqual([
      'id',
      'title',
      'userId',
      'user',
    ]);
  });
});

describe('complete: enums lane', () => {
  it('suggests namespaces then enum names', () => {
    expect(labels('db.enums.')).toEqual(['public']);
    expect(labels('db.enums.public.')).toEqual(['Priority']);
  });

  it('suggests enum accessor members', () => {
    const items = labels('db.enums.public.Priority.');
    expect(items).toEqual(expect.arrayContaining(['values', 'members', 'hasName']));
  });
});

describe('complete: edge cases', () => {
  it('returns nothing mid-string outside known call context', () => {
    expect(labels("const s = 'hel")).toEqual([]);
  });

  it('returns nothing after unknown chain roots', () => {
    expect(labels('foo.bar.')).toEqual([]);
  });

  it('completes at a cursor before the end of the buffer', () => {
    const buffer = 'db.sq === 1';
    const result = complete(buffer, 5, schema);
    expect(result.items.map((i) => i.label)).toEqual(['sql']);
    expect(result.from).toBe(3);
  });

  it('handles nested parens in the chain', () => {
    const items = labels("db.sql.public.user.select('id').where((f, fns) => fns.eq(f.id, 'x')).");
    expect(items).toEqual(expect.arrayContaining(['limit', 'build']));
  });

  it('includes evaluator globals when provided', () => {
    const result = complete('use', 3, schema, ['users', 'db']);
    expect(result.items.map((i) => i.label)).toContain('users');
  });
});
