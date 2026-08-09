import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[voice-app] Missing Supabase env vars. ' +
    'Copy .env.example to .env.local and fill in your project values.'
  )
}

/** Anon-key client. Never ship the service role key to the browser. */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const BUCKET       = 'run-messages'
export const TUS_ENDPOINT = `${supabaseUrl}/storage/v1/upload/resumable`
