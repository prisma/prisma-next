import type { WorkflowStepHandler } from '@prisma-next/workflows/runtime';
import type { MockOnboardingProviders } from './mock-providers';

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function eventRecord(input: unknown): Record<string, unknown> {
  const record = recordValue(input);
  if (!record) {
    throw new Error('account.created payload must be an object');
  }
  return record;
}

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`${field} is required`);
  }
  return value;
}

export function createOnboardingWorkflowHandlers(
  providers: MockOnboardingProviders,
): Record<string, WorkflowStepHandler> {
  return {
    async enrichAccount(context) {
      const event = eventRecord(context.input);
      const accountId = stringField(event, 'accountId');
      const companyDomain = stringField(event, 'companyDomain');
      const [crmAccount, billingProfile, identitySignals] = await Promise.all([
        providers.crm.findAccount(companyDomain),
        providers.billing.profile(accountId),
        providers.identity.signals(companyDomain),
      ]);
      return {
        accountId,
        companyDomain,
        crmAccount,
        billingProfile,
        identitySignals,
      };
    },

    scoreRisk(context) {
      const billing = recordValue(context.state['billingProfile']) ?? {};
      const identity = recordValue(context.state['identitySignals']) ?? {};
      const highValue = Number(billing['annualContractValue'] ?? 0) > 100000;
      const seatSpike = identity['seatRequestSpike'] === true;
      return {
        riskScore: highValue && seatSpike ? 0.82 : 0.24,
        provisioningPlan: {
          seats: highValue ? 250 : 25,
          requiresSalesOps: highValue && seatSpike,
        },
      };
    },

    async provisionWorkspace(context) {
      const accountId = String(context.state['accountId']);
      return {
        workspace: await providers.provisioning.createWorkspace(accountId),
      };
    },

    async notifyTeam(context) {
      const slackMessage = await providers.slack.post({
        accountId: context.state['accountId'],
        riskScore: context.state['riskScore'],
        workspace: context.state['workspace'],
      });
      return { slackMessage };
    },
  };
}
