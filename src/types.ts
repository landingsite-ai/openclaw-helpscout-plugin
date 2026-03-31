export interface HelpScoutInbox {
  id: number;
  name: string;
  slug: string;
  email: string;
  type: string;
  mailboxesCount?: number;
  conversationCount?: number;
}

export interface HelpScoutConversation {
  id: number;
  number: number;
  subject: string;
  preview: string;
  status: string;
  type: string;
  mailboxId: number;
  createdAt: string;
  updatedAt?: string;
  primaryCustomer: {
    id: number;
    email: string;
    first?: string;
    last?: string;
    type: string;
    photoUrl?: string;
  };
}

export interface HelpScoutAttachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface HelpScoutThread {
  id: number;
  type: string;
  status: string;
  state: "draft" | "hidden" | "published" | "review";
  createdBy: {
    id: number;
    type: string;
    email?: string;
  };
  body: string;
  createdAt: string;
  attachments?: HelpScoutAttachment[];
}

export interface CreateReplyParams {
  conversationId: number;
  text: string;
  type?: "note" | "reply";
  status?: "active" | "pending" | "closed";
  draft?: boolean;
  ignoreDraft?: boolean;
}

export interface SearchConversationsParams {
  embed?: "threads";
  mailbox?: string;
  folder?: number;
  status?: "active" | "all" | "closed" | "open" | "pending" | "spam";
  tag?: string;
  assigned_to?: number;
  modifiedSince?: string;
  number?: number;
  sortField?:
    | "createdAt"
    | "customerEmail"
    | "customerName"
    | "mailboxid"
    | "modifiedAt"
    | "number"
    | "score"
    | "status"
    | "subject"
    | "waitingSince";
  sortOrder?: "asc" | "desc";
  query?: string;
  page?: number;
  customFieldsByIds?: string;
}

export interface PaginationInfo {
  size: number;
  totalElements: number;
  totalPages: number;
  number: number;
}

export interface SearchConversationsResult {
  conversations: HelpScoutConversation[];
  page: PaginationInfo;
}
