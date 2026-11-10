import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No shared response cache: authenticated agreement/financial data stays private.
export default defineCloudflareConfig();
