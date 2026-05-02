# HelpScout Plugin Setup

## 1. Install the plugin

From GitHub (production):

```bash
openclaw plugins install git:github.com/landingsite-ai/openclaw-helpscout-plugin
# pin to a ref:
# openclaw plugins install git:github.com/landingsite-ai/openclaw-helpscout-plugin@main
```

From a local checkout (development — `--link` keeps your edits live):

```bash
openclaw plugins install --link /path/to/openclaw-helpscout-plugin
```

Update later with `openclaw plugins update helpscout`, list with `openclaw plugins list`, remove with `openclaw plugins uninstall helpscout`.

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

## 4. Expose the gateway with Tailscale Funnel

Funnel gives the gateway a stable public HTTPS URL. Hookdeck (next step) delivers webhooks to this URL.

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:18789
```

Replace `18789` with your `gatewayPort`. The `--bg` form writes the mapping into Tailscale's persistent state, so `tailscaled` restores it on reboot — run this once.

Verify it's live:

```bash
tailscale funnel status                                       # shows the persisted mapping
curl -i https://<machine>.<tailnet>.ts.net/helpscout/webhook  # expect 401 (signature missing)
```

A 401 from `curl` means the route is reachable end-to-end and the plugin is rejecting the request because no `X-HelpScout-Signature` header was provided — exactly what should happen.

## 5. Configure Hookdeck

Hookdeck queues and replays webhooks if the gateway is offline.

1. Create a **source** for HelpScout in Hookdeck
2. Create a **destination** pointing to the Funnel URL + `/helpscout/webhook`
   - Example: `https://<machine>.<tailnet>.ts.net/helpscout/webhook`
3. Ensure the destination forwards the original headers (`X-HelpScout-Signature`, `X-HelpScout-Event`) and the raw request body — the plugin verifies HMAC against the unmodified body
4. Connect the source to the destination

## 6. Configure HelpScout Webhook

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

## 7. Remove old MCP/cron setup

- Remove the `helpscout` entry from `config/mcporter.json`
- Delete `scripts/refresh-helpscout-token.sh`
- Disable the `helpscout-ticket-check` cron job
- Keep `memory/handled-tickets.json` (ticket tracking state is still used by the helpdesk skill)

## 8. Restart the gateway

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
| `helpscout_download_attachment` | Download an attachment to the plugin state dir; returns the local path |

## Event Routing

| HelpScout Event | Plugin Action |
|----------------|---------------|
| `convo.created` | Spawns isolated agent session |
| `convo.customer.reply.created` | Spawns isolated agent session |
| `convo.agent.reply.created` (from Nick) | Dropped (loop prevention) |
| `convo.agent.reply.created` (from others) | Wake notification |
| `convo.status`, `convo.assigned`, `convo.note.created`, `convo.tags`, `convo.moved` | Wake notification |
| `convo.deleted`, `convo.merged` | Logged and dropped |
