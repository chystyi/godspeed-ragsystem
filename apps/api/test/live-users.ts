import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface LiveUser {
  id: string;
  email: string;
  accessToken: string;
  client: SupabaseClient;
}

/** Throw-away users in the real Supabase project, removed again by `cleanup`. */
export class LiveUsers {
  readonly admin: SupabaseClient;
  private readonly ids: string[] = [];
  // Unique per instance: spec files run in parallel and must not collide on e-mail addresses.
  private readonly run = randomUUID().slice(0, 8);
  private readonly password = `Pw-${randomUUID()}-aA1!`;

  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    serviceKey: string,
  ) {
    this.admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  async signUp(name: string): Promise<LiveUser> {
    const email = `live-${name}-${this.run}@example.test`;
    const created = await this.admin.auth.admin.createUser({
      email,
      password: this.password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    this.ids.push(created.data.user.id);
    const client = createClient(this.url, this.anonKey, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password: this.password });
    if (signedIn.error) throw signedIn.error;
    return {
      id: created.data.user.id,
      email,
      accessToken: signedIn.data.session.access_token,
      client,
    };
  }

  async cleanup(): Promise<void> {
    for (const id of this.ids) await this.admin.auth.admin.deleteUser(id);
  }
}
