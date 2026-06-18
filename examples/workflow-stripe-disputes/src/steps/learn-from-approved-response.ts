import { createDisputeWorkflowHandlers } from '../handlers';
import { createMockDisputeProviders } from '../mock-providers';

const handlers = createDisputeWorkflowHandlers(createMockDisputeProviders());
const handler = handlers['learnFromApproval'];
if (!handler) {
  throw new Error('Missing learnFromApproval workflow handler.');
}

export default handler;
