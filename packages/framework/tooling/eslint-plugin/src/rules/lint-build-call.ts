import type { TSESTree } from '@typescript-eslint/types';
import { ESLintUtils } from '@typescript-eslint/utils';
import {
  type BuilderCall,
  extractCallChain,
  getTypeScriptServices,
  isPrismaNextQueryBuildCall,
} from '../utils';

const DEFAULT_OPTIONS = {
  requireLimit: true,
  maxLimit: 1000,
  requiredFields: [],
};

const SELECT_QUERY_METHODS = ['select', 'from'] as const;

// Types
type MessageIds = 'unboundedQuery' | 'maxLimitExceeded';

interface RuleOptions {
  /** Enforce limit() calls on SELECT queries to prevent unbounded queries */
  requireLimit?: boolean;
  /** Maximum allowed limit value */
  maxLimit?: number;
}

type Options = [RuleOptions];

// Rule implementation
export const lintBuildCall = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'problem',
    docs: {
      description: 'Validate query builder build() calls using TypeScript type information',
    },
    schema: [
      {
        type: 'object',
        properties: {
          requireLimit: {
            type: 'boolean',
            description: 'Enforce limit() calls on SELECT queries',
          },
          maxLimit: {
            type: 'number',
            description: 'Maximum allowed limit value',
            minimum: 1,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unboundedQuery:
        'Query build() call may result in unbounded query. Consider adding .limit() to prevent fetching too many rows.',
      maxLimitExceeded:
        'Query build() call has a limit() value that exceeds the maximum allowed of {{maxLimit}}.',
    },
  },
  defaultOptions: [DEFAULT_OPTIONS],
  create(context, [options]) {
    const services = getTypeScriptServices(context);

    if (!services) {
      throw new Error(
        'TypeScript services are required for lint-build-call rule. Please ensure you are using @typescript-eslint/parser.',
      );
    }

    return {
      CallExpression(node: TSESTree.CallExpression) {
        if (!isPrismaNextQueryBuildCall(node, services)) {
          return;
        }
        lintQuery(node, extractCallChain(node));
      },
    };

    function lintQuery(node: TSESTree.CallExpression, callChain: BuilderCall[]) {
      if (isSelectQuery(callChain)) {
        checkUnboundedQuery(node, callChain);
        checkLimitExceedsMax(node, callChain);
      }
    }

    function isSelectQuery(callChain: BuilderCall[]): boolean {
      return SELECT_QUERY_METHODS.some((method) =>
        callChain.some((call) => call.method === method),
      );
    }

    function checkUnboundedQuery(node: TSESTree.CallExpression, callChain: BuilderCall[]) {
      if (options.requireLimit && !callChain.some((call) => call.method === 'limit')) {
        reportUnboundedQuery(node);
      }
    }

    function checkLimitExceedsMax(node: TSESTree.CallExpression, callChain: BuilderCall[]) {
      if (!options.maxLimit) return;

      const limitArg = callChain.find((call) => call.method === 'limit')?.args.pop();
      const literalValue = limitArg ? extractNumericLiteral(limitArg) : undefined;
      if (literalValue !== undefined && literalValue > options.maxLimit) {
        reportLimitExceeded(node);
      }
    }

    function extractNumericLiteral(
      arg: TSESTree.Expression | TSESTree.SpreadElement,
    ): number | undefined {
      if (arg?.type === 'Literal' && 'value' in arg && typeof arg.value === 'number') {
        return arg.value;
      }
      return;
    }

    function reportUnboundedQuery(node: TSESTree.CallExpression) {
      context.report({
        node,
        messageId: 'unboundedQuery',
      });
    }

    function reportLimitExceeded(node: TSESTree.CallExpression) {
      context.report({
        node,
        messageId: 'maxLimitExceeded',
        data: { maxLimit: options.maxLimit?.toString() ?? 'undefined' },
      });
    }
  },
});
