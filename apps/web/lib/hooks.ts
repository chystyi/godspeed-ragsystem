"use client";

import useSWR from "swr";
import { api } from "./api";
import { ApiRequestError } from "./errors";

/** Retrying a "not found" or "forbidden" answer only wastes requests. */
const options = {
  shouldRetryOnError: (error: unknown) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500),
};

export const useDocuments = () => useSWR("documents", api.listDocuments, options);

export const useDocument = (id: string | null) =>
  useSWR(id ? ["document", id] : null, () => api.getDocument(id as string), options);

export const useConversations = () => useSWR("conversations", api.listConversations, options);

export const useConversation = (id: string | null) =>
  useSWR(id ? ["conversation", id] : null, () => api.getConversation(id as string), options);
