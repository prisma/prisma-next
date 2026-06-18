import { createDisputeWorkflowHandlers } from '../handlers';
import { createMockDisputeProviders } from '../mock-providers';

const handlers = createDisputeWorkflowHandlers(createMockDisputeProviders());
const handler = handlers['submitEvidence'];
if (!handler) {
  throw new Error('Missing submitEvidence workflow handler.');
}

export default handler;
