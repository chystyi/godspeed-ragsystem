/** Types shared by the API and the web app. Single source of truth for the contract. */

export interface KbDocument {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentInput {
  title: string;
  content: string;
  tags?: string[];
}

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}
