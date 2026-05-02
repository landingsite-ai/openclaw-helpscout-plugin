/**
 * Plugin configuration loaded from openclaw config and environment variables.
 *
 * Config values (plugins.entries.helpscout.config):
 *   - webhookSecret: HelpScout webhook HMAC secret
 *   - helpscoutUserId: Nick's HelpScout user ID for loop prevention
 *   - gatewayPort: Gateway HTTP port (default 18789)
 *   - agentId: Target agent ID (default "hooks")
 *
 * Environment variables (global .env):
 *   - HELPSCOUT_CLIENT_ID: OAuth app client ID
 *   - HELPSCOUT_CLIENT_SECRET: OAuth app client secret
 *   - OPENCLAW_HOOKS_TOKEN: Token for POST to /hooks/agent and /hooks/wake
 *
 * Access tokens are minted on demand via the client_credentials grant — no
 * bootstrap access/refresh tokens to manage.
 */

export interface HelpScoutPluginConfig {
  webhookSecret: string;
  helpscoutUserId: string;
  gatewayPort: number;
  agentId: string;
  helpscoutClientId: string;
  helpscoutClientSecret: string;
  openclawHooksToken: string;
}

export function loadPluginConfig(pluginConfig: Record<string, unknown>): HelpScoutPluginConfig {
  const webhookSecret = pluginConfig.webhookSecret as string;
  const helpscoutUserId = pluginConfig.helpscoutUserId as string;
  const gatewayPort = (pluginConfig.gatewayPort as number) ?? 18789;
  const agentId = (pluginConfig.agentId as string) ?? "hooks";

  if (!webhookSecret) {
    throw new Error("[helpscout] Missing required config: webhookSecret");
  }
  if (!helpscoutUserId) {
    throw new Error("[helpscout] Missing required config: helpscoutUserId");
  }

  const helpscoutClientId = process.env.HELPSCOUT_CLIENT_ID;
  const helpscoutClientSecret = process.env.HELPSCOUT_CLIENT_SECRET;
  const openclawHooksToken = process.env.OPENCLAW_HOOKS_TOKEN;

  if (!helpscoutClientId) {
    throw new Error("[helpscout] Missing required env var: HELPSCOUT_CLIENT_ID");
  }
  if (!helpscoutClientSecret) {
    throw new Error("[helpscout] Missing required env var: HELPSCOUT_CLIENT_SECRET");
  }
  if (!openclawHooksToken) {
    throw new Error("[helpscout] Missing required env var: OPENCLAW_HOOKS_TOKEN");
  }

  return {
    webhookSecret,
    helpscoutUserId,
    gatewayPort,
    agentId,
    helpscoutClientId,
    helpscoutClientSecret,
    openclawHooksToken,
  };
}
