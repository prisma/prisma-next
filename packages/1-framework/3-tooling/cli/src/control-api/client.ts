import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlPlaneStack,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok } from '@prisma-next/utils/result';
import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import { ContractValidationError } from './errors';
import { executeDbInit } from './operations/db-init';
import { executeDbUpdate } from './operations/db-update';
import { executeMigrationApply } from './operations/migration-apply';
import type {
  ControlActionName,
  ControlClient,
  ControlClientOptions,
  DbInitOptions,
  DbInitResult,
  DbUpdateOptions,
  DbUpdateResult,
  EmitOptions,
  EmitResult,
  IntrospectOptions,
  MigrationApplyOptions,
  MigrationApplyResult,
  OnControlProgress,
  SchemaVerifyOptions,
  SignOptions,
  VerifyOptions,
} from './types';

/**
 * Creates a programmatic control client for Prisma Next operations.
 *
 * The client accepts framework component descriptors at creation time,
 * manages driver lifecycle via connect()/close(), and exposes domain
 * operations that delegate to the existing family instance methods.
 *
 * @see {@link ControlClient} for the client interface
 * @see README.md "Programmatic Control API" section for usage examples
 */
export function createControlClient(options: ControlClientOptions): ControlClient {
  return new ControlClientImpl(options);
}

/**
 * Implementation of ControlClient.
 * Manages initialization and connection state, delegates operations to family instance.
 */
class ControlClientImpl implements ControlClient {
  private readonly options: ControlClientOptions;
  private stack: ControlPlaneStack<string, string> | null = null;
  private driver: ControlDriverInstance<string, string> | null = null;
  private familyInstance: ControlFamilyInstance<string> | null = null;
  private frameworkComponents: ReadonlyArray<
    TargetBoundComponentDescriptor<string, string>
  > | null = null;
  private initialized = false;
  private readonly defaultConnection: unknown;

  constructor(options: ControlClientOptions) {
    this.options = options;
    this.defaultConnection = options.connection;
  }

  init(): void {
    if (this.initialized) {
      return; // Idempotent
    }

    // Create the control plane stack
    this.stack = createControlPlaneStack({
      target: this.options.target,
      adapter: this.options.adapter,
      driver: this.options.driver,
      extensionPacks: this.options.extensionPacks,
    });

    // Create family instance using the stack
    this.familyInstance = this.options.family.create(this.stack);

    // Validate and type-narrow framework components
    const rawComponents = [
      this.options.target,
      this.options.adapter,
      ...(this.options.extensionPacks ?? []),
    ];
    this.frameworkComponents = assertFrameworkComponentsCompatible(
      this.options.family.familyId,
      this.options.target.targetId,
      rawComponents,
    );

    this.initialized = true;
  }

  async connect(connection?: unknown): Promise<void> {
    // Auto-init if needed
    this.init();

    if (this.driver) {
      throw new Error('Already connected. Call close() before reconnecting.');
    }

    // Resolve connection: argument > default from options
    const resolvedConnection = connection ?? this.defaultConnection;
    if (resolvedConnection === undefined) {
      throw new Error(
        'No connection provided. Pass a connection to connect() or provide a default connection when creating the client.',
      );
    }

    // Check for driver descriptor
    if (!this.stack?.driver) {
      throw new Error(
        'Driver is not configured. Pass a driver descriptor when creating the control client to enable database operations.',
      );
    }

    // Create driver instance
    // Cast through any since connection type is driver-specific at runtime.
    // The driver descriptor is typed with any for TConnection in ControlClientOptions,
    // but createControlPlaneStack defaults it to string. We bridge this at runtime.
    // biome-ignore lint/suspicious/noExplicitAny: required for runtime connection type flexibility
    this.driver = await this.stack?.driver.create(resolvedConnection as any);
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  private async ensureConnected(): Promise<{
    driver: ControlDriverInstance<string, string>;
    familyInstance: ControlFamilyInstance<string>;
    frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>;
  }> {
    // Auto-init if needed
    this.init();

    // Auto-connect if not connected and default connection is available
    if (!this.driver && this.defaultConnection !== undefined) {
      await this.connect(this.defaultConnection);
    }

    if (!this.driver || !this.familyInstance || !this.frameworkComponents) {
      throw new Error('Not connected. Call connect(connection) first.');
    }
    return {
      driver: this.driver,
      familyInstance: this.familyInstance,
      frameworkComponents: this.frameworkComponents,
    };
  }

  private async connectWithProgress(
    connection: unknown | undefined,
    action: ControlActionName,
    onProgress?: OnControlProgress,
  ): Promise<void> {
    if (connection === undefined) return;
    onProgress?.({
      action,
      kind: 'spanStart',
      spanId: 'connect',
      label: 'Connecting to database...',
    });
    try {
      await this.connect(connection);
      onProgress?.({ action, kind: 'spanEnd', spanId: 'connect', outcome: 'ok' });
    } catch (error) {
      onProgress?.({ action, kind: 'spanEnd', spanId: 'connect', outcome: 'error' });
      throw error;
    }
  }

  async verify(options: VerifyOptions): Promise<VerifyDatabaseResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'verify', onProgress);
    const { driver, familyInstance } = await this.ensureConnected();

    // Validate contract using family instance
    let contractIR: ContractIR;
    try {
      contractIR = familyInstance.validateContractIR(options.contractIR);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContractValidationError(message, error);
    }

    // Emit verify span
    onProgress?.({
      action: 'verify',
      kind: 'spanStart',
      spanId: 'verify',
      label: 'Verifying database signature...',
    });

    try {
      // Delegate to family instance verify method
      // Note: We pass empty strings for contractPath/configPath since the programmatic
      // API doesn't deal with file paths. The family instance accepts these as optional
      // metadata for error reporting.
      const result = await familyInstance.verify({
        driver,
        contractIR,
        expectedTargetId: this.options.target.targetId,
        contractPath: '',
      });

      onProgress?.({
        action: 'verify',
        kind: 'spanEnd',
        spanId: 'verify',
        outcome: result.ok ? 'ok' : 'error',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'verify',
        kind: 'spanEnd',
        spanId: 'verify',
        outcome: 'error',
      });
      throw error;
    }
  }

  async schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'schemaVerify', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    // Validate contract using family instance
    let contractIR: ContractIR;
    try {
      contractIR = familyInstance.validateContractIR(options.contractIR);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContractValidationError(message, error);
    }

    // Emit schemaVerify span
    onProgress?.({
      action: 'schemaVerify',
      kind: 'spanStart',
      spanId: 'schemaVerify',
      label: 'Verifying database schema...',
    });

    try {
      // Delegate to family instance schemaVerify method
      const result = await familyInstance.schemaVerify({
        driver,
        contractIR,
        strict: options.strict ?? false,
        contractPath: '',
        frameworkComponents,
      });

      onProgress?.({
        action: 'schemaVerify',
        kind: 'spanEnd',
        spanId: 'schemaVerify',
        outcome: result.ok ? 'ok' : 'error',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'schemaVerify',
        kind: 'spanEnd',
        spanId: 'schemaVerify',
        outcome: 'error',
      });
      throw error;
    }
  }

  async sign(options: SignOptions): Promise<SignDatabaseResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'sign', onProgress);
    const { driver, familyInstance } = await this.ensureConnected();

    // Validate contract using family instance
    let contractIR: ContractIR;
    try {
      contractIR = familyInstance.validateContractIR(options.contractIR);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContractValidationError(message, error);
    }

    // Emit sign span
    onProgress?.({
      action: 'sign',
      kind: 'spanStart',
      spanId: 'sign',
      label: 'Signing database...',
    });

    try {
      // Delegate to family instance sign method
      const result = await familyInstance.sign({
        driver,
        contractIR,
        contractPath: options.contractPath ?? '',
        ...ifDefined('configPath', options.configPath),
      });

      onProgress?.({
        action: 'sign',
        kind: 'spanEnd',
        spanId: 'sign',
        outcome: 'ok',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'sign',
        kind: 'spanEnd',
        spanId: 'sign',
        outcome: 'error',
      });
      throw error;
    }
  }

  async dbInit(options: DbInitOptions): Promise<DbInitResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'dbInit', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    // Check target supports migrations
    if (!this.options.target.migrations) {
      throw new Error(`Target "${this.options.target.targetId}" does not support migrations`);
    }

    // Validate contract using family instance
    let contractIR: ContractIR;
    try {
      contractIR = familyInstance.validateContractIR(options.contractIR);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContractValidationError(message, error);
    }

    // Delegate to extracted dbInit operation
    return executeDbInit({
      driver,
      familyInstance,
      contractIR,
      mode: options.mode,
      migrations: this.options.target.migrations,
      frameworkComponents,
      ...ifDefined('onProgress', onProgress),
    });
  }

  async dbUpdate(options: DbUpdateOptions): Promise<DbUpdateResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'dbUpdate', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    if (!this.options.target.migrations) {
      throw new Error(`Target "${this.options.target.targetId}" does not support migrations`);
    }

    let contractIR: ContractIR;
    try {
      contractIR = familyInstance.validateContractIR(options.contractIR);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ContractValidationError(message, error);
    }

    return executeDbUpdate({
      driver,
      familyInstance,
      contractIR,
      mode: options.mode,
      migrations: this.options.target.migrations,
      frameworkComponents,
      ...ifDefined('acceptDataLoss', options.acceptDataLoss),
      ...ifDefined('onProgress', onProgress),
    });
  }

  async readMarker(): Promise<ContractMarkerRecord | null> {
    const { driver, familyInstance } = await this.ensureConnected();
    return familyInstance.readMarker({ driver });
  }

  async migrationApply(options: MigrationApplyOptions): Promise<MigrationApplyResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'migrationApply', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    if (!this.options.target.migrations) {
      throw new Error(`Target "${this.options.target.targetId}" does not support migrations`);
    }

    return executeMigrationApply({
      driver,
      familyInstance,
      pendingEdges: options.pendingEdges,
      migrations: this.options.target.migrations,
      frameworkComponents,
      targetId: this.options.target.targetId,
      ...(onProgress ? { onProgress } : {}),
    });
  }

  async introspect(options?: IntrospectOptions): Promise<unknown> {
    const onProgress = options?.onProgress;
    await this.connectWithProgress(options?.connection, 'introspect', onProgress);
    const { driver, familyInstance } = await this.ensureConnected();

    // TODO: Pass schema option to familyInstance.introspect when schema filtering is implemented
    const _schema = options?.schema;
    void _schema;

    // Emit introspect span
    onProgress?.({
      action: 'introspect',
      kind: 'spanStart',
      spanId: 'introspect',
      label: 'Introspecting database schema...',
    });

    try {
      const result = await familyInstance.introspect({ driver });

      onProgress?.({
        action: 'introspect',
        kind: 'spanEnd',
        spanId: 'introspect',
        outcome: 'ok',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'introspect',
        kind: 'spanEnd',
        spanId: 'introspect',
        outcome: 'error',
      });
      throw error;
    }
  }

  toSchemaView(schemaIR: unknown): CoreSchemaView | undefined {
    this.init();
    if (this.familyInstance?.toSchemaView) {
      return this.familyInstance.toSchemaView(schemaIR);
    }
    return undefined;
  }

  async emit(options: EmitOptions): Promise<EmitResult> {
    const { onProgress, contractConfig } = options;

    // Ensure initialized (creates stack and family instance)
    // emit() does NOT require a database connection
    this.init();

    if (!this.familyInstance) {
      throw new Error('Family instance was not initialized. This is a bug.');
    }

    let contractRaw: unknown;
    onProgress?.({
      action: 'emit',
      kind: 'spanStart',
      spanId: 'resolveSource',
      label: 'Resolving contract source...',
    });

    try {
      const providerResult = await contractConfig.sourceProvider();
      if (!providerResult.ok) {
        onProgress?.({
          action: 'emit',
          kind: 'spanEnd',
          spanId: 'resolveSource',
          outcome: 'error',
        });

        return notOk({
          code: 'CONTRACT_SOURCE_INVALID',
          summary: providerResult.failure.summary,
          why: providerResult.failure.summary,
          meta: providerResult.failure.meta,
          diagnostics: providerResult.failure,
        });
      }
      contractRaw = providerResult.value;

      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'resolveSource',
        outcome: 'ok',
      });
    } catch (error) {
      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'resolveSource',
        outcome: 'error',
      });

      const message = error instanceof Error ? error.message : String(error);
      return notOk({
        code: 'CONTRACT_SOURCE_INVALID',
        summary: 'Failed to resolve contract source',
        why: message,
        diagnostics: {
          summary: 'Contract source provider threw an exception',
          diagnostics: [
            {
              code: 'PROVIDER_THROW',
              message,
            },
          ],
        },
        meta: undefined,
      });
    }

    // Emit contract
    onProgress?.({
      action: 'emit',
      kind: 'spanStart',
      spanId: 'emit',
      label: 'Emitting contract...',
    });

    try {
      try {
        this.familyInstance.validateContractIR(contractRaw);
      } catch (error) {
        onProgress?.({
          action: 'emit',
          kind: 'spanEnd',
          spanId: 'emit',
          outcome: 'error',
        });
        const message = error instanceof Error ? error.message : String(error);
        return notOk({
          code: 'CONTRACT_VALIDATION_FAILED',
          summary: 'Contract validation failed',
          why: message,
          meta: undefined,
        });
      }

      const emitResult = await this.familyInstance.emitContract({ contractIR: contractRaw });

      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'emit',
        outcome: 'ok',
      });

      return ok({
        storageHash: emitResult.storageHash,
        ...ifDefined('executionHash', emitResult.executionHash),
        profileHash: emitResult.profileHash,
        contractJson: emitResult.contractJson,
        contractDts: emitResult.contractDts,
      });
    } catch (error) {
      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'emit',
        outcome: 'error',
      });

      return notOk({
        code: 'EMIT_FAILED',
        summary: 'Failed to emit contract',
        why: error instanceof Error ? error.message : String(error),
        meta: undefined,
      });
    }
  }
}
