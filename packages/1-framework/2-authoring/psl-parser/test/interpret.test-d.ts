import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceProvider,
} from '@prisma-next/config/config-types';
import { ok } from '@prisma-next/utils/result';
import { expectTypeOf, test } from 'vitest';
import {
  hasPslInterpreter,
  type PslInterpretCapable,
  type PslInterpretInput,
} from '../src/interpret';
import type { SourceFile } from '../src/source-file';
import type { SymbolTable } from '../src/symbol-table';
import type { DocumentAst } from '../src/syntax/ast/declarations';

test('guard narrows the union to expose a fully typed interpret method', () => {
  const source: ContractSourceProvider = {
    sourceFormat: 'psl',
    load: async () => ok({} as never),
  };

  if (hasPslInterpreter(source)) {
    expectTypeOf(source).toExtend<PslInterpretCapable>();
    expectTypeOf(source.interpret).parameters.toEqualTypeOf<
      [PslInterpretInput, ContractSourceContext]
    >();
    expectTypeOf(source.interpret).returns.toEqualTypeOf<readonly ContractSourceDiagnostic[]>();
  }
});

test('interpret input carries the parser artifact vocabulary', () => {
  expectTypeOf<PslInterpretInput['document']>().toEqualTypeOf<DocumentAst>();
  expectTypeOf<PslInterpretInput['sourceFile']>().toEqualTypeOf<SourceFile>();
  expectTypeOf<PslInterpretInput['symbolTable']>().toEqualTypeOf<SymbolTable>();
  expectTypeOf<PslInterpretInput['sourceId']>().toEqualTypeOf<string>();
});

test('capability discriminant is the psl literal', () => {
  expectTypeOf<PslInterpretCapable['sourceFormat']>().toEqualTypeOf<'psl'>();
});
