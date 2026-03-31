# HelpScout Plugin Setup

## 1. Install the plugin

```bash
openclaw plugins install /path/to/openclaw-helpscout-plugin
# or when published:
# openclaw plugins install @landingsite/openclaw-helpscout
```

## 2. Add environment variables to global `.env`

Add to `~/.openclaw/.env`:

```bash
# HelpScout OAuth credentials
HELPSCOUT_CLIENT_ID=your_client_id
HELPSCOUT_CLIENT_SECRET=your_client_secret
HELPSCOUT_ACCESS_TOKEN=your_initial_access_token
HELPSCOUT_REFRESH_TOKEN=your_initial_refresh_token

# HelpScout webhook secret (from HelpScout UI: Manage > Apps > Webhooks)
HELPSCOUT_WEBHOOK_SECRET=your_webhook_secret

# OpenClaw gateway hooks token (already set if hooks are enabled)
OPENCLAW_HOOKS_TOKEN=your_hooks_token
```

The access and refresh tokens are bootstrap values from the current OAuth session. After the first token refresh, the plugin persists new tokens to its state directory automatically.

## 3. Configure the plugin in gateway config

Add to your OpenClaw config:

```json5
{
  hooks: {
    enabled: true,
    token: "your_hooks_token"  // same as OPENCLAW_HOOKS_TOKEN
  },
  plugins: {
    entries: {
      "helpscout": {
        config: {
          webhookSecret: "${HELPSCOUT_WEBHOOK_SECRET}",
          helpscoutUserId: "12345",  // Nick's HelpScout user ID
          gatewayPort: 18789,        // default, adjust if different
          agentId: "hooks"           // default, adjust if different
        }
      }
    }
  }
}
```

## 4. Configure Hookdeck

1. Create a **source** for HelpScout in Hookdeck
2. Create a **destination** pointing to your gateway URL + `/helpscout/webhook`
   - Example: `https://your-tunnel.example.com/helpscout/webhook`
3. Connect the source to the destination

## 5. Configure HelpScout Webhook

1. Go to **Manage > Apps > Webhooks** in HelpScout
2. Set the **URL** to your Hookdeck source endpoint
3. Set the **Secret Key** to the same value as `HELPSCOUT_WEBHOOK_SECRET`
4. Select all conversation events:
   - `convo.created`
   - `convo.customer.reply.created`
   - `convo.agent.reply.created`
   - `convo.note.created`
   - `convo.status`
   - `convo.assigned`
   - `convo.deleted`
   - `convo.merged`
   - `convo.moved`
   - `convo.tags`

## 6. Remove old MCP/cron setup

- Remove the `helpscout` entry from `config/mcporter.json`
- Delete `scripts/refresh-helpscout-token.sh`
- Disable the `helpscout-ticket-check` cron job
- Keep `memory/handled-tickets.json` (ticket tracking state is still used by the helpdesk skill)

## 7. Restart the gateway

```bash
openclaw gateway restart
```

## Available Tools

Once installed, the following tools are available to the agent:

| Tool | Description |
|------|-------------|
| `helpscout_get_conversation` | Get conversation + all threads (supports ticket number fallback) |
| `helpscout_search_conversations` | Advanced search with 13 filter parameters |
| `helpscout_send_reply` | Create reply or internal note (defaults to draft=true) |
| `helpscout_update_status` | Update conversation status |
| `helpscout_list_inboxes` | List all mailboxes |

## Event Routing

| HelpScout Event | Plugin Action |
|----------------|---------------|
| `convo.created` | Spawns isolated agent session |
| `convo.customer.reply.created` | Spawns isolated agent session |
| `convo.agent.reply.created` (from Nick) | Dropped (loop prevention) |
| `convo.agent.reply.created` (from others) | Wake notification |
| `convo.status`, `convo.assigned`, `convo.note.created`, `convo.tags`, `convo.moved` | Wake notification |
| `convo.deleted`, `convo.merged` | Logged and dropped |
