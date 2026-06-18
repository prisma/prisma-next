import type { WorkflowStepHandler } from '../runtime/engine';

export interface MockDisputeProviderData {
  readonly hubspotCustomers?: Record<string, unknown>;
  readonly shopifyOrders?: Record<string, readonly unknown[]>;
  readonly zendeskTickets?: Record<string, readonly unknown[]>;
  readonly stripeMetadata?: Record<string, unknown>;
}

export function createMockDisputeConnectors(
  data: MockDisputeProviderData = {},
): Record<string, WorkflowStepHandler> {
  return {
    loadCustomer: ({ state }) => {
      const customerId = String(state['customerId'] ?? state['customer'] ?? 'cus_demo');
      return {
        customerId,
        customerHistory: data.hubspotCustomers?.[customerId] ?? {
          lifetimeValue: 1240,
          plan: 'pro',
          health: 'good',
        },
      };
    },
    loadOrderHistory: ({ state }) => {
      const customerId = String(state['customerId'] ?? 'cus_demo');
      return {
        orderHistory: data.shopifyOrders?.[customerId] ?? [
          { id: 'ord_1001', total: 18900, status: 'fulfilled' },
          { id: 'ord_1002', total: 24500, status: 'fulfilled' },
        ],
      };
    },
    loadPriorTickets: ({ state }) => {
      const customerId = String(state['customerId'] ?? 'cus_demo');
      return {
        priorTickets: data.zendeskTickets?.[customerId] ?? [
          { id: 'zd_1', sentiment: 'positive', summary: 'Asked about shipping ETA' },
        ],
      };
    },
    loadPaymentMetadata: ({ state }) => {
      const disputeId = String(state['disputeId'] ?? state['id'] ?? 'dp_demo');
      return {
        paymentMetadata: data.stripeMetadata?.[disputeId] ?? {
          chargeId: 'ch_demo',
          riskLevel: 'normal',
          receiptEmail: 'customer@example.com',
        },
      };
    },
    draftEvidence: ({ state }) => ({
      confidence: Number(state['confidence'] ?? 0.91),
      draftedResponse:
        'Customer history, fulfilled orders, prior support context, and payment metadata support submitting evidence.',
    }),
    submitEvidence: ({ state }) => ({
      submittedEvidenceId: `evidence_${String(state['disputeId'] ?? 'demo')}`,
      disputeStatus: 'evidence_submitted',
    }),
    postSlackSummary: ({ state }) => ({
      slackMessageId: `slack_${String(state['disputeId'] ?? 'demo')}`,
    }),
    learnFromApprovedResponse: ({ state }) => ({
      learnedResponseId: `learned_${String(state['disputeId'] ?? 'demo')}`,
    }),
  };
}

export function stripeDisputeCreatedFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_dispute_created',
    disputeId: 'dp_123',
    customerId: 'cus_demo',
    amount: 750,
    currency: 'usd',
    reason: 'fraudulent',
    ...overrides,
  };
}
