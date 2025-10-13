import { describe, it, expect } from 'vitest';
import { pgLowerer } from '../src/lowering/postgres';
import { renderScript } from '../src/lowering/renderer';
import type { OpSet } from '../src/lowering/postgres';

describe('Postgres Lowerer', () => {
  it('maps addTable operation to createTable AST', () => {
    const opset: OpSet = [{
      kind: 'addTable',
      name: 'users',
      columns: [
        { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
        { name: 'email', type: 'varchar', nullable: false }
      ],
      constraints: [
        { kind: 'primaryKey', columns: ['id'] },
        { kind: 'unique', columns: ['email'] }
      ]
    }];

    const lowerer = pgLowerer();
    const script = lowerer.lower(opset);
    
    expect(script.type).toBe('script');
    expect(script.statements).toHaveLength(1);
    expect(script.statements[0].type).toBe('tx');
    
    const txBlock = script.statements[0];
    if (txBlock.type === 'tx') {
      expect(txBlock.statements).toHaveLength(1);
      expect(txBlock.statements[0].type).toBe('createTable');
      
      const createTable = txBlock.statements[0];
      if (createTable.type === 'createTable') {
        expect(createTable.name.name).toBe('users');
        expect(createTable.columns).toHaveLength(2);
        expect(createTable.constraints).toHaveLength(2);
        expect(createTable.ifNotExists).toBe(true);
      }
    }
  });

  it('maps addColumn operation to alterTable AST', () => {
    const opset: OpSet = [{
      kind: 'addColumn',
      table: 'users',
      column: { name: 'active', type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } }
    }];

    const lowerer = pgLowerer();
    const script = lowerer.lower(opset);
    
    const txBlock = script.statements[0];
    if (txBlock.type === 'tx') {
      const alterTable = txBlock.statements[0];
      if (alterTable.type === 'alterTable') {
        expect(alterTable.name.name).toBe('users');
        expect(alterTable.alters).toHaveLength(1);
        expect(alterTable.alters[0].kind).toBe('addColumn');
      }
    }
  });

  it('maps addForeignKey operation to addConstraint AST', () => {
    const opset: OpSet = [{
      kind: 'addForeignKey',
      table: 'posts',
      columns: ['user_id'],
      ref: { table: 'users', columns: ['id'] },
      onDelete: 'cascade'
    }];

    const lowerer = pgLowerer();
    const script = lowerer.lower(opset);
    
    const txBlock = script.statements[0];
    if (txBlock.type === 'tx') {
      const addConstraint = txBlock.statements[0];
      if (addConstraint.type === 'addConstraint') {
        expect(addConstraint.table.name).toBe('posts');
        expect(addConstraint.spec.kind).toBe('foreignKey');
        if (addConstraint.spec.kind === 'foreignKey') {
          expect(addConstraint.spec.columns).toEqual(['user_id']);
          expect(addConstraint.spec.ref.table).toBe('users');
          expect(addConstraint.spec.onDelete).toBe('cascade');
        }
      }
    }
  });

  it('wraps all operations in single transaction block', () => {
    const opset: OpSet = [
      {
        kind: 'addTable',
        name: 'users',
        columns: [{ name: 'id', type: 'int4', nullable: false }]
      },
      {
        kind: 'addTable',
        name: 'posts',
        columns: [{ name: 'id', type: 'int4', nullable: false }]
      }
    ];

    const lowerer = pgLowerer();
    const script = lowerer.lower(opset);
    
    expect(script.statements).toHaveLength(1);
    expect(script.statements[0].type).toBe('tx');
    
    const txBlock = script.statements[0];
    if (txBlock.type === 'tx') {
      expect(txBlock.statements).toHaveLength(2);
    }
  });

  it('produces deterministic SQL hash for same operations', () => {
    const opset: OpSet = [{
      kind: 'addTable',
      name: 'test',
      columns: [{ name: 'id', type: 'int4', nullable: false }]
    }];

    const lowerer = pgLowerer();
    const script1 = lowerer.lower(opset);
    const script2 = lowerer.lower(opset);
    
    const result1 = renderScript(script1);
    const result2 = renderScript(script2);
    
    expect(result1.sqlHash).toBe(result2.sqlHash);
    expect(result1.sql).toBe(result2.sql);
  });

  it('handles empty opset', () => {
    const opset: OpSet = [];
    const lowerer = pgLowerer();
    const script = lowerer.lower(opset);
    
    expect(script.type).toBe('script');
    expect(script.statements).toHaveLength(0);
  });
});
