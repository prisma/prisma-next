import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import { executeDbInit } from './operations/db-init';
import type {
  ControlClientOptions,
  DbInitOptions,
  DbInitResult,
  IntrospectOptions,
  PrismaNextControlClient,
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
 * @example
 * ```typescript
 * import { createPrismaNextControlClient } from '@prisma-next/cli/control-api';
 * import sql from '@prisma-next/family-sql/control';
 * import postgres from '@prisma-next/target-postgres/control';
 * import postgresAdapter from '@prisma-next/adapter-postgres/control';
 * import postgresDriver from '@prisma-next/driver-postgres/control';
 *
 * const client = createPrismaNextControlClient({
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
export function createPrismaNextControlClient(
  options: ControlClientOptions,
): PrismaNextControlClient {
  return new PrismaNextControlClientImpl(options);
}

/**
 * Implementation of PrismaNextControlClient.
 * Manages connection state and delegates operations to family instance.
 */
class PrismaNextControlClientImpl implements PrismaNextControlClient {
  readonly options: ControlClientOptions;
  driver: ControlDriverInstance<string, string> | null = null;
  familyInstance: ControlFamilyInstance<string> | null = null;
  private frameworkComponents: ReadonlyArray<
    TargetBoundComponentDescriptor<string, string>
  > | null = null;

  constructor(options: ControlClientOptions) {
    this.options = options;
  }

  async connect(url: string): Promise<void> {
    if (this.driver) {
      throw new Error('Already connected. Call close() before reconnecting.');
    }

    // Create driver instance
    this.driver = await this.options.driver.create(url);

    // Create family instance
    this.familyInstance = this.options.family.create({
      target: this.options.target,
      adapter: this.options.adapter,
      driver: this.options.driver,
      extensions: this.options.extensionPacks ?? [],
    });

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
    const contractIR = familyInstance.validateContractIR(options.contractIR) as ContractIR;

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
