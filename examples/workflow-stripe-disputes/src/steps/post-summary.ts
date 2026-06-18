import { createDisputeWorkflowHandlers } from '../handlers';
import { createMockDisputeProviders } from '../mock-providers';

const handlers = createDisputeWorkflowHandlers(createMockDisputeProviders());
const handler = handlers['postSummary'];
if (!handler) {
  throw new Error('Missing postSummary workflow handler.');
}

export default handler;
