import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderScript } from '../src/lowering/renderer';
import { ScriptAST, CreateTableAST, TxBlockAST } from '../src/script-ast';

describe('Script Renderer', () => {
  it('renders CREATE TABLE with proper SQL', () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'createTable',
        name: { name: 'users' },
        columns: [
          { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
          { name: 'email', type: 'varchar', nullable: false },
          { name: 'active', type: 'bool', nullable: false, default: { kind: 'literal', value: 'true' } },
          { name: 'createdAt', type: 'timestamp', nullable: false, default: { kind: 'now' } }
        ],
        constraints: [
          { kind: 'primaryKey', columns: ['id'] },
          { kind: 'unique', columns: ['email'] }
        ],
        ifNotExists: true
      }]
    };

    const result = renderScript(script);
    
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(result.sql).toContain('"id" SERIAL');
    expect(result.sql).toContain('"email" VARCHAR(255) NOT NULL');
    expect(result.sql).toContain('"active" BOOLEAN NOT NULL DEFAULT true');
    expect(result.sql).toContain('"createdAt" TIMESTAMP NOT NULL DEFAULT NOW()');
    expect(result.sql).toContain('PRIMARY KEY ("id")');
    expect(result.sql).toContain('UNIQUE ("email")');
    expect(result.sqlHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('wraps statements in transaction blocks', () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'tx',
        statements: [
          {
            type: 'createTable',
            name: { name: 'users' },
            columns: [{ name: 'id', type: 'int4', nullable: false }],
            ifNotExists: true
          },
          {
            type: 'createTable',
            name: { name: 'posts' },
            columns: [{ name: 'id', type: 'int4', nullable: false }],
            ifNotExists: true
          }
        ]
      }]
    };

    const result = renderScript(script);
    
    expect(result.sql).toMatch(/^BEGIN;\n.*;\n.*;\nCOMMIT;$/s);
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS "posts"');
  });

  it('quotes reserved words and special characters', () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'createTable',
        name: { name: 'user' }, // reserved word
        columns: [
          { name: 'id', type: 'int4', nullable: false },
          { name: 'createdAt', type: 'timestamp', nullable: false }, // camelCase
          { name: 'user-name', type: 'text', nullable: false } // hyphen
        ],
        ifNotExists: true
      }]
    };

    const result = renderScript(script);
    
    expect(result.sql).toContain('"user"'); // table name quoted
    expect(result.sql).toContain('"createdAt"'); // camelCase quoted
    expect(result.sql).toContain('"user-name"'); // hyphen quoted
  });

  it('produces deterministic SQL hash', () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'createTable',
        name: { name: 'test' },
        columns: [{ name: 'id', type: 'int4', nullable: false }],
        ifNotExists: true
      }]
    };

    const result1 = renderScript(script);
    const result2 = renderScript(script);
    
    expect(result1.sqlHash).toBe(result2.sqlHash);
    expect(result1.sql).toBe(result2.sql);
  });

  it('handles foreign key constraints', () => {
    const script: ScriptAST = {
      type: 'script',
      statements: [{
        type: 'createTable',
        name: { name: 'posts' },
        columns: [
          { name: 'id', type: 'int4', nullable: false },
          { name: 'user_id', type: 'int4', nullable: false }
        ],
        constraints: [
          { kind: 'primaryKey', columns: ['id'] },
          { 
            kind: 'foreignKey', 
            columns: ['user_id'], 
            ref: { table: 'users', columns: ['id'] },
            onDelete: 'cascade',
            onUpdate: 'restrict'
          }
        ],
        ifNotExists: true
      }]
    };

    const result = renderScript(script);
    
    expect(result.sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id")');
    expect(result.sql).toContain('ON DELETE CASCADE');
    expect(result.sql).toContain('ON UPDATE RESTRICT');
  });
});
