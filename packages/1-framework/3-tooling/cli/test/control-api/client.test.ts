import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { createControlClient } from '../../src/control-api/client';
import type { ControlProgressEvent } from '../../src/control-api/types';

function createMockComponents() {
  const mockDriver = {
    close: async () => {},
  } as unknown as ControlDriverInstance<string, string>;

  const mockFamilyInstance = {
    introspect: async () => ({ tables: [] }),
    validateContractIR: (ir: unknown) => ir as ContractIR,
    readMarker: async () => null,
    verify: async (): Promise<VerifyDatabaseResult> => ({
      ok: true,
      summary: 'Verification passed',
      contract: { coreHash: 'test-hash' },
      marker: { coreHash: 'test-hash' },
      target: { expected: 'postgres' },
      timings: { total: 10 },
    }),
    schemaVerify: async (): Promise<VerifyDatabaseSchemaResult> => ({
      ok: true,
      summary: 'Schema verification passed',
      contract: { coreHash: 'test-hash' },
      target: { expected: 'postgres' },
      schema: {
        issues: [],
        root: {
          status: 'pass' as const,
          kind: 'root',
          name: 'root',
          contractPath: '',
          code: 'OK',
          message: 'OK',
          expected: {},
          actual: {},
          children: [],
        },
        counts: { pass: 1, warn: 0, fail: 0, totalNodes: 1 },
      },
      timings: { total: 10 },
    }),
    sign: async (): Promise<SignDatabaseResult> => ({
      ok: true,
      summary: 'Database signed successfully',
      contract: { coreHash: 'test-hash' },
      target: { expected: 'postgres' },
      marker: { created: false, updated: true },
      timings: { total: 10 },
    }),
    emitContract: async () => ({
      coreHash: 'test-core-hash',
      profileHash: 'test-profile-hash',
      contractJson: '{"test": true}',
      contractDts: 'export interface Contract {}',
    }),
  } as unknown as ControlFamilyInstance<string>;

  const mockFamily = {
    familyId: 'sql',
    create: () => mockFamilyInstance,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlFamilyDescriptor<any, any>;

  const mockTarget = {
    kind: 'target',
    targetId: 'postgres',
    familyId: 'sql',
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlTargetDescriptor<any, any, any, any>;

  const mockAdapter = {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'postgres',
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlAdapterDescriptor<any, any, any>;

  const mockDriverDescriptor = {
    targetId: 'postgres',
    create: async () => mockDriver,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlDriverDescriptor<any, any, any, any>;

  return {
    mockDriver,
    mockFamilyInstance,
    mockFamily,
    mockTarget,
    mockAdapter,
    mockDriverDescriptor,
  };
}

describe('ControlClient progress emission', () => {
  describe('verify()', () => {
    it('emits connect and verify spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.verify({
        contractIR: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit verify span
      const verifyStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'verify');
      const verifyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'verify');
      expect(verifyStart).toBeDefined();
      expect(verifyEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'verify'
      for (const event of events) {
        expect(event.action).toBe('verify');
      }
    });

    it('emits only verify span when already connected', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      // Connect first
      await client.connect('postgres://test');

      await client.verify({
        contractIR: {},
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should NOT emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      expect(connectStart).toBeUndefined();

      // Should emit verify span
      const verifyStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'verify');
      expect(verifyStart).toBeDefined();
    });
  });

  describe('schemaVerify()', () => {
    it('emits connect and schemaVerify spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.schemaVerify({
        contractIR: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit schemaVerify span
      const schemaVerifyStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'schemaVerify',
      );
      const schemaVerifyEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'schemaVerify',
      );
      expect(schemaVerifyStart).toBeDefined();
      expect(schemaVerifyEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'schemaVerify'
      for (const event of events) {
        expect(event.action).toBe('schemaVerify');
      }
    });

    it('emits error outcome when schema verification fails', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor, mockFamilyInstance } =
        createMockComponents();

      // Override schemaVerify to return a failure
      mockFamilyInstance.schemaVerify = async (): Promise<VerifyDatabaseSchemaResult> => ({
        ok: false,
        summary: 'Schema mismatch',
        contract: { coreHash: 'test-hash' },
        target: { expected: 'postgres' },
        schema: {
          issues: [],
          root: {
            status: 'fail' as const,
            kind: 'root',
            name: 'root',
            contractPath: '',
            code: 'MISMATCH',
            message: 'Schema mismatch',
            expected: {},
            actual: {},
            children: [],
          },
          counts: { pass: 0, warn: 0, fail: 1, totalNodes: 1 },
        },
        timings: { total: 10 },
      });

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.schemaVerify({
        contractIR: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit schemaVerify span with error outcome
      const schemaVerifyEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'schemaVerify',
      );
      expect(schemaVerifyEnd).toMatchObject({ outcome: 'error' });
    });
  });

  describe('sign()', () => {
    it('emits connect and sign spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.sign({
        contractIR: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit sign span
      const signStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'sign');
      const signEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'sign');
      expect(signStart).toBeDefined();
      expect(signEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'sign'
      for (const event of events) {
        expect(event.action).toBe('sign');
      }
    });
  });

  describe('introspect()', () => {
    it('emits connect and introspect spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.introspect({
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit introspect span
      const introspectStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'introspect',
      );
      const introspectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'introspect');
      expect(introspectStart).toBeDefined();
      expect(introspectEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'introspect'
      for (const event of events) {
        expect(event.action).toBe('introspect');
      }
    });

    it('emits only introspect span when already connected', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      // Connect first
      await client.connect('postgres://test');

      await client.introspect({
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should NOT emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      expect(connectStart).toBeUndefined();

      // Should emit introspect span
      const introspectStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'introspect',
      );
      expect(introspectStart).toBeDefined();
    });
  });

  describe('emit()', () => {
    it('emits resolveSource and emit spans', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        // No driver needed for emit
      });

      const result = await client.emit({
        contractConfig: {
          source: { kind: 'value', value: { test: true } },
          output: '/tmp/contract.json',
        },
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(true);

      // Should emit resolveSource span
      const resolveSourceStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'resolveSource',
      );
      const resolveSourceEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'resolveSource',
      );
      expect(resolveSourceStart).toBeDefined();
      expect(resolveSourceEnd).toMatchObject({ outcome: 'ok' });

      // Should emit emit span
      const emitStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'emit');
      const emitEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'emit');
      expect(emitStart).toBeDefined();
      expect(emitEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'emit'
      for (const event of events) {
        expect(event.action).toBe('emit');
      }
    });

    it('emits resolveSource and emit spans when source is a function', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          source: { kind: 'loader', load: async () => ({ test: true }) },
          output: '/tmp/contract.json',
        },
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(true);

      // Should emit resolveSource span
      const resolveSourceStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'resolveSource',
      );
      const resolveSourceEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'resolveSource',
      );
      expect(resolveSourceStart).toBeDefined();
      expect(resolveSourceEnd).toMatchObject({ outcome: 'ok' });
    });

    it('emits error outcome when source function throws', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          source: {
            kind: 'loader',
            load: async () => {
              throw new Error('Source load error');
            },
          },
          output: '/tmp/contract.json',
        },
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('CONTRACT_SOURCE_INVALID');
      }

      // Should emit resolveSource span with error outcome
      const resolveSourceEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'resolveSource',
      );
      expect(resolveSourceEnd).toMatchObject({ outcome: 'error' });
    });

    it('emits error outcome when emitContract throws', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockFamilyInstance } = createMockComponents();

      // Override emitContract to throw
      mockFamilyInstance.emitContract = async () => {
        throw new Error('Emit error');
      };

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          source: { kind: 'value', value: { test: true } },
          output: '/tmp/contract.json',
        },
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('EMIT_FAILED');
      }

      // Should emit emit span with error outcome
      const emitEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'emit');
      expect(emitEnd).toMatchObject({ outcome: 'error' });
    });
  });

  describe('no onProgress callback', () => {
    it('does not throw when onProgress is omitted from verify', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.verify({
        contractIR: {},
        connection: 'postgres://test',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });

    it('does not throw when onProgress is omitted from schemaVerify', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.schemaVerify({
        contractIR: {},
        connection: 'postgres://test',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });

    it('does not throw when onProgress is omitted from sign', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.sign({
        contractIR: {},
        connection: 'postgres://test',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });

    it('does not throw when onProgress is omitted from introspect', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.introspect({
        connection: 'postgres://test',
      });

      await client.close();

      expect(result).toBeDefined();
    });

    it('does not throw when onProgress is omitted from emit', async () => {
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          source: { kind: 'value', value: { test: true } },
          output: '/tmp/contract.json',
        },
      });

      await client.close();

      expect(result.ok).toBe(true);
    });
  });
});
