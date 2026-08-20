import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://kknwnvtqmyncaotbrryv.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_Wl5rWwaVSzdrWeg0Y4Rr_A_AqP_bLV-';

export const createClient = (cookieStore?: {
  getAll: () => Array<{ name: string; value: string }>;
  set?: (name: string, value: string, options?: any) => void;
}) => {
  return createSupabaseClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        persistSession: false,
      },
    }
  );
};
