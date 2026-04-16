import { describe, expect, it } from 'vitest';
import type { OpFactoryCall } from '../src/core/op-factory-call';
import { renderTypeScript } from '../src/core/render-typescript';

describe('renderTypeScript', () => {
  it('generates valid TypeScript with correct imports', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'createIndex',
        collection: 'users',
        keys: [{ field: 'email', direction: 1 }],
        options: { unique: true },
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain("import { Migration } from '@prisma-next/family-mongo/migration';");
    expect(output).toContain("import { createIndex } from '@prisma-next/target-mongo/migration';");
    expect(output).toContain('class M extends Migration');
    expect(output).toContain('override plan()');
    expect(output).toContain('export default M;');
    expect(output).toContain('Migration.run(import.meta.url, M);');
  });

  it('only imports used factory functions', () => {
    const calls: OpFactoryCall[] = [
      { factory: 'createIndex', collection: 'users', keys: [{ field: 'email', direction: 1 }] },
      { factory: 'dropCollection', collection: 'legacy' },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createIndex');
    expect(output).toContain('dropCollection');
    expect(output).not.toContain('dropIndex');
    expect(output).not.toContain('createCollection');
    expect(output).not.toContain('collMod');
  });

  it('includes describe() method when meta is provided', () => {
    const calls: OpFactoryCall[] = [{ factory: 'dropCollection', collection: 'users' }];

    const output = renderTypeScript(calls, {
      from: 'sha256:abc',
      to: 'sha256:def',
      labels: ['drop-users'],
    });

    expect(output).toContain('override describe()');
    expect(output).toContain('"sha256:abc"');
    expect(output).toContain('"sha256:def"');
    expect(output).toContain('"drop-users"');
  });

  it('omits describe() method when meta is undefined', () => {
    const calls: OpFactoryCall[] = [{ factory: 'dropCollection', collection: 'users' }];

    const output = renderTypeScript(calls);

    expect(output).not.toContain('describe()');
  });

  it('renders createIndex with options', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'createIndex',
        collection: 'users',
        keys: [{ field: 'email', direction: 1 }],
        options: { unique: true, sparse: true },
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createIndex("users"');
    expect(output).toContain('unique: true');
    expect(output).toContain('sparse: true');
  });

  it('renders createIndex without options when absent', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'createIndex',
        collection: 'users',
        keys: [{ field: 'email', direction: 1 }],
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toMatch(/createIndex\("users", \[.*\]\)/);
  });

  it('renders dropIndex', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'dropIndex',
        collection: 'users',
        keys: [{ field: 'email', direction: 1 }],
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('dropIndex("users"');
  });

  it('renders createCollection without options', () => {
    const calls: OpFactoryCall[] = [{ factory: 'createCollection', collection: 'users' }];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection("users")');
  });

  it('renders createCollection with options', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'createCollection',
        collection: 'users',
        options: {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
        },
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection("users"');
    expect(output).toContain('validator');
    expect(output).toContain('validationLevel');
  });

  it('renders dropCollection', () => {
    const calls: OpFactoryCall[] = [{ factory: 'dropCollection', collection: 'users' }];

    const output = renderTypeScript(calls);

    expect(output).toContain('dropCollection("users")');
  });

  it('renders collMod without meta', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'collMod',
        collection: 'users',
        options: {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
          validationAction: 'error',
        },
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('collMod("users"');
    expect(output).toContain('validator');
  });

  it('renders collMod with meta', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'collMod',
        collection: 'users',
        options: {
          validator: { $jsonSchema: { required: ['email'] } },
        },
        meta: {
          id: 'validator.users.add',
          label: 'Add validator on users',
          operationClass: 'destructive',
        },
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('collMod("users"');
    expect(output).toContain('"validator.users.add"');
    expect(output).toContain('"Add validator on users"');
    expect(output).toContain('"destructive"');
  });

  it('renders multiple calls', () => {
    const calls: OpFactoryCall[] = [
      {
        factory: 'createCollection',
        collection: 'users',
        options: {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
          validationAction: 'error',
        },
      },
      {
        factory: 'createIndex',
        collection: 'users',
        keys: [{ field: 'email', direction: 1 }],
        options: { unique: true },
      },
      {
        factory: 'createIndex',
        collection: 'users',
        keys: [
          { field: 'name', direction: 1 },
          { field: 'age', direction: -1 },
        ],
      },
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection');
    expect(output).toContain('createIndex');
    const importLine = output
      .split('\n')
      .find((l) => l.includes('@prisma-next/target-mongo/migration'));
    expect(importLine).toContain('createCollection');
    expect(importLine).toContain('createIndex');
  });

  it('includes kind in describe when specified', () => {
    const calls: OpFactoryCall[] = [{ factory: 'dropCollection', collection: 'users' }];

    const output = renderTypeScript(calls, {
      from: 'sha256:abc',
      to: 'sha256:def',
      kind: 'baseline',
    });

    expect(output).toContain('"baseline"');
  });

  it('handles empty calls array', () => {
    const output = renderTypeScript([]);

    expect(output).toContain("import { Migration } from '@prisma-next/family-mongo/migration';");
    expect(output).not.toContain('@prisma-next/target-mongo/migration');
    expect(output).toContain('return [');
    expect(output).toContain('];');
  });
});
