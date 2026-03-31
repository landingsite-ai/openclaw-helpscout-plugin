import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "helpscout",
  name: "HelpScout",
  description: "Receives HelpScout webhooks and provides tools for conversation management",

  register(api) {
    api.logger.info("HelpScout plugin registering");

    // Units 2-5 will populate this with:
    // - Config validation
    // - HelpScout API tools (registerTool)
    // - Webhook HTTP route (registerHttpRoute)
  },
});
