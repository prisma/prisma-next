import type { SerializeContract } from '@prisma-next/contract/hashing';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';

/**
 * The subset of ControlStack that emit() reads.
 * All fields are optional so tests can pass minimal objects.
 * A full ControlStack satisfies this via structural typing.
 */
export interface EmitStackInput {
  readonly codecTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly queryOperationTypeImports?: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds?: ReadonlyArray<string>;
  readonly codecLookup?: CodecLookup;
}

export interface EmitOptions {
  readonly outputJsonPath?: string;
  /**
   * Per-target serializer that converts the in-memory contract into its
   * canonical on-disk JsonObject shape before the framework's
   * key-ordering / default-omission walk runs. Threaded from the
   * descriptor (`descriptor.contractSerializer.serializeContract`) at
   * the CLI / control-API call site so target classes can decide what
   * appears in the JSON envelope rather than the framework guessing
   * via property enumerability. Optional for back-compat with test
   * call sites that emit JSON-clean contracts and don't need a hook.
   */
  readonly serializeContract?: SerializeContract;
}

export interface EmitResult {
  readonly contractJson: string;
  readonly contractDts: string;
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}
