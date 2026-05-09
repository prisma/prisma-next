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

  /**
   * Reads the contract marker for `space` from the database, returning
   * `null` if no marker row exists for that space (or if the marker
   * table itself is missing).
   *
   * `space` is required at every call site so the type system surfaces
   * every place that needs to thread the value: callers in single-app
   * paths pass {@link import('./control-spaces').APP_SPACE_ID}
   * (`'app'`); per-extension callers pass the extension's space id.
   * Defaulting at the family-interface level was a silent bug door —
   * it let multi-space-aware callers forget to pass `space` and
   * collapse onto the app's marker row.
   *
   * Families whose underlying storage doesn't yet support per-space
   * markers (Mongo, today) accept `space` for interface conformance and
   * reject any non-`APP_SPACE_ID` value rather than silently ignoring
   * it; see the family-specific implementation for details.
   */
  readMarker(options: {
    readonly driver: ControlDriverInstance<TFamilyId, string>;
    readonly space: string;
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
