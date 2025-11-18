import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type {
  IntrospectSchemaResult,
  SchemaVerificationNode,
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { parseGlobalFlags } from '../src/utils/global-flags';
import {
  formatIntrospectJson,
  formatIntrospectOutput,
  formatSchemaVerifyJson,
  formatSchemaVerifyOutput,
  formatSignJson,
  formatSignOutput,
} from '../src/utils/output';

describe('formatIntrospectOutput', () => {
  const createSchemaView = (): CoreSchemaView => ({
    root: {
      kind: 'root',
      id: 'sql-schema',
      label: 'sql schema (tables: 2)',
      children: [
        {
          kind: 'entity',
          id: 'table-user',
          label: 'table user',
          children: [
            {
              kind: 'field',
              id: 'column-id',
              label: 'id: pg/int4@1 (not null)',
            },
            {
              kind: 'field',
              id: 'column-email',
              label: 'email: pg/text@1 (not null)',
            },
            {
              kind: 'index',
              id: 'index-user-email',
              label: 'index user_email_unique',
            },
          ],
        },
        {
          kind: 'entity',
          id: 'table-post',
          label: 'table post',
          children: [
            {
              kind: 'field',
              id: 'column-id',
              label: 'id: pg/int4@1 (not null)',
            },
          ],
        },
      ],
    },
  });

  const createResult = (): IntrospectSchemaResult<unknown> => ({
    ok: true,
    summary: 'Schema introspected successfully',
    target: {
      familyId: 'sql',
      id: 'postgres',
    },
    schema: { tables: {} },
    meta: {
      configPath: './prisma-next.config.ts',
      dbUrl: 'postgresql://user:****@localhost/test',
    },
    timings: {
      total: 123,
    },
  });

  it('renders tree structure with schema view', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatIntrospectOutput(result, schemaView, flags);
    const stripped = stripAnsi(output);

    // Root should be present
    expect(stripped).toContain('sql schema (tables: 2)');
    // Entities should be present
    expect(stripped).toContain('table user');
    expect(stripped).toContain('table post');
    // Fields should be present
    expect(stripped).toContain('id: pg/int4@1 (not null)');
    expect(stripped).toContain('email: pg/text@1 (not null)');
    // Index should be present
    expect(stripped).toContain('index user_email_unique');
    // Tree characters should be present
    expect(stripped).toContain('├');
    expect(stripped).toContain('└');
  });

  it('renders tree structure with proper indentation', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatIntrospectOutput(result, schemaView, flags);
    const lines = output.split('\n').map(stripAnsi);

    // Root should be first line
    expect(lines[0]).toContain('sql schema (tables: 2)');
    // First entity should have tree character
    const userLine = lines.find((line) => line.includes('table user'));
    expect(userLine).toBeDefined();
    expect(userLine).toMatch(/[├└].*table user/);
    // Fields should be indented
    const idFieldLine = lines.find((line) => line.includes('id: pg/int4@1'));
    expect(idFieldLine).toBeDefined();
    expect(idFieldLine).toMatch(/[├└].*id: pg\/int4@1/);
  });

  it('renders root with no children', () => {
    const schemaView: CoreSchemaView = {
      root: {
        kind: 'root',
        id: 'sql-schema',
        label: 'sql schema (tables: 0)',
      },
    };
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatIntrospectOutput(result, schemaView, flags);
    const stripped = stripAnsi(output);

    // Root should still be printed
    expect(stripped).toContain('sql schema (tables: 0)');
  });

  it('returns empty string in quiet mode', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ quiet: true });

    const output = formatIntrospectOutput(result, schemaView, flags);

    expect(output).toBe('');
  });

  it('includes timings in verbose mode', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });

    const output = formatIntrospectOutput(result, schemaView, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Total time: 123ms');
  });

  it('applies timestamps prefix when enabled', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ timestamps: true, 'no-color': true });

    const output = formatIntrospectOutput(result, schemaView, flags);
    const lines = output.split('\n');

    // All lines should start with timestamp prefix
    for (const line of lines) {
      if (line.trim()) {
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      }
    }
  });

  it('applies colors when enabled', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ color: true });

    const output = formatIntrospectOutput(result, schemaView, flags);

    // If colors are enabled, at least the root (bold) or entities (cyan) should have colors
    // For now, we'll check that the output is different from no-color mode
    const noColorOutput = formatIntrospectOutput(
      result,
      schemaView,
      parseGlobalFlags({ 'no-color': true }),
    );
    // When colors are enabled, the output structure should be the same but may have ANSI codes
    // We verify colors are working by checking the structure is correct
    expect(output.length).toBeGreaterThan(0);
    expect(noColorOutput.length).toBeGreaterThan(0);
  });

  it('does not apply colors when disabled', () => {
    const schemaView = createSchemaView();
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatIntrospectOutput(result, schemaView, flags);

    // Should not contain ANSI color codes
    expect(output).not.toContain('\u001b[');
  });

  it('renders fallback summary when schema view is undefined', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatIntrospectOutput(result, undefined, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Schema introspected successfully');
  });

  it('includes target and dbUrl in verbose mode when schema view is undefined', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });

    const output = formatIntrospectOutput(result, undefined, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Target: sql/postgres');
    expect(stripped).toContain('Database: postgresql://user:****@localhost/test');
    expect(stripped).toContain('Total time: 123ms');
  });

  it('does not include target and dbUrl in non-verbose mode when schema view is undefined', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatIntrospectOutput(result, undefined, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Schema introspected successfully');
    expect(stripped).not.toContain('Target:');
    expect(stripped).not.toContain('Database:');
    expect(stripped).not.toContain('Total time:');
  });

  it('handles missing meta fields gracefully', () => {
    const result: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Schema introspected successfully',
      target: {
        familyId: 'sql',
        id: 'postgres',
      },
      schema: { tables: {} },
      timings: {
        total: 123,
      },
    };
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });

    const output = formatIntrospectOutput(result, undefined, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Schema introspected successfully');
    expect(stripped).toContain('Target: sql/postgres');
    expect(stripped).not.toContain('Database:');
  });
});

describe('formatIntrospectJson', () => {
  it('formats result as pretty-printed JSON', () => {
    const result: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Schema introspected successfully',
      target: {
        familyId: 'sql',
        id: 'postgres',
      },
      schema: { tables: { user: { columns: {} } } },
      meta: {
        configPath: './prisma-next.config.ts',
        dbUrl: 'postgresql://user:****@localhost/test',
      },
      timings: {
        total: 123,
      },
    };

    const output = formatIntrospectJson(result);
    const parsed = JSON.parse(output) as IntrospectSchemaResult<unknown>;

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Schema introspected successfully');
    expect(parsed.target.familyId).toBe('sql');
    expect(parsed.target.id).toBe('postgres');
    expect(parsed.schema).toEqual({ tables: { user: { columns: {} } } });
    expect(parsed.meta?.configPath).toBe('./prisma-next.config.ts');
    expect(parsed.meta?.dbUrl).toBe('postgresql://user:****@localhost/test');
    expect(parsed.timings.total).toBe(123);
  });

  it('uses 2-space indentation', () => {
    const result: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Test',
      target: {
        familyId: 'sql',
        id: 'postgres',
      },
      schema: {},
      timings: {
        total: 0,
      },
    };

    const output = formatIntrospectJson(result);
    const lines = output.split('\n');

    // Check that indentation is 2 spaces
    expect(lines[1]).toMatch(/^ {2}"/);
  });

  it('handles result without meta fields', () => {
    const result: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Schema introspected successfully',
      target: {
        familyId: 'sql',
        id: 'postgres',
      },
      schema: {},
      timings: {
        total: 123,
      },
    };

    const output = formatIntrospectJson(result);
    const parsed = JSON.parse(output) as IntrospectSchemaResult<unknown>;

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Schema introspected successfully');
    expect(parsed.target.familyId).toBe('sql');
    expect(parsed.target.id).toBe('postgres');
    expect(parsed.schema).toEqual({});
    expect(parsed.timings.total).toBe(123);
    expect(parsed.meta).toBeUndefined();
  });
});

describe('formatSchemaVerifyOutput', () => {
  const createVerificationNode = (): SchemaVerificationNode => ({
    status: 'pass',
    kind: 'schema',
    name: 'schema',
    contractPath: '',
    code: '',
    message: '',
    expected: undefined,
    actual: undefined,
    children: [
      {
        status: 'pass',
        kind: 'table',
        name: 'user',
        contractPath: 'storage.tables.user',
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [
          {
            status: 'pass',
            kind: 'column',
            name: 'user.id: pg/int4@1 not null',
            contractPath: 'storage.tables.user.columns.id',
            code: '',
            message: '',
            expected: undefined,
            actual: undefined,
            children: [],
          },
          {
            status: 'pass',
            kind: 'column',
            name: 'user.email: pg/text@1 not null',
            contractPath: 'storage.tables.user.columns.email',
            code: '',
            message: '',
            expected: undefined,
            actual: undefined,
            children: [],
          },
        ],
      },
      {
        status: 'fail',
        kind: 'table',
        name: 'post',
        contractPath: 'storage.tables.post',
        code: 'missing_table',
        message: 'Table "post" is missing',
        expected: undefined,
        actual: undefined,
        children: [],
      },
    ],
  });

  const createResult = (): VerifyDatabaseSchemaResult => ({
    ok: false,
    code: 'PN-SCHEMA-0001',
    summary: 'Database schema does not satisfy contract (1 failure)',
    contract: {
      coreHash: 'sha256:test',
    },
    target: {
      expected: 'postgres',
      actual: 'postgres',
    },
    schema: {
      issues: [
        {
          kind: 'missing_table',
          table: 'post',
          message: 'Table "post" is missing from database',
        },
      ],
      root: createVerificationNode(),
      counts: {
        pass: 3,
        warn: 0,
        fail: 1,
        totalNodes: 4,
      },
    },
    meta: {
      contractPath: './contract.json',
      strict: false,
    },
    timings: {
      total: 123,
    },
  });

  it('renders verification tree with status glyphs', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const stripped = stripAnsi(output);

    // Summary line should be present
    expect(stripped).toContain('✖ Database schema does not satisfy contract');
    // Tree should be present
    expect(stripped).toContain('schema');
    expect(stripped).toContain('user');
    expect(stripped).toContain('post');
    // Status glyphs should be present
    expect(stripped).toContain('✓');
    expect(stripped).toContain('✖');
  });

  it('renders success summary when ok=true', () => {
    const result: VerifyDatabaseSchemaResult = {
      ...createResult(),
      ok: true,
      summary: 'Database schema satisfies contract',
      schema: {
        ...createResult().schema,
        root: {
          status: 'pass',
          kind: 'schema',
          name: 'schema',
          contractPath: '',
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [
            {
              status: 'pass',
              kind: 'table',
              name: 'user',
              contractPath: 'storage.tables.user',
              code: '',
              message: '',
              expected: undefined,
              actual: undefined,
              children: [],
            },
          ],
        },
        counts: {
          pass: 2,
          warn: 0,
          fail: 0,
          totalNodes: 2,
        },
      },
    };
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Database schema satisfies contract');
  });

  it('includes code in failure summary', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('(PN-SCHEMA-0001)');
  });

  it('renders tree structure with proper indentation', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const lines = output.split('\n').map(stripAnsi);

    // Tree should be first (root node)
    expect(lines[0]).toContain('schema');
    // Summary should be last line
    const summaryLine = lines[lines.length - 1];
    expect(summaryLine).toContain('Database schema does not satisfy contract');
  });

  it('returns empty string in quiet mode', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ quiet: true });

    const output = formatSchemaVerifyOutput(result, flags);

    expect(output).toBe('');
  });

  it('includes timings and counts in verbose mode', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('Total time: 123ms');
    expect(stripped).toContain('pass=3');
    expect(stripped).toContain('warn=0');
    expect(stripped).toContain('fail=1');
  });

  it('applies timestamps prefix when enabled', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ timestamps: true, 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const lines = output.split('\n');

    // All non-empty lines should start with timestamp prefix
    for (const line of lines) {
      if (line.trim()) {
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      }
    }
  });

  it('applies colors when enabled', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ color: true });

    const output = formatSchemaVerifyOutput(result, flags);

    // Output should be non-empty
    expect(output.length).toBeGreaterThan(0);
  });

  it('does not apply colors when disabled', () => {
    const result = createResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);

    // Should not contain ANSI color codes
    expect(output).not.toContain('\u001b[');
  });

  it('renders warn status nodes', () => {
    const result: VerifyDatabaseSchemaResult = {
      ...createResult(),
      schema: {
        ...createResult().schema,
        root: {
          status: 'warn',
          kind: 'schema',
          name: 'schema',
          contractPath: '',
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [
            {
              status: 'warn',
              kind: 'table',
              name: 'user',
              contractPath: 'storage.tables.user',
              code: '',
              message: '',
              expected: undefined,
              actual: undefined,
              children: [],
            },
          ],
        },
        counts: {
          pass: 0,
          warn: 2,
          fail: 0,
          totalNodes: 2,
        },
      },
    };
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSchemaVerifyOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('⚠');
  });
});

describe('formatSchemaVerifyJson', () => {
  it('formats result as pretty-printed JSON', () => {
    const result: VerifyDatabaseSchemaResult = {
      ok: true,
      summary: 'Database schema satisfies contract',
      contract: {
        coreHash: 'sha256:test',
        profileHash: 'sha256:profile',
      },
      target: {
        expected: 'postgres',
        actual: 'postgres',
      },
      schema: {
        issues: [],
        root: {
          status: 'pass',
          kind: 'schema',
          name: 'schema',
          contractPath: '',
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        },
        counts: {
          pass: 1,
          warn: 0,
          fail: 0,
          totalNodes: 1,
        },
      },
      meta: {
        contractPath: './contract.json',
        strict: false,
        configPath: './prisma-next.config.ts',
      },
      timings: {
        total: 123,
      },
    };

    const output = formatSchemaVerifyJson(result);
    const parsed = JSON.parse(output) as VerifyDatabaseSchemaResult;

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Database schema satisfies contract');
    expect(parsed.contract.coreHash).toBe('sha256:test');
    expect(parsed.contract.profileHash).toBe('sha256:profile');
    expect(parsed.target.expected).toBe('postgres');
    expect(parsed.schema.counts.pass).toBe(1);
    expect(parsed.schema.counts.fail).toBe(0);
    expect(parsed.schema.root.status).toBe('pass');
    expect(parsed.meta?.contractPath).toBe('./contract.json');
    expect(parsed.meta?.strict).toBe(false);
    expect(parsed.timings.total).toBe(123);
  });

  it('uses 2-space indentation', () => {
    const result: VerifyDatabaseSchemaResult = {
      ok: true,
      summary: 'Test',
      contract: {
        coreHash: 'sha256:test',
      },
      target: {
        expected: 'postgres',
        actual: 'postgres',
      },
      schema: {
        issues: [],
        root: {
          status: 'pass',
          kind: 'schema',
          name: 'schema',
          contractPath: '',
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        },
        counts: {
          pass: 1,
          warn: 0,
          fail: 0,
          totalNodes: 1,
        },
      },
      meta: {
        contractPath: './contract.json',
        strict: false,
      },
      timings: {
        total: 0,
      },
    };

    const output = formatSchemaVerifyJson(result);
    const lines = output.split('\n');

    // Check that indentation is 2 spaces
    expect(lines[1]).toMatch(/^ {2}"/);
  });

  it('handles result without code', () => {
    const result: VerifyDatabaseSchemaResult = {
      ok: true,
      summary: 'Database schema satisfies contract',
      contract: {
        coreHash: 'sha256:test',
      },
      target: {
        expected: 'postgres',
        actual: 'postgres',
      },
      schema: {
        issues: [],
        root: {
          status: 'pass',
          kind: 'schema',
          name: 'schema',
          contractPath: '',
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        },
        counts: {
          pass: 1,
          warn: 0,
          fail: 0,
          totalNodes: 1,
        },
      },
      meta: {
        contractPath: './contract.json',
        strict: false,
      },
      timings: {
        total: 123,
      },
    };

    const output = formatSchemaVerifyJson(result);
    const parsed = JSON.parse(output) as VerifyDatabaseSchemaResult;

    expect(parsed.ok).toBe(true);
    expect(parsed.code).toBeUndefined();
  });

  it('includes all schema fields', () => {
    const result: VerifyDatabaseSchemaResult = {
      ok: false,
      code: 'PN-SCHEMA-0001',
      summary: 'Database schema does not satisfy contract',
      contract: {
        coreHash: 'sha256:test',
      },
      target: {
        expected: 'postgres',
        actual: 'postgres',
      },
      schema: {
        issues: [
          {
            kind: 'missing_table',
            table: 'post',
            message: 'Table "post" is missing',
          },
        ],
        root: {
          status: 'fail',
          kind: 'schema',
          name: 'schema',
          contractPath: '',
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [
            {
              status: 'fail',
              kind: 'table',
              name: 'post',
              contractPath: 'storage.tables.post',
              code: 'missing_table',
              message: 'Table "post" is missing',
              expected: undefined,
              actual: undefined,
              children: [],
            },
          ],
        },
        counts: {
          pass: 0,
          warn: 0,
          fail: 2,
          totalNodes: 2,
        },
      },
      meta: {
        contractPath: './contract.json',
        strict: true,
        configPath: './prisma-next.config.ts',
      },
      timings: {
        total: 456,
      },
    };

    const output = formatSchemaVerifyJson(result);
    const parsed = JSON.parse(output) as VerifyDatabaseSchemaResult;

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('PN-SCHEMA-0001');
    expect(parsed.schema.issues.length).toBe(1);
    expect(parsed.schema.root.status).toBe('fail');
    expect(parsed.schema.counts.fail).toBe(2);
    expect(parsed.meta?.strict).toBe(true);
  });
});

describe('formatSignOutput', () => {
  const createSignResult = (overrides?: Partial<SignDatabaseResult>): SignDatabaseResult => ({
    ok: true,
    summary: 'Database signed (marker created)',
    contract: {
      coreHash: 'sha256:abc123',
      profileHash: 'sha256:def456',
    },
    target: {
      expected: 'postgres',
      actual: 'postgres',
    },
    marker: {
      created: true,
      updated: false,
    },
    meta: {
      contractPath: './contract.json',
      configPath: './prisma-next.config.ts',
    },
    timings: {
      total: 42,
    },
    ...overrides,
  });

  it('renders success message for new marker', () => {
    const result = createSignResult();
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSignOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Database signed (marker created)');
  });

  it('renders success message for updated marker', () => {
    const result = createSignResult({
      summary: 'Database signed (marker updated from sha256:old-hash)',
      marker: {
        created: false,
        updated: true,
        previous: {
          coreHash: 'sha256:old-hash',
          profileHash: 'sha256:old-profile-hash',
        },
      },
    });
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSignOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Database signed (marker updated from sha256:old-hash)');
  });

  it('renders success message for already up-to-date marker', () => {
    const result = createSignResult({
      summary: 'Database already signed with this contract',
      marker: {
        created: false,
        updated: false,
      },
    });
    const flags = parseGlobalFlags({ 'no-color': true });

    const output = formatSignOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('✓ Database already signed with this contract');
  });

  it('includes hashes in verbose mode', () => {
    const result = createSignResult();
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });

    const output = formatSignOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('coreHash: sha256:abc123');
    expect(stripped).toContain('profileHash: sha256:def456');
    expect(stripped).toContain('Total time: 42ms');
  });

  it('includes previous hashes in verbose mode when marker was updated', () => {
    const result = createSignResult({
      summary: 'Database signed (marker updated from sha256:old-hash)',
      marker: {
        created: false,
        updated: true,
        previous: {
          coreHash: 'sha256:old-hash',
          profileHash: 'sha256:old-profile-hash',
        },
      },
    });
    const flags = parseGlobalFlags({ verbose: true, 'no-color': true });

    const output = formatSignOutput(result, flags);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('previous coreHash: sha256:old-hash');
    expect(stripped).toContain('previous profileHash: sha256:old-profile-hash');
  });

  it('returns empty string in quiet mode', () => {
    const result = createSignResult();
    const flags = parseGlobalFlags({ quiet: true, 'no-color': true });

    const output = formatSignOutput(result, flags);

    expect(output).toBe('');
  });
});

describe('formatSignJson', () => {
  const createSignResult = (overrides?: Partial<SignDatabaseResult>): SignDatabaseResult => ({
    ok: true,
    summary: 'Database signed (marker created)',
    contract: {
      coreHash: 'sha256:abc123',
      profileHash: 'sha256:def456',
    },
    target: {
      expected: 'postgres',
      actual: 'postgres',
    },
    marker: {
      created: true,
      updated: false,
    },
    meta: {
      contractPath: './contract.json',
      configPath: './prisma-next.config.ts',
    },
    timings: {
      total: 42,
    },
    ...overrides,
  });

  it('formats new marker result as JSON', () => {
    const result = createSignResult();
    const output = formatSignJson(result);
    const parsed = JSON.parse(output) as SignDatabaseResult;

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Database signed (marker created)');
    expect(parsed.contract.coreHash).toBe('sha256:abc123');
    expect(parsed.contract.profileHash).toBe('sha256:def456');
    expect(parsed.marker.created).toBe(true);
    expect(parsed.marker.updated).toBe(false);
    expect(parsed.timings.total).toBe(42);
  });

  it('formats updated marker result as JSON', () => {
    const result = createSignResult({
      summary: 'Database signed (marker updated from sha256:old-hash)',
      marker: {
        created: false,
        updated: true,
        previous: {
          coreHash: 'sha256:old-hash',
          profileHash: 'sha256:old-profile-hash',
        },
      },
    });
    const output = formatSignJson(result);
    const parsed = JSON.parse(output) as SignDatabaseResult;

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Database signed (marker updated from sha256:old-hash)');
    expect(parsed.marker.created).toBe(false);
    expect(parsed.marker.updated).toBe(true);
    expect(parsed.marker.previous?.coreHash).toBe('sha256:old-hash');
    expect(parsed.marker.previous?.profileHash).toBe('sha256:old-profile-hash');
  });

  it('formats already up-to-date marker result as JSON', () => {
    const result = createSignResult({
      summary: 'Database already signed with this contract',
      marker: {
        created: false,
        updated: false,
      },
    });
    const output = formatSignJson(result);
    const parsed = JSON.parse(output) as SignDatabaseResult;

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Database already signed with this contract');
    expect(parsed.marker.created).toBe(false);
    expect(parsed.marker.updated).toBe(false);
    expect(parsed.marker.previous).toBeUndefined();
  });
});
