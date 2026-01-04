import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it, vi } from 'vitest';
import { createControlClient } from '../../src/control-api/client';
import type { ControlClientOptions } from '../../src/control-api/types';

// ============================================================================
// Mock Descriptors
// ============================================================================

function createMockFamilyDescriptor(): ControlFamilyDescriptor<'sql'> {
  return {
    kind: 'family',
    familyId: 'sql',
    id: 'sql',
    version: '1.0.0',
    hook: {
      id: 'sql',
      generateContractTypes: vi.fn(),
      validateStructure: vi.fn(),
      validateTypes: vi.fn(),
    },
    create: vi.fn().mockReturnValue({
      familyId: 'sql',
      validateContractIR: vi.fn().mockImplementation((c) => c),
      verify: vi.fn(),
      schemaVerify: vi.fn(),
      sign: vi.fn(),
      readMarker: vi.fn(),
      introspect: vi.fn(),
      emitContract: vi.fn(),
    }),
  };
}

function createMockTargetDescriptor(): ControlTargetDescriptor<'sql', 'postgres'> {
  return {
    kind: 'target',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'postgres',
    version: '1.0.0',
    create: vi.fn().mockReturnValue({
      familyId: 'sql',
      targetId: 'postgres',
    }),
  };
}

function createMockAdapterDescriptor(): ControlAdapterDescriptor<'sql', 'postgres'> {
  return {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'postgres-adapter',
    version: '1.0.0',
    create: vi.fn().mockReturnValue({
      familyId: 'sql',
      targetId: 'postgres',
    }),
  };
}

function createMockDriverDescriptor(): ControlDriverDescriptor<'sql', 'postgres'> {
  return {
    kind: 'driver',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'postgres-driver',
    version: '1.0.0',
    create: vi.fn().mockResolvedValue({
      familyId: 'sql',
      targetId: 'postgres',
      query: vi.fn(),
      close: vi.fn(),
    }),
  };
}

function createMockExtensionDescriptor(): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    familyId: 'sql',
    targetId: 'postgres',
    id: 'pgvector',
    version: '1.0.0',
    create: vi.fn().mockReturnValue({
      familyId: 'sql',
      targetId: 'postgres',
    }),
  };
}

function createMockOptions(overrides?: Partial<ControlClientOptions>): ControlClientOptions {
  return {
    family: createMockFamilyDescriptor(),
    target: createMockTargetDescriptor(),
    adapter: createMockAdapterDescriptor(),
    driver: createMockDriverDescriptor(),
    extensionPacks: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ControlClient', () => {
  describe('construction', () => {
    it('creates client without driver (for offline operations)', () => {
      const { driver: _, ...optionsWithoutDriver } = createMockOptions();
      const options = optionsWithoutDriver as ControlClientOptions;

      const client = createControlClient(options);

      expect(client).toBeDefined();
      expect(client.connect).toBeInstanceOf(Function);
      expect(client.close).toBeInstanceOf(Function);
    });

    it('creates client with all options', () => {
      const options = createMockOptions({
        extensionPacks: [createMockExtensionDescriptor()],
      });

      const client = createControlClient(options);

      expect(client).toBeDefined();
    });
  });

  describe('connect()', () => {
    it('throws if driver is not configured', async () => {
      const { driver: _, ...optionsWithoutDriver } = createMockOptions();
      const options = optionsWithoutDriver as ControlClientOptions;
      const client = createControlClient(options);

      await expect(client.connect('postgres://localhost')).rejects.toThrow(
        'Driver is not configured',
      );
    });

    it('throws if already connected', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await client.connect('postgres://localhost');

      await expect(client.connect('postgres://localhost')).rejects.toThrow('Already connected');
    });

    it('creates driver instance via driver.create()', async () => {
      const driverDescriptor = createMockDriverDescriptor();
      const options = createMockOptions({ driver: driverDescriptor });
      const client = createControlClient(options);

      await client.connect('postgres://localhost/test');

      expect(driverDescriptor.create).toHaveBeenCalledWith('postgres://localhost/test');
    });

    it('creates family instance via family.create()', async () => {
      const familyDescriptor = createMockFamilyDescriptor();
      const options = createMockOptions({ family: familyDescriptor });
      const client = createControlClient(options);

      await client.connect('postgres://localhost');

      expect(familyDescriptor.create).toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('is idempotent (safe to call multiple times)', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await client.connect('postgres://localhost');
      await client.close();
      await client.close(); // Should not throw

      expect(true).toBe(true); // If we get here, it's idempotent
    });

    it('closes driver instance', async () => {
      const driverDescriptor = createMockDriverDescriptor();
      const mockDriver = {
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        query: vi.fn(),
        close: vi.fn(),
      };
      driverDescriptor.create = vi.fn().mockResolvedValue(mockDriver);

      const options = createMockOptions({ driver: driverDescriptor });
      const client = createControlClient(options);

      await client.connect('postgres://localhost');
      await client.close();

      expect(mockDriver.close).toHaveBeenCalled();
    });

    it('allows reconnect after close', async () => {
      const driverDescriptor = createMockDriverDescriptor();
      const options = createMockOptions({ driver: driverDescriptor });
      const client = createControlClient(options);

      await client.connect('postgres://localhost');
      await client.close();
      await client.connect('postgres://localhost');

      expect(driverDescriptor.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('operations throw if not connected', () => {
    it('verify() throws if not connected', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await expect(client.verify({ contractIR: { target: 'postgres' } as never })).rejects.toThrow(
        'Not connected',
      );
    });

    it('schemaVerify() throws if not connected', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await expect(
        client.schemaVerify({ contractIR: { target: 'postgres' } as never }),
      ).rejects.toThrow('Not connected');
    });

    it('sign() throws if not connected', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await expect(client.sign({ contractIR: { target: 'postgres' } as never })).rejects.toThrow(
        'Not connected',
      );
    });

    it('dbInit() throws if not connected', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await expect(
        client.dbInit({ contractIR: { target: 'postgres' } as never, mode: 'plan' }),
      ).rejects.toThrow('Not connected');
    });

    it('introspect() throws if not connected', async () => {
      const options = createMockOptions();
      const client = createControlClient(options);

      await expect(client.introspect()).rejects.toThrow('Not connected');
    });
  });

  describe('operations delegate to family instance', () => {
    it('verify() delegates to familyInstance.verify()', async () => {
      const mockVerifyResult = {
        ok: true,
        summary: 'Database matches contract',
        contract: { coreHash: 'hash' },
        target: { expected: 'postgres' },
        timings: { total: 100 },
      };
      const familyDescriptor = createMockFamilyDescriptor();
      const mockFamilyInstance = familyDescriptor.create({
        target: createMockTargetDescriptor(),
        adapter: createMockAdapterDescriptor(),
        driver: undefined,
        extensionPacks: [],
      });
      mockFamilyInstance.verify = vi.fn().mockResolvedValue(mockVerifyResult);
      familyDescriptor.create = vi.fn().mockReturnValue(mockFamilyInstance);

      const options = createMockOptions({ family: familyDescriptor });
      const client = createControlClient(options);
      await client.connect('postgres://localhost');

      const result = await client.verify({
        contractIR: { target: 'postgres' } as never,
      });

      expect(mockFamilyInstance.verify).toHaveBeenCalled();
      expect(result).toMatchObject({ ok: true });
    });

    it('introspect() delegates to familyInstance.introspect()', async () => {
      const mockSchemaIR = { tables: {} };
      const familyDescriptor = createMockFamilyDescriptor();
      const mockFamilyInstance = familyDescriptor.create({
        target: createMockTargetDescriptor(),
        adapter: createMockAdapterDescriptor(),
        driver: undefined,
        extensionPacks: [],
      });
      mockFamilyInstance.introspect = vi.fn().mockResolvedValue(mockSchemaIR);
      familyDescriptor.create = vi.fn().mockReturnValue(mockFamilyInstance);

      const options = createMockOptions({ family: familyDescriptor });
      const client = createControlClient(options);
      await client.connect('postgres://localhost');

      const result = await client.introspect();

      expect(mockFamilyInstance.introspect).toHaveBeenCalled();
      expect(result).toMatchObject({ tables: {} });
    });
  });

  describe('dbInit', () => {
    it('throws if target does not support migrations', async () => {
      const targetDescriptor = createMockTargetDescriptor();
      // No migrations capability
      const options = createMockOptions({ target: targetDescriptor });
      const client = createControlClient(options);
      await client.connect('postgres://localhost');

      await expect(
        client.dbInit({ contractIR: { target: 'postgres' } as never, mode: 'plan' }),
      ).rejects.toThrow('does not support migrations');
    });
  });
});
