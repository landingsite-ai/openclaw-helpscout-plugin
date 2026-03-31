/**
 * HelpScout webhook HTTP route.
 *
 * Receives HelpScout webhook events, verifies HMAC-SHA1 signatures,
 * deduplicates events, and routes them to the appropriate handler
 * (agent session via /hooks/agent, wake via /hooks/wake, or drop).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HelpScoutPluginConfig } from "./config.js";
import { DedupCache } from "./dedup.js";

// Event type constants
const AGENT_EVENTS = new Set([
  "convo.created",
  "convo.customer.reply.created",
]);

const WAKE_EVENTS = new Set([
  "convo.status",
  "convo.assigned",
  "convo.note.created",
  "convo.tags",
  "convo.moved",
]);

const DROP_EVENTS = new Set([
  "convo.deleted",
  "convo.merged",
]);

const AGENT_REPLY_EVENT = "convo.agent.reply.created";

interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

interface PluginApi {
  logger: Logger;
  registerHttpRoute(route: {
    path: string;
    auth: string;
    match: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  }): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the full request body as a Buffer. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Verify the HMAC-SHA1 signature from HelpScout. */
function verifySignature(
  rawBody: Buffer,
  secret: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("base64");
  // Constant-time comparison via buffer equality
  if (expected.length !== signature.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fire-and-forget POST to a local gateway endpoint. */
function postToGateway(
  url: string,
  body: Record<string, unknown>,
  token: string,
  logger: Logger,
): void {
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    logger.error("Failed to POST to gateway", { url, error: String(err) });
  });
}

/** Send a JSON response and return true (handled). */
function json(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): boolean {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
  return true;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const dedup = new DedupCache();

export function registerWebhookRoute(
  api: PluginApi,
  config: HelpScoutPluginConfig,
): void {
  const baseUrl = `http://127.0.0.1:${config.gatewayPort}`;

  api.registerHttpRoute({
    path: "/helpscout/webhook",
    auth: "plugin",
    match: "exact",
    handler: async (req, res) => {
      // -- Read raw body -----------------------------------------------
      const rawBody = await readBody(req);

      // -- Signature verification --------------------------------------
      const signature = req.headers["x-helpscout-signature"] as
        | string
        | undefined;
      if (!verifySignature(rawBody, config.webhookSecret, signature)) {
        api.logger.warn("Webhook signature verification failed");
        return json(res, 401, { error: "Invalid signature" });
      }

      // -- Parse event type & body -------------------------------------
      const eventType = req.headers["x-helpscout-event"] as string | undefined;
      if (!eventType) {
        api.logger.warn("Webhook missing X-HelpScout-Event header");
        return json(res, 400, { error: "Missing event type" });
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody.toString("utf-8"));
      } catch {
        api.logger.warn("Webhook body is not valid JSON");
        return json(res, 400, { error: "Invalid JSON" });
      }

      const conversationId = String(body.id ?? "unknown");

      api.logger.info("Webhook received", { eventType, conversationId });

      // -- Deduplication -----------------------------------------------
      const dedupKey = `${eventType}:${conversationId}`;
      if (dedup.has(dedupKey)) {
        api.logger.info("Webhook deduplicated", { dedupKey });
        return json(res, 200, { status: "duplicate" });
      }
      dedup.add(dedupKey);

      // -- Event routing -----------------------------------------------

      // Agent events → POST /hooks/agent
      if (AGENT_EVENTS.has(eventType)) {
        postToGateway(
          `${baseUrl}/hooks/agent`,
          {
            message: `HelpScout event: ${eventType} | Conversation #${conversationId} | Use the helpdesk skill to handle this.`,
            name: "HelpScout",
            agentId: config.agentId,
          },
          config.openclawHooksToken,
          api.logger,
        );
        return json(res, 200, { status: "dispatched", route: "agent" });
      }

      // Agent reply → loop prevention or wake
      if (eventType === AGENT_REPLY_EVENT) {
        // Extract the acting user's ID from the thread's createdBy field
        const createdById = getCreatedById(body);
        if (createdById && String(createdById) === config.helpscoutUserId) {
          api.logger.info("Dropping self-originated agent reply (loop prevention)", {
            conversationId,
            userId: createdById,
          });
          return json(res, 200, { status: "dropped", reason: "self-reply" });
        }

        // Another agent replied — wake
        postToGateway(
          `${baseUrl}/hooks/wake`,
          {
            text: `HelpScout: ${eventType} on conversation #${conversationId}`,
            mode: "next-heartbeat",
          },
          config.openclawHooksToken,
          api.logger,
        );
        return json(res, 200, { status: "dispatched", route: "wake" });
      }

      // Wake events → POST /hooks/wake
      if (WAKE_EVENTS.has(eventType)) {
        postToGateway(
          `${baseUrl}/hooks/wake`,
          {
            text: `HelpScout: ${eventType} on conversation #${conversationId}`,
            mode: "next-heartbeat",
          },
          config.openclawHooksToken,
          api.logger,
        );
        return json(res, 200, { status: "dispatched", route: "wake" });
      }

      // Drop events
      if (DROP_EVENTS.has(eventType)) {
        api.logger.info("Dropping event (no action needed)", { eventType, conversationId });
        return json(res, 200, { status: "dropped", reason: "no-action" });
      }

      // Unknown event type — log and accept
      api.logger.warn("Unknown webhook event type", { eventType, conversationId });
      return json(res, 200, { status: "ignored" });
    },
  });

  api.logger.info("Registered webhook route at /helpscout/webhook");
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

/**
 * Extract the createdBy.id from the webhook payload.
 * HelpScout webhook payloads for thread events include thread data
 * with a createdBy object containing the user's ID.
 */
function getCreatedById(body: Record<string, unknown>): string | undefined {
  // Direct createdBy at top level (thread payload)
  const createdBy = body.createdBy as Record<string, unknown> | undefined;
  if (createdBy?.id) return String(createdBy.id);

  // Nested under _embedded.threads[0].createdBy
  const embedded = body._embedded as Record<string, unknown> | undefined;
  if (embedded?.threads) {
    const threads = embedded.threads as Array<Record<string, unknown>>;
    if (threads.length > 0) {
      const threadCreatedBy = threads[0].createdBy as
        | Record<string, unknown>
        | undefined;
      if (threadCreatedBy?.id) return String(threadCreatedBy.id);
    }
  }

  return undefined;
}
