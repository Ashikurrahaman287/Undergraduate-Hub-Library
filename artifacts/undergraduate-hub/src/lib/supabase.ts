import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

const publicKey = () =>
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY;

export function isSupabaseBrowserConfigured() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && publicKey());
}

export function getSupabaseBrowserClient() {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = publicKey();
  if (!url || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured.');
  }

  client = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}
