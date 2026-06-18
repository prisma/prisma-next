import { createDisputeWorkflowHandlers } from '../handlers';
import { createMockDisputeProviders } from '../mock-providers';

const handlers = createDisputeWorkflowHandlers(createMockDisputeProviders());
const handler = handlers['draftResponse'];
if (!handler) {
  throw new Error('Missing draftResponse workflow handler.');
}

export default handler;
