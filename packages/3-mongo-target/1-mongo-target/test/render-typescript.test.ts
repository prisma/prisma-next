import type { CollModOptions } from '@prisma-next/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
} from '../src/core/op-factory-call';
import { renderCallsToTypeScript } from '../src/core/render-typescript';

const META = {
  from: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  to: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
} as const;

const renderTypeScript = (
  calls: Parameters<typeof renderCallsToTypeScript>[0],
  meta: Parameters<typeof renderCallsToTypeScript>[1] = META,
) => renderCallsToTypeScript(calls, meta);

describe('renderCallsToTypeScript', () => {
  it('generates valid TypeScript with correct imports', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain("import { Migration } from '@prisma-next/family-mongo/migration';");
    expect(output).toContain("import { createIndex } from '@prisma-next/target-mongo/migration';");
    expect(output).toContain('class M extends Migration');
    expect(output).toContain('override get operations()');
    expect(output).toContain('export default M;');
    expect(output).toContain('Migration.run(import.meta.url, M);');
  });

  it('prepends a node shebang as the first line under the default test env', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls);

    expect(output.split('\n')[0]).toBe('#!/usr/bin/env -S node');
    expect(output).toContain('Migration.run(import.meta.url, M);');
  });

  it('only imports used factory functions', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }]),
      new DropCollectionCall('legacy'),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createIndex');
    expect(output).toContain('dropCollection');
    expect(output).not.toContain('dropIndex');
    expect(output).not.toContain('createCollection');
    expect(output).not.toContain('collMod');
  });

  it('includes describe() method when meta is provided', () => {
    const calls = [new DropCollectionCall('users')];

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

  it('always renders describe() since migration.json is required', () => {
    const calls = [new DropCollectionCall('users')];

    const output = renderTypeScript(calls);

    expect(output).toContain('override describe()');
  });

  it('renders createIndex with options', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], {
        unique: true,
        sparse: true,
      }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createIndex("users"');
    expect(output).toContain('unique: true');
    expect(output).toContain('sparse: true');
  });

  it('renders createIndex without options when absent', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls);

    expect(output).toMatch(/createIndex\("users", \[.*\]\)/);
  });

  it('renders dropIndex', () => {
    const calls = [new DropIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls);

    expect(output).toContain('dropIndex("users"');
  });

  it('renders createCollection without options', () => {
    const calls = [new CreateCollectionCall('users')];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection("users")');
  });

  it('renders createCollection with options', () => {
    const calls = [
      new CreateCollectionCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
      }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection("users"');
    expect(output).toContain('validator');
    expect(output).toContain('validationLevel');
  });

  it('renders dropCollection', () => {
    const calls = [new DropCollectionCall('users')];

    const output = renderTypeScript(calls);

    expect(output).toContain('dropCollection("users")');
  });

  it('renders collMod without meta', () => {
    const calls = [
      new CollModCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('collMod("users"');
    expect(output).toContain('validator');
  });

  it('renders collMod with meta', () => {
    const calls = [
      new CollModCall(
        'users',
        {
          validator: { $jsonSchema: { required: ['email'] } },
        },
        {
          id: 'validator.users.add',
          label: 'Add validator on users',
          operationClass: 'destructive',
        },
      ),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('collMod("users"');
    expect(output).toContain('"validator.users.add"');
    expect(output).toContain('"Add validator on users"');
    expect(output).toContain('"destructive"');
  });

  it('renders multiple calls', () => {
    const calls = [
      new CreateCollectionCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true }),
      new CreateIndexCall('users', [
        { field: 'name', direction: 1 },
        { field: 'age', direction: -1 },
      ]),
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
    const calls = [new DropCollectionCall('users')];

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

  it('wraps long arrays onto multiple lines', () => {
    const calls = [
      new CreateIndexCall('users', [
        { field: 'first_name', direction: 1 },
        { field: 'last_name', direction: 1 },
        { field: 'email_address', direction: 1 },
        { field: 'phone_number', direction: 1 },
      ]),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('[\n');
  });

  it('quotes __proto__ key in rendered object literals', () => {
    const opts = Object.create(null) as Record<string, unknown>;
    opts['__proto__'] = 'poisoned';
    const calls = [
      new CollModCall('test', opts as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('"__proto__"');
  });

  it('falls back to String() for non-standard value types', () => {
    const calls = [
      new CollModCall('test', { validator: BigInt(42) } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('42');
  });

  it('renders null values', () => {
    const calls = [
      new CollModCall('test', { validator: null } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('null');
  });

  it('renders empty arrays as []', () => {
    const calls = [
      new CreateCollectionCall('test', {
        validator: { $jsonSchema: { required: [] } },
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('[]');
  });

  it('renders empty objects as {}', () => {
    const calls = [
      new CollModCall('test', { validator: {} } as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('{}');
  });

  it('quotes keys with special characters', () => {
    const calls = [
      new CollModCall('test', { 'some-key': true } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('"some-key"');
  });

  it('renders undefined values in arrays', () => {
    const calls = [
      new CollModCall('test', { validator: [undefined, 'a'] } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('undefined');
    expect(output).toContain('"a"');
  });
});
