import { describe, expect, it } from 'vitest';
import { runMetaCommand } from '../../src/repl/meta-commands';
import { extractReplSchemaInfo } from '../../src/repl/schema-info';
import { replContractFixture } from './fixture';

const schema = extractReplSchemaInfo(replContractFixture);
const opts = { color: false };

describe('runMetaCommand', () => {
  it('ignores non-meta input', () => {
    expect(runMetaCommand('db.sql', schema, opts).handled).toBe(false);
    expect(runMetaCommand('1 + 1', schema, opts).handled).toBe(false);
  });

  it('passes leading-dot JavaScript through to the evaluator', () => {
    expect(runMetaCommand('.5 + 1', schema, opts).handled).toBe(false);
    expect(runMetaCommand(".select('id').limit(5)", schema, opts).handled).toBe(false);
  });

  it('handles .help and \\?', () => {
    const result = runMetaCommand('.help', schema, opts);
    expect(result.handled).toBe(true);
    expect(result.output).toContain('.tables');
    expect(runMetaCommand('\\?', schema, opts).handled).toBe(true);
  });

  it('lists tables with .tables and \\dt', () => {
    const result = runMetaCommand('.tables', schema, opts);
    expect(result.output).toContain('user');
    expect(result.output).toContain('post');
    expect(runMetaCommand('\\dt', schema, opts).output).toContain('user');
  });

  it('describes a table with .schema <table> and \\d <table>', () => {
    const result = runMetaCommand('.schema user', schema, opts);
    expect(result.output).toContain('email');
    expect(result.output).toContain('text');
    expect(result.output).toContain('uuid');
    expect(runMetaCommand('\\d user', schema, opts).output).toContain('email');
  });

  it('reports unknown tables', () => {
    const result = runMetaCommand('.schema nope', schema, opts);
    expect(result.handled).toBe(true);
    expect(result.output).toContain('nope');
  });

  it('lists all tables when .schema has no argument', () => {
    const result = runMetaCommand('.schema', schema, opts);
    expect(result.output).toContain('user');
    expect(result.output).toContain('post');
  });

  it('lists models with .models', () => {
    const result = runMetaCommand('.models', schema, opts);
    expect(result.output).toContain('User');
    expect(result.output).toContain('posts');
  });

  it('exits with .exit, .quit, and \\q', () => {
    expect(runMetaCommand('.exit', schema, opts).exit).toBe(true);
    expect(runMetaCommand('.quit', schema, opts).exit).toBe(true);
    expect(runMetaCommand('\\q', schema, opts).exit).toBe(true);
  });

  it('clears the screen with .clear', () => {
    expect(runMetaCommand('.clear', schema, opts).clear).toBe(true);
  });

  it('reports unknown meta commands with a hint', () => {
    const result = runMetaCommand('.nope', schema, opts);
    expect(result.handled).toBe(true);
    expect(result.output).toContain('.help');
  });
});
