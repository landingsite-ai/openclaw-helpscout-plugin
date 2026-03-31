import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadPluginConfig } from "./config.js";

export default definePluginEntry({
  id: "helpscout",
  name: "HelpScout",
  description: "Receives HelpScout webhooks and provides tools for conversation management",

  register(api) {
    const config = loadPluginConfig(api.pluginConfig);
    api.logger.info("HelpScout plugin loaded", {
      gatewayPort: config.gatewayPort,
      agentId: config.agentId,
    });

    // Unit 3-4: HelpScout API tools will be registered here
    // Unit 5: Webhook HTTP route will be registered here
  },
});
