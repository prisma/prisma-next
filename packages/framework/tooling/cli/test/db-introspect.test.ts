import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type { FamilyInstance, IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbIntrospectCommand } from '../src/commands/db-introspect';
import {
  executeCommand,
  setupCommandMocks,
  setupTestDirectoryFromFixtures,
} from './utils/test-helpers';

// Fixture subdirectory for db-introspect tests
const fixtureSubdir = 'db-introspect';

describe('db introspect command', () => {
  let consoleOutput: string[] = [];
  let cleanupMocks: () => void;

  beforeEach(() => {
    // Set up console and process.exit mocks
    const mocks = setupCommandMocks();
    consoleOutput = mocks.consoleOutput;
    cleanupMocks = mocks.cleanup;
  });

  afterEach(() => {
    cleanupMocks();
  });

  it('outputs tree when toSchemaView is available', async () => {
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.with-db.ts',
      { '{{DB_URL}}': 'postgresql://user:pass@localhost/test' },
    );
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      // Mock the config loader to return a config with mocked family instance
      const mockSchemaIR = { tables: { user: { columns: {} } } };
      const mockSchemaView: CoreSchemaView = {
        root: {
          kind: 'root',
          id: 'sql-schema',
          label: 'sql schema (tables: 1)',
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
              ],
            },
          ],
        },
      };

      const mockFamilyInstance = {
        introspect: vi.fn().mockResolvedValue(mockSchemaIR),
        toSchemaView: vi.fn().mockReturnValue(mockSchemaView),
        validateContractIR: vi.fn((x) => x),
      } as unknown as FamilyInstance<string>;

      // Mock loadConfig to return config with mocked family
      const originalLoadConfig = await import('../src/config-loader');
      vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn().mockReturnValue(mockFamilyInstance),
        },
        target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        driver: {
          create: vi.fn().mockResolvedValue({
            query: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        },
        db: { url: 'postgresql://user:pass@localhost/test' },
      } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

      const command = createDbIntrospectCommand();
      const exitCode = await executeCommand(command, ['--config', configPath]);

      expect(exitCode).toBe(0);
      expect(mockFamilyInstance.introspect).toHaveBeenCalled();
      expect(mockFamilyInstance.toSchemaView).toHaveBeenCalledWith(mockSchemaIR);

      // Check that tree output is present with proper structure
      const output = consoleOutput.join('\n');
      expect(output).toContain('sql schema (tables: 1)');
      expect(output).toContain('table user');
      expect(output).toContain('id: pg/int4@1');
      // Verify tree characters are present
      expect(output).toMatch(/[├└]/);
    } finally {
      cleanupDir();
    }
  });

  it('outputs summary when toSchemaView is not available', async () => {
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.with-db.ts',
      { '{{DB_URL}}': 'postgresql://user:pass@localhost/test' },
    );
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      const mockSchemaIR = { tables: { user: { columns: {} } } };

      const mockFamilyInstance = {
        introspect: vi.fn().mockResolvedValue(mockSchemaIR),
        toSchemaView: undefined, // Not available
        validateContractIR: vi.fn((x) => x),
      } as unknown as FamilyInstance<string>;

      // Mock loadConfig
      const originalLoadConfig = await import('../src/config-loader');
      vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn().mockReturnValue(mockFamilyInstance),
        },
        target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        driver: {
          create: vi.fn().mockResolvedValue({
            query: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        },
        db: { url: 'postgresql://user:pass@localhost/test' },
      } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

      const command = createDbIntrospectCommand();
      const exitCode = await executeCommand(command, ['--config', configPath]);

      expect(exitCode).toBe(0);
      expect(mockFamilyInstance.introspect).toHaveBeenCalled();

      // Check that summary output is present
      const output = consoleOutput.join('\n');
      expect(output).toContain('✓ Schema introspected successfully');
      // Should not contain tree structure when schema view is not available
      // (header may contain └, but tree structure like "├─ table" should not be present)
      expect(output).not.toMatch(/├─/);
      expect(output).not.toMatch(/└─/);
    } finally {
      cleanupDir();
    }
  });

  it('outputs JSON envelope when --json flag is used', async () => {
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.with-db.ts',
      { '{{DB_URL}}': 'postgresql://user:pass@localhost/test' },
    );
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      const mockSchemaIR = { tables: { user: { columns: {} } } };

      const mockFamilyInstance = {
        introspect: vi.fn().mockResolvedValue(mockSchemaIR),
        toSchemaView: undefined,
        validateContractIR: vi.fn((x) => x),
      } as unknown as FamilyInstance<string>;

      // Mock loadConfig
      const originalLoadConfig = await import('../src/config-loader');
      vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn().mockReturnValue(mockFamilyInstance),
        },
        target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        driver: {
          create: vi.fn().mockResolvedValue({
            query: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        },
        db: { url: 'postgresql://user:pass@localhost/test' },
      } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

      const command = createDbIntrospectCommand();
      const exitCode = await executeCommand(command, ['--config', configPath, '--json']);

      expect(exitCode).toBe(0);

      // Check that JSON output is present and properly formatted
      const output = consoleOutput.join('\n');
      const jsonOutput = JSON.parse(output) as IntrospectSchemaResult<unknown>;
      expect(jsonOutput.ok).toBe(true);
      expect(jsonOutput.summary).toBe('Schema introspected successfully');
      expect(jsonOutput.target.familyId).toBe('sql');
      expect(jsonOutput.target.id).toBe('postgres');
      expect(jsonOutput.schema).toEqual(mockSchemaIR);
      expect(jsonOutput.timings.total).toBeGreaterThanOrEqual(0);
      // Verify JSON structure matches IntrospectSchemaResult shape
      expect(jsonOutput).toHaveProperty('ok');
      expect(jsonOutput).toHaveProperty('summary');
      expect(jsonOutput).toHaveProperty('target');
      expect(jsonOutput).toHaveProperty('schema');
      expect(jsonOutput).toHaveProperty('timings');
    } finally {
      cleanupDir();
    }
  });

  it('throws error when DB URL is missing', async () => {
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-db.ts',
      {},
    );
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      // Mock loadConfig to return config without db.url (bypassing validation)
      const originalLoadConfig = await import('../src/config-loader');
      vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn(),
        },
        target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        driver: {
          create: vi.fn().mockResolvedValue({
            query: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
          }),
        },
        // db.url is missing - this is what we're testing
      } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

      const command = createDbIntrospectCommand();
      await expect(executeCommand(command, ['--config', configPath])).rejects.toThrow();
    } finally {
      cleanupDir();
    }
  });

  it('throws error when driver is missing', async () => {
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.no-driver.ts',
      { '{{DB_URL}}': 'postgresql://user:pass@localhost/test' },
    );
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      // Mock loadConfig to return config without driver (bypassing validation)
      const originalLoadConfig = await import('../src/config-loader');
      vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn(),
        },
        target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        // driver is missing - this is what we're testing
        db: { url: 'postgresql://user:pass@localhost/test' },
      } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

      const command = createDbIntrospectCommand();
      await expect(executeCommand(command, ['--config', configPath])).rejects.toThrow();
    } finally {
      cleanupDir();
    }
  });

  it('closes driver in finally block even when introspect throws', async () => {
    const testSetup = setupTestDirectoryFromFixtures(
      fixtureSubdir,
      'prisma-next.config.with-db.ts',
      { '{{DB_URL}}': 'postgresql://user:pass@localhost/test' },
    );
    const configPath = testSetup.configPath;
    const cleanupDir = testSetup.cleanup;

    try {
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockDriver = {
        query: vi.fn(),
        close: mockClose,
      };

      const mockFamilyInstance = {
        introspect: vi.fn().mockRejectedValue(new Error('Introspect failed')),
        validateContractIR: vi.fn((x) => x),
      } as unknown as FamilyInstance<string>;

      // Mock loadConfig
      const originalLoadConfig = await import('../src/config-loader');
      vi.spyOn(originalLoadConfig, 'loadConfig').mockResolvedValue({
        family: {
          familyId: 'sql',
          create: vi.fn().mockReturnValue(mockFamilyInstance),
        },
        target: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        adapter: { id: 'postgres', familyId: 'sql', targetId: 'postgres', create: vi.fn() },
        driver: {
          create: vi.fn().mockResolvedValue(mockDriver),
        },
        db: { url: 'postgresql://user:pass@localhost/test' },
      } as unknown as Awaited<ReturnType<typeof originalLoadConfig.loadConfig>>);

      const command = createDbIntrospectCommand();
      await expect(executeCommand(command, ['--config', configPath])).rejects.toThrow();

      // Verify driver.close was called
      expect(mockClose).toHaveBeenCalled();
    } finally {
      cleanupDir();
    }
  });
});
