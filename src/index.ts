import { join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadPluginConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import { HelpScoutClient } from "./helpscout-client.js";
import { registerHelpscoutTools } from "./tools.js";
import { registerWebhookRoute } from "./webhook.js";

export default definePluginEntry({
  id: "helpscout",
  name: "HelpScout",
  description: "Receives HelpScout webhooks and provides tools for conversation management",

  register(api) {
    const config = loadPluginConfig(api.pluginConfig);

    // Token store: mints access tokens on demand via client_credentials grant
    const stateDir = api.runtime.state.resolveStateDir(process.env);
    const tokenStore = new TokenStore(stateDir, {
      clientId: config.helpscoutClientId,
      clientSecret: config.helpscoutClientSecret,
    });

    // API client
    const client = new HelpScoutClient(tokenStore, api.logger);

    // Register tools (get conversation, search, reply, update status, list inboxes, download attachment)
    const attachmentsDir = join(stateDir, "attachments");
    registerHelpscoutTools(api, client, attachmentsDir);

    // Register webhook HTTP route
    registerWebhookRoute(api, config);

    api.logger.info("HelpScout plugin registered", {
      gatewayPort: config.gatewayPort,
      agentId: config.agentId,
      webhookRoute: "/helpscout/webhook",
    });
  },
});
