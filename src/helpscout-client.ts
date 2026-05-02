import { TokenStore } from "./token-store.js";
import type {
  HelpScoutInbox,
  HelpScoutConversation,
  HelpScoutThread,
  CreateReplyParams,
  SearchConversationsParams,
  SearchConversationsResult,
} from "./types.js";

const HELPSCOUT_API_BASE = "https://api.helpscout.net/v2";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export class HelpScoutClient {
  constructor(
    private tokenStore: TokenStore,
    private logger: Logger,
  ) {}

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false,
  ): Promise<T> {
    const token = await this.tokenStore.getAccessToken(this.logger);

    const response = await fetch(`${HELPSCOUT_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // On 401, mint a new token and retry once
    if (response.status === 401 && !isRetry) {
      this.logger.info("[helpscout] Got 401, minting fresh access token");
      this.tokenStore.invalidate();
      return this.request<T>(endpoint, options, true);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HelpScout API error: ${response.status} - ${errorText}`);
    }

    // Some endpoints return 201/204 with no body
    const contentLength = response.headers.get("content-length");
    if (contentLength === "0" || response.status === 201 || response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  async listMailboxes(): Promise<HelpScoutInbox[]> {
    this.logger.info("[helpscout] Listing mailboxes");
    const data = await this.request<{ _embedded: { mailboxes: HelpScoutInbox[] } }>(
      "/mailboxes",
    );
    return data._embedded.mailboxes;
  }

  async searchConversations(
    searchParams: SearchConversationsParams,
  ): Promise<SearchConversationsResult> {
    this.logger.info("[helpscout] Searching conversations", searchParams);

    const params = new URLSearchParams();
    if (searchParams.embed) params.append("embed", searchParams.embed);
    if (searchParams.mailbox) params.append("mailbox", searchParams.mailbox);
    if (searchParams.folder) params.append("folder", searchParams.folder.toString());
    if (searchParams.status) params.append("status", searchParams.status);
    if (searchParams.tag) params.append("tag", searchParams.tag);
    if (searchParams.assigned_to) params.append("assigned_to", searchParams.assigned_to.toString());
    if (searchParams.modifiedSince) params.append("modifiedSince", searchParams.modifiedSince);
    if (searchParams.number) params.append("number", searchParams.number.toString());
    if (searchParams.sortField) params.append("sortField", searchParams.sortField);
    if (searchParams.sortOrder) params.append("sortOrder", searchParams.sortOrder);
    if (searchParams.query) params.append("query", searchParams.query);
    if (searchParams.page) params.append("page", searchParams.page.toString());
    if (searchParams.customFieldsByIds) params.append("customFieldsByIds", searchParams.customFieldsByIds);

    const url = `/conversations?${params.toString()}`;

    const data = await this.request<{
      _embedded: { conversations: HelpScoutConversation[] };
      page: { size: number; totalElements: number; totalPages: number; number: number };
    }>(url);

    return {
      conversations: data._embedded?.conversations || [],
      page: data.page,
    };
  }

  async getConversation(conversationId: number): Promise<HelpScoutConversation> {
    return this.request<HelpScoutConversation>(`/conversations/${conversationId}`);
  }

  async getConversationThreads(conversationId: number): Promise<HelpScoutThread[]> {
    const data = await this.request<{ _embedded: { threads: HelpScoutThread[] } }>(
      `/conversations/${conversationId}/threads`,
    );
    return data._embedded.threads || [];
  }

  async getConversationWithThreads(
    conversationId: number,
  ): Promise<{ conversation: HelpScoutConversation; threads: HelpScoutThread[] }> {
    this.logger.info("[helpscout] Getting conversation with threads", { conversationId });

    const [conversation, threads] = await Promise.all([
      this.getConversation(conversationId),
      this.getConversationThreads(conversationId),
    ]);

    return { conversation, threads };
  }

  async createReply(params: CreateReplyParams): Promise<void> {
    const {
      conversationId,
      text,
      type = "reply",
      status = "closed",
      draft = false,
      ignoreDraft = false,
    } = params;

    this.logger.info("[helpscout] Creating thread", {
      conversationId,
      type,
      status,
      draft,
      textLength: text.length,
    });

    // Check for existing drafts (only for replies, not notes)
    if (type === "reply") {
      const threads = await this.getConversationThreads(conversationId);
      const existingDrafts = threads.filter((t) => t.state === "draft");

      if (existingDrafts.length > 0 && !ignoreDraft) {
        const action = draft ? "create another draft" : "send this reply";
        throw new Error(
          `This conversation has ${existingDrafts.length} unsent draft(s). Review the draft(s) in HelpScout or set ignoreDraft=true to ${action} anyway.`,
        );
      }
    }

    if (type === "note") {
      // Notes: POST /conversations/{id}/notes — no customer, no draft support
      const payload: { text: string; status?: string } = { text };
      if (status) payload.status = status;

      await this.request(`/conversations/${conversationId}/notes`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      // Replies: POST /conversations/{id}/reply — requires customer
      const conversation = await this.getConversation(conversationId);
      if (!conversation.primaryCustomer?.id) {
        throw new Error("Conversation primary customer ID not found");
      }

      const payload: {
        text: string;
        draft: boolean;
        customer: { id: number };
        status?: string;
      } = {
        text,
        draft,
        customer: { id: conversation.primaryCustomer.id },
      };

      // Only include status if not a draft (HelpScout API requirement)
      if (!draft) {
        payload.status = status;
      }

      await this.request(`/conversations/${conversationId}/reply`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  }

  async getAttachmentData(attachmentId: number): Promise<string> {
    this.logger.info("[helpscout] Downloading attachment", { attachmentId });
    const data = await this.request<{ data: string }>(
      `/attachments/${attachmentId}/data`,
    );
    if (!data.data) {
      throw new Error(`Attachment ${attachmentId} returned no data`);
    }
    return data.data;
  }

  async updateConversationStatus(
    conversationId: number,
    status: "active" | "closed" | "open" | "pending" | "spam",
  ): Promise<void> {
    this.logger.info("[helpscout] Updating conversation status", { conversationId, status });

    // HelpScout uses JSONPatch format (single object, not array)
    await this.request(`/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ op: "replace", path: "/status", value: status }),
    });
  }
}
