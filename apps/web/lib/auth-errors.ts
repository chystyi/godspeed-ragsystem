/** Sign-in and sign-up problems in plain words (Supabase messages are technical). */
export function describeAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (text.includes("email not confirmed")) {
    return "Please confirm your email first. Check your inbox for the link.";
  }
  if (text.includes("password") && (text.includes("least") || text.includes("weak") || text.includes("short"))) {
    return "Choose a longer password (at least 8 characters).";
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (text.includes("validate email") || text.includes("invalid email") || text.includes("valid email")) {
    return "Enter a valid email address.";
  }
  if (text.includes("fetch") || text.includes("network")) return "Cannot reach the server. Check your connection.";
  return "That did not work. Please try again.";
}
