import type { TSESTree } from '@typescript-eslint/types';
import type { ParserServices } from '@typescript-eslint/utils';
import { ESLintUtils } from '@typescript-eslint/utils';
import type * as ts from 'typescript';

const PRISMA_NEXT_SQL_PACKAGES = ['@prisma-next/sql-lane', 'packages/sql/lanes/sql-lane'] as const;

const PLAN_TYPE_PATTERNS = [/^SqlQueryPlan$/] as const;

export type BuilderCall = { method: string; args: TSESTree.CallExpressionArgument[] };

// Types
export interface TypeScriptServices {
  program: ts.Program;
  checker: ts.TypeChecker;
  esTreeNodeToTSNodeMap: ParserServices['esTreeNodeToTSNodeMap'];
  tsNodeToESTreeNodeMap: ParserServices['tsNodeToESTreeNodeMap'];
}

/**
 * Get TypeScript services from ESLint context
 */
export function getTypeScriptServices(
  context: Parameters<typeof ESLintUtils.getParserServices>[0],
): TypeScriptServices | null {
  try {
    const parserServices = ESLintUtils.getParserServices(context, false);

    if (!parserServices?.program) {
      return null;
    }

    return {
      program: parserServices.program,
      checker: parserServices.program.getTypeChecker(),
      esTreeNodeToTSNodeMap: parserServices.esTreeNodeToTSNodeMap,
      tsNodeToESTreeNodeMap: parserServices.tsNodeToESTreeNodeMap,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a call expression is a method call with a specific name
 */
export function isMethodCall(node: TSESTree.CallExpression, methodName: string): boolean {
  return (
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === methodName
  );
}

/**
 * Check if a call expression is a query builder build() call
 * Uses type information to verify it's actually our query builder's build method
 */
export function isPrismaNextQueryBuildCall(
  node: TSESTree.CallExpression,
  services?: TypeScriptServices | null,
): boolean {
  if (!isMethodCall(node, 'build') || node.arguments.length > 1 || !services) {
    return false;
  }

  if (node.callee.type !== 'MemberExpression') {
    return false;
  }

  const objectType = getTypeOfNode(node.callee.object, services);
  if (!objectType) {
    return false;
  }

  if (!isTypeFromPackages(objectType, PRISMA_NEXT_SQL_PACKAGES)) {
    return false;
  }

  const returnType = getTypeOfNode(node, services);
  return returnType ? isPrismaNextQueryPlanType(returnType) : false;
}

/**
 * Get the TypeScript type of an ESTree node
 */
export function getTypeOfNode(node: TSESTree.Node, services: TypeScriptServices): ts.Type | null {
  try {
    const tsNode = services.esTreeNodeToTSNodeMap.get(node);
    return tsNode ? services.checker.getTypeAtLocation(tsNode) : null;
  } catch {
    return null;
  }
}

/**
 * Check if a type has a specific property
 */
export function typeHasProperty(
  type: ts.Type,
  propertyName: string,
  checker: ts.TypeChecker,
): boolean {
  try {
    const properties = checker.getPropertiesOfType(type);
    return properties.some((prop) => prop.getName() === propertyName);
  } catch {
    return false;
  }
}

/**
 * Check if type is a Prisma Next query plan type by name and origin
 */
export function isPrismaNextQueryPlanType(type: ts.Type): boolean {
  return PLAN_TYPE_PATTERNS.some((pattern) => pattern.test(type.symbol.name));
}

/**
 * Extract call chain from a call expression
 * Returns array of method names called in sequence
 */
export function extractCallChain(node: TSESTree.CallExpression): BuilderCall[] {
  const chain: BuilderCall[] = [];

  function traverse(current: TSESTree.Node): void {
    switch (current.type) {
      case 'CallExpression':
        if (current.callee.type === 'MemberExpression') {
          traverse(current.callee.object);
          if (current.callee.property.type === 'Identifier') {
            chain.push({ method: current.callee.property.name, args: current.arguments });
          }
        }
        break;

      case 'MemberExpression':
        traverse(current.object);
        break;

      case 'Identifier':
        break;
    }
  }

  traverse(node);
  return chain;
}

/**
 * Helper to check if a type originates from specific packages
 */
function isTypeFromPackages(type: ts.Type, packages: readonly string[]): boolean {
  const fileName = type.getSymbol()?.valueDeclaration?.getSourceFile().fileName;
  return fileName ? packages.some((pkg) => fileName.includes(`${pkg}/`)) : false;
}
