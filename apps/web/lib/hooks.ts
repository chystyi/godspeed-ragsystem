"use client";

import type { KbDocument } from "@kb/shared";
import useSWR from "swr";
import { api } from "./api";
import { ApiRequestError } from "./errors";

/** Retrying a "not found" or "forbidden" answer only wastes requests. */
const options = {
  shouldRetryOnError: (error: unknown) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500),
};


export const PENDING_POLL_MS = 2000;

/** A document that is still being indexed is checked again until its outcome is known. */
export const pollWhilePending = (doc: KbDocument | undefined) => (doc?.indexingStatus === "pending" ? PENDING_POLL_MS : 0);

const anyPending = (list: { indexingStatus: string }[] | undefined) =>
  list?.some((doc) => doc.indexingStatus === "pending") ? PENDING_POLL_MS : 0;

export const useDocuments = () => useSWR("documents", api.listDocuments, { ...options, refreshInterval: anyPending });

export const useDocument = (id: string | null) =>
  useSWR(id ? ["document", id] : null, () => api.getDocument(id as string), { ...options, refreshInterval: pollWhilePending });

export const useConversations = () => useSWR("conversations", api.listConversations, options);

export const useConversation = (id: string | null) =>
  useSWR(id ? ["conversation", id] : null, () => api.getConversation(id as string), options);

export const useModels = () => useSWR("models", api.listModels, { ...options, revalidateOnFocus: false });
