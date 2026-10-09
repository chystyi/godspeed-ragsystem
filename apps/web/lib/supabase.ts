import { createClient } from "@supabase/supabase-js";

/**
 * Browser client for sign-in only. Data requests go through our API with the session's
 * access token, so the browser never talks to the database tables directly.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
);
