#!/usr/bin/env node
/**
 * Admin download script — downloads all voice recordings from the
 * run-messages Supabase Storage bucket to a local folder.
 *
 * Usage:
 *   node scripts/download.js [--output ./recordings]
 *
 * Requirements:
 *   - Create a .env file in the project root (gitignored) with:
 *       SUPABASE_URL=https://your-project-ref.supabase.co
 *       SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
 *   - npm install @supabase/supabase-js dotenv
 *
 * Security:
 *   The SERVICE ROLE key bypasses RLS — never put it in the browser bundle
 *   or commit it to git. This script is local-only.
 *
 * Behaviour:
 *   - Lists all objects in the run-messages bucket
 *   - Downloads each file to --output (default: ./recordings)
 *   - Skips files that already exist locally (re-runs are incremental)
 *   - Files arrive sorted by filename = chronologically (timestamp prefix)
 */

import { createClient } from '@supabase/supabase-js'
import { config }       from 'dotenv'
import { writeFile, mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const SUPABASE_URL             = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET                   = 'run-messages'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}

const outputArg  = process.argv.indexOf('--output')
const outputDir  = outputArg !== -1 ? process.argv[outputArg + 1] : join(__dirname, '..', 'recordings')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function fileExists(path) {
  try { await access(path); return true } catch { return false }
}

async function listAllObjects() {
  const objects = []
  let offset    = 0
  const limit   = 100
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    if (!data || data.length === 0) break
    objects.push(...data.filter(o => o.name))
    if (data.length < limit) break
    offset += limit
  }
  return objects
}

async function run() {
  console.log(`Downloading from bucket: ${BUCKET}`)
  console.log(`Output directory: ${outputDir}\n`)

  await mkdir(outputDir, { recursive: true })

  let objects
  try {
    objects = await listAllObjects()
  } catch (err) {
    console.error('Failed to list objects:', err.message)
    process.exit(1)
  }

  if (objects.length === 0) {
    console.log('No recordings found in the bucket.')
    return
  }

  console.log(`Found ${objects.length} recording(s)\n`)

  let downloaded = 0
  let skipped    = 0
  let failed     = 0

  for (const obj of objects) {
    const localPath = join(outputDir, obj.name)

    if (await fileExists(localPath)) {
      console.log(`  SKIP  ${obj.name}`)
      skipped++
      continue
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(obj.name)

    if (error || !data) {
      console.error(`  FAIL  ${obj.name}: ${error?.message}`)
      failed++
      continue
    }

    const buffer = Buffer.from(await data.arrayBuffer())
    await writeFile(localPath, buffer)
    console.log(`  OK    ${obj.name}  (${(buffer.length / 1024).toFixed(0)} KB)`)
    downloaded++
  }

  console.log(`\nDone — ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`)
}

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
