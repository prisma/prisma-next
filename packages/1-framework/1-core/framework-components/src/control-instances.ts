import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from './control-result-types';
import type {
  AdapterInstance,
  DriverInstance,
  ExtensionInstance,
  FamilyInstance,
  TargetBoundComponentDescriptor,
  TargetInstance,
} from './framework-components';

export interface ControlFamilyInstance<TFamilyId extends string, TSchemaIR = unknown>
  extends FamilyInstance<TFamilyId> {
  validateContract(contractJson: unknown): Contract;

  verify(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  schemaVerify(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, string>>;
  }): Promise<VerifyDatabaseSchemaResult>;

  sign(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  readMarker(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
  }): Promise<ContractMarkerRecord | null>;

  introspect(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly contract?: unknown;
  }): Promise<TSchemaIR>;
}

export interface ControlTargetInstance<TFamilyId extends string, TTargetId extends string>
  extends TargetInstance<TFamilyId, TTargetId> {}

export interface ControlAdapterInstance<TFamilyId extends string, TTargetId extends string>
  extends AdapterInstance<TFamilyId, TTargetId> {}

export interface ControlDriverInstance<TFamilyId extends string, TTargetId extends string>
  extends DriverInstance<TFamilyId, TTargetId> {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
}

export interface ControlExtensionInstance<TFamilyId extends string, TTargetId extends string>
  extends ExtensionInstance<TFamilyId, TTargetId> {}
