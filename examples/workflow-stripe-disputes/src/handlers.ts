import type { WorkflowStepHandler } from '@prisma-next/workflows/runtime';
import type { MockDisputeProviders } from './mock-providers';

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function disputeObject(input: unknown): Record<string, unknown> {
  const event = recordValue(input);
  const data = recordValue(event?.['data']);
  return recordValue(data?.['object']) ?? {};
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function createDisputeWorkflowHandlers(
  providers: MockDisputeProviders,
): Record<string, WorkflowStepHandler> {
  return {
    async collectCustomerHistory(context) {
      const dispute = disputeObject(context.input);
      const disputeId = requireString(dispute['id'], 'dispute id');
      const customerId = requireString(dispute['customer'], 'customer id');
      const amount = Number(dispute['amount']);
      const currency = requireString(dispute['currency'], 'currency');
      const reason = requireString(dispute['reason'], 'reason');
      const [hubspotHistory, shopifyOrders, zendeskTickets, stripeMetadata] = await Promise.all([
        providers.hubspot.customerHistory(customerId),
        providers.shopify.orderHistory(customerId),
        providers.zendesk.priorTickets(customerId),
        providers.stripe.paymentMetadata(disputeId),
      ]);

      return {
        disputeId,
        customerId,
        customerEmail: stripeMetadata['receiptEmail'],
        amount,
        currency,
        reason,
        hubspotHistory,
        shopifyOrders,
        zendeskTickets,
        stripeMetadata,
      };
    },

    draftResponse(context) {
      const order = Array.isArray(context.state['shopifyOrders'])
        ? context.state['shopifyOrders'][0]
        : undefined;
      const trackingNumber = recordValue(order)?.['trackingNumber'];
      return {
        draftResponse:
          `The order was fulfilled and delivered with tracking ${String(trackingNumber)}. ` +
          'The customer has no prior disputes and support history shows normal account activity.',
        confidence: 0.91,
      };
    },

    async submitEvidence(context) {
      const disputeId = requireString(context.state['disputeId'], 'dispute id');
      const response = requireString(context.state['draftResponse'], 'draft response');
      const evidence = await providers.stripe.submitEvidence({ disputeId, response });
      return evidence;
    },

    async postSummary(context) {
      const result = await providers.slack.postSummary({
        disputeId: context.state['disputeId'],
        amount: context.state['amount'],
        evidenceId: context.state['evidenceId'],
      });
      return { slackSummary: result };
    },

    learnFromApproval(context) {
      return {
        approvedResponse: context.state['draftResponse'],
        learnedExample: {
          reason: context.state['reason'],
          confidence: context.state['confidence'],
          response: context.state['draftResponse'],
        },
      };
    },
  };
}
