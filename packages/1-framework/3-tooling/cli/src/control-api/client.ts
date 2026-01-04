import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlPlaneStack,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import { executeDbInit } from './operations/db-init';
import type {
  ControlClient,
  ControlClientOptions,
  DbInitOptions,
  DbInitResult,
  IntrospectOptions,
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

  async verify(options: VerifyOptions): Promise<VerifyDatabaseResult> {
    const { driver, familyInstance } = await this.ensureConnected();

    // Validate contract using family instance
    const contractIR = familyInstance.validateContractIR(options.contractIR);

    // Delegate to family instance verify method
    // Note: We pass empty strings for contractPath/configPath since the programmatic
    // API doesn't deal with file paths. The family instance accepts these as optional
    // metadata for error reporting.
    return familyInstance.verify({
      driver,
      contractIR,
      expectedTargetId: this.options.target.targetId,
      contractPath: '',
    });
  }

  async schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult> {
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    // Validate contract using family instance
    const contractIR = familyInstance.validateContractIR(options.contractIR);

    // Delegate to family instance schemaVerify method
    return familyInstance.schemaVerify({
      driver,
      contractIR,
      strict: options.strict ?? false,
      contractPath: '',
      frameworkComponents,
    });
  }

  async sign(options: SignOptions): Promise<SignDatabaseResult> {
    const { driver, familyInstance } = await this.ensureConnected();

    // Validate contract using family instance
    const contractIR = familyInstance.validateContractIR(options.contractIR);

    // Delegate to family instance sign method
    return familyInstance.sign({
      driver,
      contractIR,
      contractPath: '',
    });
  }

  async dbInit(options: DbInitOptions): Promise<DbInitResult> {
    const { onProgress } = options;

    // Connect with progress span if connection provided
    if (options.connection !== undefined) {
      onProgress?.({
        action: 'dbInit',
        kind: 'spanStart',
        spanId: 'connect',
        label: 'Connecting to database...',
      });
      try {
        await this.connect(options.connection);
        onProgress?.({
          action: 'dbInit',
          kind: 'spanEnd',
          spanId: 'connect',
          outcome: 'ok',
        });
      } catch (error) {
        onProgress?.({
          action: 'dbInit',
          kind: 'spanEnd',
          spanId: 'connect',
          outcome: 'error',
        });
        throw error;
      }
    }

    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    // Check target supports migrations
    if (!this.options.target.migrations) {
      throw new Error(`Target "${this.options.target.targetId}" does not support migrations`);
    }

    // Validate contract using family instance
    const contractIR = familyInstance.validateContractIR(options.contractIR);

    // Delegate to extracted dbInit operation
    return executeDbInit({
      driver,
      familyInstance,
      contractIR,
      mode: options.mode,
      migrations: this.options.target.migrations,
      frameworkComponents,
      ...(onProgress ? { onProgress } : {}),
    });
  }

  async introspect(options?: IntrospectOptions): Promise<unknown> {
    const { driver, familyInstance } = await this.ensureConnected();

    // TODO: Pass schema option to familyInstance.introspect when schema filtering is implemented
    const _schema = options?.schema;
    void _schema;

    return familyInstance.introspect({ driver });
  }
}
