# Voice Messages for the Run

A mobile-first single-page web app that lets family, friends, and strangers
leave short voice messages for a runner before their race. Contributors record
directly in the browser with zero account creation. Only the admin (the runner)
can access or download the recordings.

## Stack

| Layer     | Choice                                         |
|-----------|------------------------------------------------|
| Frontend  | Vue 3 (Composition API) + Vite + Tailwind CSS  |
| Storage   | Supabase Storage (write-only anon bucket)      |
| Upload    | tus resumable protocol (byte-level progress)   |
| Hosting   | Vercel (static site, HTTPS enforced)           |
| Backend   | None required                                  |

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Configure Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Create a Storage bucket named `run-messages` (private, 200 MB file limit)
3. Run the SQL migrations in `supabase/migrations/` in the SQL editor:
   - `001_run_messages_table.sql` — metadata table + RLS policies
   - `002_storage_policies.sql` — storage bucket policies

### 3. Environment variables

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

### 4. Run locally

```bash
npm run dev
```

Visit `http://localhost:5173` (HTTPS not required for localhost, but test
microphone access in production where HTTPS is enforced by Vercel).

## Deploy to Vercel

```bash
npx vercel
# or link to Vercel via the dashboard and push to trigger a deploy
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables
in the Vercel project settings.

## Downloading recordings (admin)

**Option A — Supabase Dashboard** (easiest):
1. Open your Supabase project → Storage → `run-messages`
2. Select all files → Download

**Option B — Download script** (for large collections or re-runs):

```bash
# Create .env with your SERVICE ROLE key (never commit this)
echo "SUPABASE_URL=https://your-ref.supabase.co" >> .env
echo "SUPABASE_SERVICE_ROLE_KEY=your-key" >> .env

node scripts/download.js --output ./recordings
```

The script is incremental — re-running it skips files already downloaded.

**Option C — rclone** (for scheduled sync):
Supabase Storage is S3-compatible; configure rclone against it to mirror
the bucket to a local or NAS folder on demand.

## Compilation workflow

Files arrive already sorted chronologically (timestamp prefix in filename).
Import into your editor of choice. To normalize mixed mp4/webm/ogg files
to a single format:

```bash
# Convert everything to wav (or mp3, aac — swap the output extension)
for f in recordings/*; do ffmpeg -i "$f" "normalized/$(basename $f .${f##*.}).wav"; done
```

## Browser support

| Platform           | Browser           | Status     |
|--------------------|-------------------|------------|
| iPhone (iOS 14.3+) | Safari            | ✅ Required |
| iPhone             | Chrome            | ✅          |
| Android            | Chrome            | ✅          |
| Desktop            | Chrome, Edge      | ✅          |
| Desktop            | Firefox           | ✅          |
| Desktop            | Safari 14.1+      | ✅          |
| In-app browsers    | Instagram, FB…    | ⚠️ Banner shown, redirect to Safari/Chrome |
