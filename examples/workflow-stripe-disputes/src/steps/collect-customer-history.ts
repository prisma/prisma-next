import { createDisputeWorkflowHandlers } from '../handlers';
import { createMockDisputeProviders } from '../mock-providers';

const handlers = createDisputeWorkflowHandlers(createMockDisputeProviders());
const handler = handlers['collectCustomerHistory'];
if (!handler) {
  throw new Error('Missing collectCustomerHistory workflow handler.');
}

export default handler;
