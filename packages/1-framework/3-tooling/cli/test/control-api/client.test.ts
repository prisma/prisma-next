import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it, vi } from 'vitest';
import { createPrismaNextControlClient } from '../../src/control-api/client';
import type {
  ControlClientOptions,
  PrismaNextControlClientInternals,
} from '../../src/control-api/types';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockDriver(): ControlDriverInstance<'sql', 'postgres'> {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    query: vi.fn().mockResolvedValue({ rows: [] }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFamilyInstance(): ControlFamilyInstance<'sql'> {
  return {
    familyId: 'sql',
    validateContractIR: vi.fn().mockImplementation((ir) => ir),
    verify: vi.fn().mockResolvedValue({ ok: true, summary: 'Verified' }),
    schemaVerify: vi.fn().mockResolvedValue({ ok: true, summary: 'Schema verified' }),
    sign: vi.fn().mockResolvedValue({ ok: true, summary: 'Signed' }),
    readMarker: vi.fn().mockResolvedValue(null),
    introspect: vi.fn().mockResolvedValue({ tables: {} }),
    emitContract: vi.fn().mockResolvedValue({
      contractJson: '{}',
      contractDts: '',
      coreHash: 'sha256:test',
      profileHash: 'sha256:test',
    }),
  };
}

function createMockOptions(): ControlClientOptions {
  const mockFamilyInstance = createMockFamilyInstance();

  const family: ControlFamilyDescriptor<'sql', ControlFamilyInstance<'sql'>> = {
    kind: 'family',
    id: 'sql',
    familyId: 'sql',
    manifest: { id: 'sql', version: '1.0.0', targets: {}, capabilities: {}, types: {} },
    hook: {} as never,
    create: vi.fn().mockReturnValue(mockFamilyInstance),
  };

  const target: ControlTargetDescriptor<'sql', 'postgres'> = {
    kind: 'target',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    manifest: { id: 'postgres', version: '1.0.0', targets: {}, capabilities: {}, types: {} },
    create: vi.fn(),
  };

  const adapter: ControlAdapterDescriptor<'sql', 'postgres'> = {
    kind: 'adapter',
    id: 'postgres-adapter',
    familyId: 'sql',
    targetId: 'postgres',
    manifest: {
      id: 'postgres-adapter',
      version: '1.0.0',
      targets: {},
      capabilities: {},
      types: {},
    },
    create: vi.fn(),
  };

  const driver: ControlDriverDescriptor<'sql', 'postgres'> = {
    kind: 'driver',
    id: 'postgres-driver',
    familyId: 'sql',
    targetId: 'postgres',
    manifest: { id: 'postgres-driver', version: '1.0.0', targets: {}, capabilities: {}, types: {} },
    create: vi.fn().mockResolvedValue(createMockDriver()),
  };

  return { family, target, adapter, driver };
}

// ============================================================================
// Tests
// ============================================================================

describe('createPrismaNextControlClient', () => {
  it('creates a client instance', () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    expect(client).toBeDefined();
    expect(client.connect).toBeDefined();
    expect(client.close).toBeDefined();
    expect(client.verify).toBeDefined();
    expect(client.schemaVerify).toBeDefined();
    expect(client.sign).toBeDefined();
    expect(client.dbInit).toBeDefined();
    expect(client.introspect).toBeDefined();
  });

  it('stores options for later use', () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    const internals = client as unknown as PrismaNextControlClientInternals;

    expect(internals.options).toBe(options);
  });
});

describe('client.connect', () => {
  it('creates driver and family instance', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await client.connect('postgres://test');

    expect(options.driver.create).toHaveBeenCalledWith('postgres://test');
    expect(options.family.create).toHaveBeenCalledWith({
      target: options.target,
      adapter: options.adapter,
      driver: options.driver,
      extensions: [],
    });
  });

  it('sets driver and familyInstance on client', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    const internals = client as unknown as PrismaNextControlClientInternals;

    expect(internals.driver).toBeNull();
    expect(internals.familyInstance).toBeNull();

    await client.connect('postgres://test');

    expect(internals.driver).not.toBeNull();
    expect(internals.familyInstance).not.toBeNull();
  });

  it('throws if already connected', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await client.connect('postgres://test');

    await expect(client.connect('postgres://test')).rejects.toThrow(
      'Already connected. Call close() before reconnecting.',
    );
  });

  it('passes extension packs to family.create', async () => {
    const extension: ControlExtensionDescriptor<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'pgvector',
      familyId: 'sql',
      targetId: 'postgres',
      manifest: { id: 'pgvector', version: '1.0.0', targets: {}, capabilities: {}, types: {} },
      create: vi.fn(),
    };

    const options = { ...createMockOptions(), extensionPacks: [extension] };
    const client = createPrismaNextControlClient(options);

    await client.connect('postgres://test');

    expect(options.family.create).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: [extension],
      }),
    );
  });
});

describe('client.close', () => {
  it('closes driver connection', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await client.connect('postgres://test');
    const internals = client as unknown as PrismaNextControlClientInternals;
    const mockDriver = internals.driver;

    await client.close();

    expect(mockDriver?.close).toHaveBeenCalled();
  });

  it('clears driver and familyInstance', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    const internals = client as unknown as PrismaNextControlClientInternals;

    await client.connect('postgres://test');
    expect(internals.driver).not.toBeNull();

    await client.close();

    expect(internals.driver).toBeNull();
    expect(internals.familyInstance).toBeNull();
  });

  it('is idempotent (safe to call multiple times)', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await client.connect('postgres://test');
    await client.close();
    await client.close(); // Should not throw

    expect(true).toBe(true);
  });

  it('is safe to call without connect', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await client.close(); // Should not throw

    expect(true).toBe(true);
  });
});

describe('operations without connection', () => {
  it('verify throws if not connected', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await expect(client.verify({ contractIR: {} as never })).rejects.toThrow(
      'Not connected. Call connect() first.',
    );
  });

  it('schemaVerify throws if not connected', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await expect(client.schemaVerify({ contractIR: {} as never })).rejects.toThrow(
      'Not connected. Call connect() first.',
    );
  });

  it('sign throws if not connected', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await expect(client.sign({ contractIR: {} as never })).rejects.toThrow(
      'Not connected. Call connect() first.',
    );
  });

  it('dbInit throws if not connected', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await expect(client.dbInit({ contractIR: {} as never, mode: 'plan' })).rejects.toThrow(
      'Not connected. Call connect() first.',
    );
  });

  it('introspect throws if not connected', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);

    await expect(client.introspect()).rejects.toThrow('Not connected. Call connect() first.');
  });
});

describe('client.verify', () => {
  it('delegates to familyInstance.verify', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const internals = client as unknown as PrismaNextControlClientInternals;
    const mockInstance = internals.familyInstance!;

    const contractIR = { target: 'postgres', coreHash: 'sha256:test' };
    await client.verify({ contractIR: contractIR as never });

    expect(mockInstance.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        contractIR,
        expectedTargetId: 'postgres',
        contractPath: '',
      }),
    );
  });

  it('returns verification result', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const result = await client.verify({ contractIR: {} as never });

    expect(result).toMatchObject({ ok: true, summary: 'Verified' });
  });
});

describe('client.schemaVerify', () => {
  it('delegates to familyInstance.schemaVerify with default strict=false', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const internals = client as unknown as PrismaNextControlClientInternals;
    const mockInstance = internals.familyInstance!;

    await client.schemaVerify({ contractIR: {} as never });

    expect(mockInstance.schemaVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        strict: false,
        contractPath: '',
      }),
    );
  });

  it('respects strict=true option', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const internals = client as unknown as PrismaNextControlClientInternals;
    const mockInstance = internals.familyInstance!;

    await client.schemaVerify({ contractIR: {} as never, strict: true });

    expect(mockInstance.schemaVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        strict: true,
      }),
    );
  });
});

describe('client.sign', () => {
  it('delegates to familyInstance.sign', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const internals = client as unknown as PrismaNextControlClientInternals;
    const mockInstance = internals.familyInstance!;

    await client.sign({ contractIR: {} as never });

    expect(mockInstance.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        contractPath: '',
      }),
    );
  });
});

describe('client.introspect', () => {
  it('delegates to familyInstance.introspect', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const internals = client as unknown as PrismaNextControlClientInternals;
    const mockInstance = internals.familyInstance!;

    await client.introspect();

    expect(mockInstance.introspect).toHaveBeenCalled();
  });

  it('returns introspection result', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    const result = await client.introspect();

    expect(result).toMatchObject({ tables: {} });
  });
});

describe('client.dbInit', () => {
  it('throws if target does not support migrations', async () => {
    const options = createMockOptions();
    const client = createPrismaNextControlClient(options);
    await client.connect('postgres://test');

    await expect(client.dbInit({ contractIR: {} as never, mode: 'plan' })).rejects.toThrow(
      'Target "postgres" does not support migrations',
    );
  });
});
