/** An error answered by the API (or a failure to reach it). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Text for the person using the app; never shows internal codes or details. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "Something went wrong. Please try again.";
  const wait = error.retryAfterSeconds;
  switch (error.code) {
    case "network":
      return "Cannot reach the server. Check your connection and try again.";
    case "unauthorized":
      return "Your session has expired. Please sign in again.";
    case "too_many_requests":
      return wait ? `You are asking too fast. Try again in ${wait} seconds.` : "You are asking too fast. Try again shortly.";
    case "ai_rate_limited":
      return "The AI service is busy right now. Try again in a moment.";
    case "ai_unavailable":
      return "The AI service is not available right now. Try again in a moment.";
    case "ai_error":
      return "The AI service could not answer this time. Try again.";
    case "payload_too_large":
      return "This is too large to send.";
    case "validation_error":
      return "Please check the entered values.";
    case "document_not_found":
      return "This document no longer exists.";
    case "conversation_not_found":
      return "This conversation no longer exists.";
    default:
      return "Something went wrong. Please try again.";
  }
}
