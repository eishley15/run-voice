<template>
  <div class="admin-shell">

    <!-- ── PASSWORD GATE ──────────────────────────────────────────────────── -->
    <div v-if="!unlocked" class="gate-wrap">
      <div class="gate-card">
        <div class="gate-icon-wrap" aria-hidden="true">
          <LockKeyhole :size="22" :stroke-width="1.5" />
        </div>
        <div class="gate-text">
          <h1 class="gate-title">Voice Messages</h1>
          <p class="gate-sub">Runner admin access</p>
        </div>

        <form class="gate-form" @submit.prevent="tryUnlock">
          <div class="field-wrap" :class="{ 'field-wrap--error': wrongPassword }">
            <input
              ref="passwordField"
              v-model="passwordInput"
              type="password"
              class="field-input"
              placeholder="Password"
              autocomplete="current-password"
              @input="wrongPassword = false"
            />
          </div>
          <p v-if="wrongPassword" class="field-error" role="alert">
            Incorrect password — try again.
          </p>
          <button type="submit" class="btn btn--primary btn--full">
            Unlock
          </button>
        </form>
      </div>
    </div>

    <!-- ── DASHBOARD ──────────────────────────────────────────────────────── -->
    <template v-else>

      <header class="admin-header">
        <div class="header-inner">
          <div class="header-brand">
            <h1 class="admin-title">Voice Messages</h1>
            <p class="admin-sub">
              <template v-if="loading">Loading recordings…</template>
              <template v-else-if="error">Failed to load</template>
              <template v-else-if="recordings.length === 0">No recordings yet</template>
              <template v-else>{{ recordings.length }} recording{{ recordings.length !== 1 ? 's' : '' }}</template>
            </p>
          </div>

          <button
            v-if="!loading && recordings.length > 0"
            class="btn btn--primary btn--icon-left"
            :disabled="downloadingAll"
            @click="downloadAll"
          >
            <Loader2 v-if="downloadingAll" :size="15" :stroke-width="2" class="icon-spin" />
            <DownloadCloud v-else :size="15" :stroke-width="2" />
            <span>{{ downloadingAll ? `${dlProgress} of ${recordings.length}` : 'Download all' }}</span>
          </button>
        </div>
      </header>

      <main class="admin-main">

        <!-- Inline player -->
        <Transition name="player">
          <div v-if="playingId" class="player-bar">
            <div class="player-meta">
              <span class="player-name">{{ playingRec?.display_name || 'Anonymous' }}</span>
            </div>
            <audio
              ref="audioEl"
              controls
              class="player-audio"
              :src="playingUrl"
              @ended="closePlayer"
            />
            <button class="player-close" aria-label="Close player" @click="closePlayer">
              <X :size="15" :stroke-width="2" />
            </button>
          </div>
        </Transition>

        <!-- Loading skeletons -->
        <div v-if="loading" class="recordings-list" aria-busy="true" aria-label="Loading recordings">
          <div v-for="n in 4" :key="n" class="recording-row">
            <div class="rec-info">
              <div class="skel skel--name" />
              <div class="skel skel--meta" />
            </div>
            <div class="rec-actions">
              <div class="skel skel--btn" />
              <div class="skel skel--btn" />
            </div>
          </div>
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="empty-state">
          <div class="empty-icon-wrap" aria-hidden="true">
            <WifiOff :size="24" :stroke-width="1.5" />
          </div>
          <p class="empty-title">Could not load recordings</p>
          <p class="empty-body">{{ error }}</p>
          <button class="btn btn--primary" @click="loadRecordings">
            <RefreshCw :size="14" :stroke-width="2" />
            Try again
          </button>
        </div>

        <!-- Empty state -->
        <div v-else-if="recordings.length === 0" class="empty-state">
          <div class="empty-icon-wrap" aria-hidden="true">
            <Mic :size="24" :stroke-width="1.5" />
          </div>
          <p class="empty-title">No recordings yet</p>
          <p class="empty-body">Messages will appear here once contributors start recording.</p>
        </div>

        <!-- Recording list -->
        <div v-else class="recordings-list" role="list" aria-label="Voice recordings">
          <div
            v-for="rec in recordings"
            :key="rec.id"
            class="recording-row"
            :class="{ 'recording-row--playing': playingId === rec.id }"
            role="listitem"
          >
            <div class="rec-info">
              <span class="rec-name">{{ rec.display_name || 'Anonymous' }}</span>
              <span class="rec-meta">
                {{ formatDuration(rec.duration_seconds) }}
                <span class="meta-dot" aria-hidden="true" />
                {{ formatDate(rec.created_at) }}
                <template v-if="rec.size_kb">
                  <span class="meta-dot" aria-hidden="true" />
                  {{ rec.size_kb }} KB
                </template>
              </span>
            </div>

            <div class="rec-actions">
              <button
                class="btn btn--ghost btn--sm btn--icon-left"
                :class="{ 'btn--active': playingId === rec.id }"
                :aria-label="playingId === rec.id
                  ? `Stop playing message from ${rec.display_name || 'Anonymous'}`
                  : `Play message from ${rec.display_name || 'Anonymous'}`"
                :disabled="rec.loadingPlay"
                @click="togglePlay(rec)"
              >
                <Loader2 v-if="rec.loadingPlay" :size="14" :stroke-width="2" class="icon-spin" />
                <Square   v-else-if="playingId === rec.id" :size="14" :stroke-width="2" fill="currentColor" />
                <Play     v-else :size="14" :stroke-width="2" fill="currentColor" />
                <span>{{ playingId === rec.id ? 'Stop' : 'Play' }}</span>
              </button>

              <button
                class="btn btn--ghost btn--sm btn--icon-left"
                :aria-label="`Save message from ${rec.display_name || 'Anonymous'}`"
                :disabled="rec.downloading"
                @click="downloadOne(rec)"
              >
                <Loader2  v-if="rec.downloading" :size="14" :stroke-width="2" class="icon-spin" />
                <Download v-else :size="14" :stroke-width="2" />
                <span>{{ rec.downloading ? 'Saving…' : 'Save' }}</span>
              </button>

              <button
                class="btn btn--ghost btn--sm btn--icon-left btn--danger"
                :aria-label="`Delete message from ${rec.display_name || 'Anonymous'}`"
                :disabled="rec.deleting"
                @click="deleteOne(rec)"
              >
                <Loader2 v-if="rec.deleting" :size="14" :stroke-width="2" class="icon-spin" />
                <Trash2  v-else :size="14" :stroke-width="2" />
                <span>{{ rec.deleting ? 'Deleting…' : 'Delete' }}</span>
              </button>
            </div>
          </div>
        </div>

      </main>
    </template>

  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import {
  LockKeyhole,
  DownloadCloud,
  Download,
  Play,
  Square,
  X,
  Mic,
  WifiOff,
  RefreshCw,
  Loader2,
  Trash2,
} from '@lucide/vue'

// ── Supabase admin client ─────────────────────────────────────────────────
const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = import.meta.env.VITE_SUPABASE_SERVICE_ROLE
const BUCKET           = 'run-messages'
const ADMIN_PASSWORD   = import.meta.env.VITE_ADMIN_PASSWORD || 'runner2026'

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── Gate ──────────────────────────────────────────────────────────────────
const unlocked      = ref(false)
const passwordInput = ref('')
const wrongPassword = ref(false)
const passwordField = ref(null)

function tryUnlock() {
  if (passwordInput.value === ADMIN_PASSWORD) {
    unlocked.value = true
    loadRecordings()
  } else {
    wrongPassword.value = true
    passwordInput.value = ''
    nextTick(() => passwordField.value?.focus())
  }
}

// ── Data ──────────────────────────────────────────────────────────────────
const recordings = ref([])
const loading    = ref(false)
const error      = ref(null)

async function loadRecordings() {
  loading.value = true
  error.value   = null

  try {
    const { data: rows, error: dbErr } = await adminClient
      .from('run_messages')
      .select('id, display_name, file_path, duration_seconds, mime_type, created_at')
      .order('created_at', { ascending: false })

    if (dbErr) throw dbErr

    const { data: objects } = await adminClient.storage
      .from(BUCKET)
      .list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } })

    const sizeMap = {}
    objects?.forEach(o => {
      if (o.metadata?.size) sizeMap[o.name] = Math.round(o.metadata.size / 1024)
    })

    recordings.value = rows.map(r => ({
      ...r,
      size_kb:     sizeMap[r.file_path] ?? null,
      downloading: false,
      loadingPlay: false,
      deleting:    false,
    }))
  } catch (e) {
    error.value = e.message || 'Unknown error'
  } finally {
    loading.value = false
  }
}

// ── Playback ──────────────────────────────────────────────────────────────
const playingId  = ref(null)
const playingUrl = ref(null)
const audioEl    = ref(null)

const playingRec = computed(() =>
  recordings.value.find(r => r.id === playingId.value) ?? null
)

async function togglePlay(rec) {
  if (playingId.value === rec.id) { closePlayer(); return }

  rec.loadingPlay = true
  try {
    const { data, error: signErr } = await adminClient.storage
      .from(BUCKET)
      .createSignedUrl(rec.file_path, 3600)

    if (signErr || !data?.signedUrl) throw signErr || new Error('No URL')

    // Stop any current playback cleanly before switching
    audioEl.value?.pause()
    playingId.value  = rec.id
    playingUrl.value = data.signedUrl

    await nextTick()
    audioEl.value?.play().catch(() => {})
  } catch (e) {
    alert(`Playback failed: ${e.message}`)
  } finally {
    rec.loadingPlay = false
  }
}

function closePlayer() {
  audioEl.value?.pause()
  playingId.value  = null
  playingUrl.value = null
}

// ── Single download ───────────────────────────────────────────────────────
async function downloadOne(rec) {
  rec.downloading = true
  try {
    // Build the filename first so we can pass it into createSignedUrl.
    // Supabase sets Content-Disposition from the `download` option — that
    // header wins over the <a download="..."> attribute, so we must set it
    // server-side to control what the browser saves the file as.
    const ext      = friendlyExt(rec.file_path, rec.mime_type)
    const filename = `${safeNameSegment(rec.display_name)}.${ext}`

    const { data, error: signErr } = await adminClient.storage
      .from(BUCKET)
      .createSignedUrl(rec.file_path, 300, { download: filename })

    if (signErr || !data?.signedUrl) throw signErr || new Error('No URL')
    triggerDownload(data.signedUrl, filename)
  } catch (e) {
    alert(`Save failed: ${e.message}`)
  } finally {
    rec.downloading = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────────
async function deleteOne(rec) {
  const label = rec.display_name || 'Anonymous'
  if (!confirm(`Delete the recording from ${label}? This can't be undone.`)) return

  rec.deleting = true
  try {
    // Remove the storage object first, then the DB row — so a failed row
    // delete never leaves a DB-only entry with no matching file.
    const { error: storageErr } = await adminClient.storage
      .from(BUCKET)
      .remove([rec.file_path])

    // Missing-file errors are fine here — the object may already be gone
    // (e.g. deleted directly from the bucket); still clean up the DB row.
    if (storageErr && !/not.*found/i.test(storageErr.message || '')) {
      throw storageErr
    }

    const { error: dbErr } = await adminClient
      .from('run_messages')
      .delete()
      .eq('id', rec.id)

    if (dbErr) throw dbErr

    if (playingId.value === rec.id) closePlayer()
    recordings.value = recordings.value.filter(r => r.id !== rec.id)
  } catch (e) {
    alert(`Delete failed: ${e.message}`)
    rec.deleting = false
  }
}

// ── Download all as ZIP ───────────────────────────────────────────────────
const downloadingAll = ref(false)
const dlProgress     = ref(0)

/** Derive a DaVinci-friendly extension from a stored file path or mime type. */
function friendlyExt(filePath, mimeType) {
  // mp4 and wav are natively supported by DaVinci Resolve; prefer those
  if (filePath?.endsWith('.mp4') || mimeType?.startsWith('audio/mp4'))  return 'mp4'
  if (filePath?.endsWith('.wav') || mimeType?.startsWith('audio/wav'))  return 'wav'
  if (filePath?.endsWith('.ogg') || mimeType?.startsWith('audio/ogg'))  return 'ogg'
  // webm → rename to mp3 so DaVinci attempts to open it via its Opus decoder
  return 'mp3'
}

/** Sanitize display name into a safe filename segment. */
function safeNameSegment(name) {
  return String(name || 'anonymous')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 50) || 'anonymous'
}

async function downloadAll() {
  if (downloadingAll.value) return
  downloadingAll.value = true
  dlProgress.value     = 0

  const zip = new JSZip()
  const usedNames = {}

  for (let i = 0; i < recordings.value.length; i++) {
    dlProgress.value = i + 1
    const rec = recordings.value[i]
    try {
      const { data, error: signErr } = await adminClient.storage
        .from(BUCKET)
        .createSignedUrl(rec.file_path, 300)

      if (signErr || !data?.signedUrl) continue

      const response = await fetch(data.signedUrl)
      if (!response.ok) continue
      const blob = await response.blob()

      // Build a human-readable filename: {name}.{ext}
      const ext  = friendlyExt(rec.file_path, rec.mime_type)
      const base = safeNameSegment(rec.display_name)
      let filename = `${base}.${ext}`

      // Deduplicate if two recordings share the same name
      if (usedNames[filename]) {
        usedNames[filename]++
        filename = `${base}_${usedNames[filename]}.${ext}`
      } else {
        usedNames[filename] = 1
      }

      zip.file(filename, blob)
    } catch { /* skip failed fetch and continue */ }
  }

  try {
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    triggerDownload(URL.createObjectURL(zipBlob), 'voice-messages.zip')
  } catch (e) {
    alert(`ZIP generation failed: ${e.message}`)
  }

  downloadingAll.value = false
}

// ── Helpers ───────────────────────────────────────────────────────────────
function triggerDownload(url, filename) {
  const a = Object.assign(document.createElement('a'), {
    href: url, download: filename, rel: 'noopener',
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function formatDuration(sec) {
  const s = Math.floor(sec || 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
/* ── Reset & shell ────────────────────────────────────────────────────── */
.admin-shell {
  min-height: 100dvh;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: 'DM Sans', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── Gate ────────────────────────────────────────────────────────────── */
.gate-wrap {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.gate-card {
  width: 100%;
  max-width: 21rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.gate-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
}

.gate-text { display: flex; flex-direction: column; gap: 0.2rem; }

.gate-title {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: -0.01em;
  margin: 0;
  line-height: 1.2;
}

.gate-sub {
  font-size: 0.875rem;
  color: var(--color-muted);
  margin: 0;
}

.gate-form { display: flex; flex-direction: column; gap: 0.625rem; }

.field-wrap {
  border-radius: 8px;
  border: 1.5px solid var(--color-border);
  background: var(--color-bg);
  transition: border-color 150ms ease;
}
.field-wrap:focus-within          { border-color: var(--color-accent); }
.field-wrap--error                { border-color: #c0392b; }

.field-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  background: transparent;
  color: var(--color-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 0.9375rem;
  border: none;
  outline: none;
  box-sizing: border-box;
}
.field-input::placeholder { color: var(--color-muted); }

.field-error {
  font-size: 0.8125rem;
  color: #c0392b;
  margin: 0;
  padding-left: 0.125rem;
}

/* ── Header ──────────────────────────────────────────────────────────── */
.admin-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}

.header-inner {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.admin-title {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 1.0625rem;
  font-weight: 400;
  margin: 0;
  line-height: 1.2;
}

.admin-sub {
  font-size: 0.78125rem;
  color: var(--color-muted);
  margin: 0.125rem 0 0;
}

/* ── Main ────────────────────────────────────────────────────────────── */
.admin-main {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

/* ── Player bar ──────────────────────────────────────────────────────── */
.player-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem 0.625rem 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  position: sticky;
  top: 65px;
  z-index: 10;
}

.player-meta { min-width: 0; }

.player-name {
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.player-audio {
  width: 100%;
  height: 32px;
  min-width: 0;
  accent-color: var(--color-accent);
}

.player-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 4px;
  border-radius: 4px;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 150ms ease, background 150ms ease;
  flex-shrink: 0;
}
.player-close:hover { color: var(--color-text); background: var(--color-bg-subtle); }

/* Player slide-down transition */
.player-enter-active { transition: opacity 200ms ease, transform 200ms ease; }
.player-leave-active { transition: opacity 150ms ease, transform 150ms ease; }
.player-enter-from   { opacity: 0; transform: translateY(-6px); }
.player-leave-to     { opacity: 0; transform: translateY(-6px); }

/* ── Recordings list ─────────────────────────────────────────────────── */
.recordings-list {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}

.recording-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8125rem 1rem 0.8125rem 1.125rem;
  border-bottom: 1px solid var(--color-border);
  transition: background 120ms ease;
}
.recording-row:last-child       { border-bottom: none; }
.recording-row:hover            { background: var(--color-bg-subtle); }
.recording-row--playing         { background: var(--color-accent-dim); }
.recording-row--playing:hover   { background: var(--color-accent-dim); }

.rec-info {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
  min-width: 0;
}

.rec-name {
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.rec-meta {
  font-size: 0.78125rem;
  color: var(--color-muted);
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
}

.meta-dot {
  display: inline-block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--color-muted);
  opacity: 0.5;
  flex-shrink: 0;
}

.rec-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

/* ── Skeletons ───────────────────────────────────────────────────────── */
.skel {
  background: var(--color-border);
  border-radius: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}
.skel--name { height: 13px; width: 120px; }
.skel--meta { height: 11px; width: 200px; margin-top: 2px; }
.skel--btn  { height: 30px; width: 68px; border-radius: 6px; }

@keyframes pulse {
  0%, 100% { opacity: 1;    }
  50%       { opacity: 0.38; }
}

/* ── Empty / error states ────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 5rem 1.5rem;
  gap: 0.5rem;
}

.empty-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  margin-bottom: 0.5rem;
}

.empty-title {
  font-size: 0.9375rem;
  font-weight: 500;
  margin: 0;
}

.empty-body {
  font-size: 0.8125rem;
  color: var(--color-muted);
  max-width: 22rem;
  line-height: 1.55;
  margin: 0 0 0.75rem;
}

/* ── Buttons ─────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  border-radius: 7px;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: background 150ms ease, border-color 150ms ease,
              color 150ms ease, opacity 150ms ease;
  min-height: 36px;
  white-space: nowrap;
  line-height: 1;
}
.btn:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
.btn:disabled      { opacity: 0.5; cursor: not-allowed; }

.btn--primary {
  background: var(--color-accent);
  color: #fff;
  border-color: var(--color-accent);
}
.btn--primary:not(:disabled):hover {
  background: #e05e0f;
  border-color: #e05e0f;
}

.btn--ghost {
  background: transparent;
  color: var(--color-text);
  border-color: var(--color-border);
}
.btn--ghost:not(:disabled):hover  { background: var(--color-bg-subtle); }
.btn--ghost.btn--active {
  background: var(--color-accent);
  color: #fff;
  border-color: var(--color-accent);
}

.btn--danger:not(:disabled):hover {
  background: #fdecea;
  border-color: #c0392b;
  color: #c0392b;
}

.btn--sm { padding: 0.3125rem 0.625rem; font-size: 0.8125rem; min-height: 30px; }
.btn--full { width: 100%; }
.btn--icon-left { padding-left: 0.75rem; }

/* Spinner */
.icon-spin {
  animation: spin 700ms linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 480px) {
  .header-inner { flex-direction: column; align-items: flex-start; }

  .player-bar {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
  }
  .player-meta  { grid-column: 1; grid-row: 1; }
  .player-close { grid-column: 2; grid-row: 1; }
  .player-audio { grid-column: 1 / -1; grid-row: 2; }

  .recording-row  { flex-wrap: wrap; gap: 0.625rem; }
  .rec-actions    { width: 100%; justify-content: flex-end; }
}
</style>
