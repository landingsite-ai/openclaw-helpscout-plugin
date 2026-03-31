/**
 * HelpScout tool registration for OpenClaw.
 *
 * Registers typed tools that the agent can call to interact with HelpScout:
 * get conversation, search, send reply, update status, list inboxes.
 */

import { Type } from "@sinclair/typebox";
import type { HelpScoutClient } from "./helpscout-client.js";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface PluginApi {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
  }): void;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerHelpscoutTools(api: PluginApi, client: HelpScoutClient): void {
  // -- helpscout_list_inboxes --------------------------------------------------

  api.registerTool({
    name: "helpscout_list_inboxes",
    description: "Lists all HelpScout mailboxes/inboxes.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const mailboxes = await client.listMailboxes();
        return ok(mailboxes);
      } catch (error) {
        return err(error);
      }
    },
  });

  // -- helpscout_search_conversations ------------------------------------------

  api.registerTool({
    name: "helpscout_search_conversations",
    description: `Searches for conversations in HelpScout. Returns up to 25 conversations per request. Use helpscout_get_conversation to retrieve full conversation details including all message threads.

IMPORTANT: Prefer using URL parameters for filtering when possible. Use the query parameter only for advanced searches that require boolean operators or fields not available as URL parameters.

URL PARAMETERS (preferred for simple filtering):
- embed: Load sub-entities. Example: embed=threads
- mailbox: Filter by inbox ID(s). Example: mailbox=123 or mailbox=123,567
- status: Filter by status (defaults to active). Values: active, all, closed, open, pending, spam
- tag: Filter by tag(s). Example: tag=red or tag=red,blue
- assigned_to: Filter by assignee user ID
- modifiedSince: Filter conversations modified after timestamp (ISO format)
- number: Look up by conversation number
- sortField: Sort by field (createdAt, modifiedAt, number, status, subject, etc.)
- sortOrder: Sort direction (asc, desc). Default: desc
- page: Page number for pagination

QUERY PARAMETER (for advanced searches):
Query syntax: (field:"value")
Available fields: subject, tag, mailbox, mailboxid, modifiedAt, createdAt, email, body, number, status
Operators: AND (default), OR, NOT
Examples: (subject:"payment" OR body:"payment"), (modifiedAt:[NOW-7DAYS TO *])`,
    parameters: Type.Object({
      embed: Type.Optional(Type.Union([Type.Literal("threads")])),
      mailbox: Type.Optional(Type.String()),
      folder: Type.Optional(Type.Number()),
      status: Type.Optional(
        Type.Union([
          Type.Literal("active"),
          Type.Literal("all"),
          Type.Literal("closed"),
          Type.Literal("open"),
          Type.Literal("pending"),
          Type.Literal("spam"),
        ]),
      ),
      tag: Type.Optional(Type.String()),
      assigned_to: Type.Optional(Type.Number()),
      modifiedSince: Type.Optional(Type.String()),
      number: Type.Optional(Type.Number()),
      sortField: Type.Optional(
        Type.Union([
          Type.Literal("createdAt"),
          Type.Literal("customerEmail"),
          Type.Literal("customerName"),
          Type.Literal("mailboxid"),
          Type.Literal("modifiedAt"),
          Type.Literal("number"),
          Type.Literal("score"),
          Type.Literal("status"),
          Type.Literal("subject"),
          Type.Literal("waitingSince"),
        ]),
      ),
      sortOrder: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
      query: Type.Optional(Type.String()),
      page: Type.Optional(Type.Number()),
      customFieldsByIds: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      try {
        const result = await client.searchConversations({
          embed: params.embed as "threads" | undefined,
          mailbox: params.mailbox as string | undefined,
          folder: params.folder as number | undefined,
          status: params.status as "active" | "all" | "closed" | "open" | "pending" | "spam" | undefined,
          tag: params.tag as string | undefined,
          assigned_to: params.assigned_to as number | undefined,
          modifiedSince: params.modifiedSince as string | undefined,
          number: params.number as number | undefined,
          sortField: params.sortField as string | undefined,
          sortOrder: params.sortOrder as "asc" | "desc" | undefined,
          query: params.query as string | undefined,
          page: params.page as number | undefined,
          customFieldsByIds: params.customFieldsByIds as string | undefined,
        } as Record<string, unknown>);
        return ok(result);
      } catch (error) {
        return err(error);
      }
    },
  });

  // -- helpscout_get_conversation ----------------------------------------------

  api.registerTool({
    name: "helpscout_get_conversation",
    description: `Gets a specific HelpScout conversation including all message threads (full conversation history).

Accepts either:
- Conversation ID: The internal numeric ID (typically a large number)
- Ticket Number: The user-facing ticket number (e.g., #11409)

If the provided number doesn't match a conversation ID, automatically searches for it as a ticket number.

Returns the conversation metadata and all threads (messages) in chronological order.`,
    parameters: Type.Object({
      conversationId: Type.Number({
        description:
          "The conversation ID or ticket number. If lookup by ID fails, will automatically search by ticket number.",
      }),
    }),
    execute: async (_id, params) => {
      const conversationId = params.conversationId as number;
      try {
        // First try direct lookup by conversation ID
        try {
          const result = await client.getConversationWithThreads(conversationId);
          return ok(result);
        } catch {
          // Direct lookup failed — try searching by ticket number
          api.logger.info("[helpscout] Direct lookup failed, trying ticket number search", {
            conversationId,
          });

          const searchResult = await client.searchConversations({
            number: conversationId,
            status: "all",
          });

          if (searchResult.conversations.length === 0) {
            return ok({
              error: `No conversation found with ID or ticket number: ${conversationId}`,
            });
          }

          const result = await client.getConversationWithThreads(
            searchResult.conversations[0].id,
          );
          return ok({
            note: `Found by ticket number #${conversationId} (conversation ID: ${searchResult.conversations[0].id})`,
            ...result,
          });
        }
      } catch (error) {
        return err(error);
      }
    },
  });

  // -- helpscout_send_reply ----------------------------------------------------

  api.registerTool({
    name: "helpscout_send_reply",
    description: `Creates a reply or internal note on a HelpScout conversation.

TYPE:
- 'reply' (default): Customer-facing message sent via email. Supports draft mode.
- 'note': Internal note visible only to agents. Does NOT support draft mode.

DRAFT MODE (replies only):
Defaults to draft=true for safety. Set draft=false to send immediately.

STATUS GUIDANCE:
- 'closed': Reply resolves the issue (default)
- 'pending': Waiting for the customer to respond
- 'active': Ticket needs further agent attention`,
    parameters: Type.Object({
      conversationId: Type.Number({ description: "The ID of the conversation to reply to" }),
      text: Type.String({ description: "The reply or note text/message" }),
      type: Type.Optional(
        Type.Union([Type.Literal("note"), Type.Literal("reply")], {
          description: "Type: 'reply' (customer-facing, supports drafts) or 'note' (internal). Default: 'reply'",
        }),
      ),
      draft: Type.Optional(
        Type.Boolean({
          description:
            "For replies only: if true, saves as draft without sending. Default: true. Ignored for notes.",
        }),
      ),
      ignoreDraft: Type.Optional(
        Type.Boolean({
          description:
            "For replies only: if true, allows sending even if unsent draft(s) exist. Default: false.",
        }),
      ),
      status: Type.Optional(
        Type.Union(
          [Type.Literal("active"), Type.Literal("pending"), Type.Literal("closed")],
          { description: "Status to set. 'closed' if resolved, 'pending' if waiting, 'active' if needs work. Default: 'closed'" },
        ),
      ),
    }),
    execute: async (_id, params) => {
      try {
        const conversationId = params.conversationId as number;
        const text = params.text as string;
        const type = (params.type as "reply" | "note" | undefined) ?? "reply";
        const isDraft = params.draft !== false; // Default to true for safety
        const ignoreDraft = (params.ignoreDraft as boolean | undefined) ?? false;
        const status = (params.status as "active" | "pending" | "closed" | undefined) ?? "closed";

        await client.createReply({
          conversationId,
          text,
          type,
          status,
          draft: isDraft,
          ignoreDraft,
        });

        const action = isDraft ? "Draft created" : "Reply sent";
        return ok({
          success: true,
          message: isDraft
            ? `Draft reply saved in HelpScout for conversation #${conversationId}. Review and send it from HelpScout, or call this tool again with draft=false to send immediately.`
            : `Reply sent successfully to conversation #${conversationId}`,
          conversationId,
          draft: isDraft,
        });
      } catch (error) {
        return err(error);
      }
    },
  });

  // -- helpscout_update_status -------------------------------------------------

  api.registerTool({
    name: "helpscout_update_status",
    description: `Updates the status of a HelpScout conversation without sending a reply or note.

STATUS OPTIONS:
- 'closed': Mark as resolved/complete
- 'pending': Waiting for customer response
- 'active': Needs agent attention
- 'open': Reopened/in progress
- 'spam': Mark as spam`,
    parameters: Type.Object({
      conversationId: Type.Number({ description: "The ID of the conversation to update" }),
      status: Type.Union(
        [
          Type.Literal("active"),
          Type.Literal("closed"),
          Type.Literal("open"),
          Type.Literal("pending"),
          Type.Literal("spam"),
        ],
        { description: "The new status for the conversation" },
      ),
    }),
    execute: async (_id, params) => {
      try {
        const conversationId = params.conversationId as number;
        const status = params.status as "active" | "closed" | "open" | "pending" | "spam";

        await client.updateConversationStatus(conversationId, status);

        return ok({
          success: true,
          message: `Conversation #${conversationId} status updated to '${status}'`,
          conversationId,
          status,
        });
      } catch (error) {
        return err(error);
      }
    },
  });

  api.logger.info("Registered 5 HelpScout tools");
}
