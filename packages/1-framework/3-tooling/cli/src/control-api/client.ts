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
 * Generic parameters are inferred from the descriptors you pass in,
 * so no type casts are needed.
 *
 * @example
 * ```typescript
 * import { createControlClient } from '@prisma-next/cli/control-api';
 * import sql from '@prisma-next/family-sql/control';
 * import postgres from '@prisma-next/target-postgres/control';
 * import postgresAdapter from '@prisma-next/adapter-postgres/control';
 * import postgresDriver from '@prisma-next/driver-postgres/control';
 *
 * const client = createControlClient({
 *   family: sql,
 *   target: postgres,
 *   adapter: postgresAdapter,
 *   driver: postgresDriver,
 *   extensionPacks: [],
 * });
 *
 * try {
 *   await client.connect(databaseUrl);
 *   const verifyResult = await client.verify({ contractIR });
 *   const initResult = await client.dbInit({ contractIR, mode: 'apply' });
 * } finally {
 *   await client.close();
 * }
 * ```
 */
export function createControlClient(options: ControlClientOptions): ControlClient {
  return new ControlClientImpl(options);
}

/**
 * Implementation of ControlClient.
 * Manages connection state and delegates operations to family instance.
 */
class ControlClientImpl implements ControlClient {
  private readonly options: ControlClientOptions;
  private readonly stack: ControlPlaneStack<string, string>;
  private driver: ControlDriverInstance<string, string> | null = null;
  private familyInstance: ControlFamilyInstance<string> | null = null;
  private frameworkComponents: ReadonlyArray<
    TargetBoundComponentDescriptor<string, string>
  > | null = null;

  constructor(options: ControlClientOptions) {
    this.options = options;
    // Create the control plane stack at construction time
    this.stack = createControlPlaneStack({
      target: options.target,
      adapter: options.adapter,
      driver: options.driver,
      extensionPacks: options.extensionPacks,
    });
  }

  async connect(url: string): Promise<void> {
    if (this.driver) {
      throw new Error('Already connected. Call close() before reconnecting.');
    }

    // Check for driver descriptor
    if (!this.stack.driver) {
      throw new Error(
        'Driver is not configured. Pass a driver descriptor when creating the control client to enable database operations.',
      );
    }

    // Create driver instance
    this.driver = await this.stack.driver.create(url);

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
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.familyInstance = null;
      this.frameworkComponents = null;
    }
  }

  private ensureConnected(): {
    driver: ControlDriverInstance<string, string>;
    familyInstance: ControlFamilyInstance<string>;
    frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>;
  } {
    if (!this.driver || !this.familyInstance || !this.frameworkComponents) {
      throw new Error('Not connected. Call connect() first.');
    }
    return {
      driver: this.driver,
      familyInstance: this.familyInstance,
      frameworkComponents: this.frameworkComponents,
    };
  }

  async verify(options: VerifyOptions): Promise<VerifyDatabaseResult> {
    const { driver, familyInstance } = this.ensureConnected();

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
    const { driver, familyInstance, frameworkComponents } = this.ensureConnected();

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
    const { driver, familyInstance } = this.ensureConnected();

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
    const { driver, familyInstance, frameworkComponents } = this.ensureConnected();

    // Check target supports migrations
    if (!this.options.target.migrations) {
      throw new Error(`Target "${this.options.target.id}" does not support migrations`);
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
    });
  }

  async introspect(options?: IntrospectOptions): Promise<unknown> {
    const { driver, familyInstance } = this.ensureConnected();

    // Delegate to family instance introspect method
    // Note: The schema option is not currently used by the family instance introspect,
    // but we accept it for future compatibility
    void options?.schema;

    return familyInstance.introspect({ driver });
  }
}
