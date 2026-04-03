import type { TargetFamilyHook } from '@prisma-next/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionInstance,
  ControlFamilyInstance,
  ControlTargetInstance,
} from './control-instances';
import type { ControlStack } from './control-stack';
import type {
  AdapterDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  TargetDescriptor,
} from './framework-components';

export interface ControlPlaneStack<TFamilyId extends string, TTargetId extends string> {
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
}

export interface ControlFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId> = ControlFamilyInstance<TFamilyId>,
> extends FamilyDescriptor<TFamilyId> {
  readonly hook: TargetFamilyHook;
  create<TTargetId extends string>(
    stack: ControlPlaneStack<TFamilyId, TTargetId>,
    controlStack?: ControlStack,
  ): TFamilyInstance;
}

export interface ControlTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends ControlTargetInstance<TFamilyId, TTargetId> = ControlTargetInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  create(): TTargetInstance;
}

export interface ControlAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends ControlAdapterInstance<TFamilyId, TTargetId> = ControlAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends AdapterDescriptor<TFamilyId, TTargetId> {
  create(): TAdapterInstance;
}

export interface ControlDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends ControlDriverInstance<TFamilyId, TTargetId> = ControlDriverInstance<
    TFamilyId,
    TTargetId
  >,
  TConnection = string,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  create(connection: TConnection): Promise<TDriverInstance>;
}

export interface ControlExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends ControlExtensionInstance<
    TFamilyId,
    TTargetId
  > = ControlExtensionInstance<TFamilyId, TTargetId>,
> extends ExtensionDescriptor<TFamilyId, TTargetId> {
  create(): TExtensionInstance;
}
