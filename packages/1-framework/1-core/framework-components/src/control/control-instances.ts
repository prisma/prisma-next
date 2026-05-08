import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterInstance,
  DriverInstance,
  ExtensionInstance,
  FamilyInstance,
  TargetBoundComponentDescriptor,
  TargetInstance,
} from '../shared/framework-components';
import type {
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from './control-result-types';

export interface ControlFamilyInstance<TFamilyId extends string, TSchemaIR>
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

  /**
   * Reads every marker row keyed by `space`. Used by the per-space
   * verifier (sub-spec § 4) to detect orphan marker rows and
   * marker-vs-pinned drift. Returns an empty map when the marker
   * table does not yet exist.
   */
  readAllMarkers(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
  }): Promise<ReadonlyMap<string, ContractMarkerRecord>>;

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
