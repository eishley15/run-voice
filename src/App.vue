<template>
  <div class="app-shell">

    <!-- In-app browser banner (F14) -->
    <InAppBrowserBanner
      v-if="iabStatus.show"
      :app-name="iabStatus.appName"
      :missing-capability="iabStatus.missingCapability"
    />

    <!-- Orphaned recording recovery (F4 Layer 3) -->
    <Transition name="fade">
      <div v-if="orphan" class="orphan-overlay" role="dialog" aria-modal="true"
           aria-labelledby="orphan-title">
        <div class="orphan-card">
          <h2 id="orphan-title" class="orphan-title">Unfinished recording found</h2>
          <p class="orphan-body">
            You had a {{ formatDuration(orphan.durationMs / 1000) }} recording that wasn't uploaded.
            Want to pick up where you left off?
          </p>
          <div class="orphan-actions">
            <button class="btn btn--primary" @click="handleRestoreOrphan">Upload it</button>
            <button class="btn btn--ghost"   @click="handleDiscardOrphan">Discard</button>
          </div>
        </div>
      </div>
    </Transition>

    <main class="main-content" role="main">

      <!--
        Upper area: state-dependent content.
        The record button and waveform canvas are BELOW this, outside the
        Transition, so the canvas element stays mounted and its ref is always
        valid when startRecording() needs to pass it to useWaveform.start().
      -->
      <Transition name="fade" mode="out-in">

        <!-- ── INTRO ────────────────────────────────────────────────── -->
        <div v-if="state === 'intro'" key="intro" class="view-upper">
          <header class="intro-header">
            <h1 class="headline" v-html="headline"></h1>
            <p class="subhead">
              Record something — a cheer, a story, a favourite lyric.
              Only the runner will hear it.
            </p>
          </header>

          <div class="name-field">
            <label for="contributor-name" class="field-label">
              Your name <span class="field-required" aria-hidden="true">*</span>
            </label>
            <input
              id="contributor-name"
              v-model="displayName"
              type="text"
              class="field-input"
              :class="{ 'field-input--error': nameError }"
              placeholder="Your name"
              maxlength="60"
              autocomplete="name"
              spellcheck="false"
              required
              aria-required="true"
              :aria-describedby="nameError ? 'name-error' : undefined"
              @input="nameError = false"
            />
            <p v-if="nameError" id="name-error" class="field-error" role="alert">
              Please enter your name before recording.
            </p>
          </div>
        </div>

        <!-- ── REQUESTING ──────────────────────────────────────────── -->
        <div v-else-if="state === 'requesting'" key="requesting" class="view-upper view-upper--center">
          <p class="status-text" aria-live="polite">Waiting for microphone access…</p>
        </div>

        <!-- ── RECORDING — warnings only (button + canvas are persistent) -->
        <div v-else-if="state === 'recording'" key="recording" class="view-upper view-upper--center">
          <div aria-live="polite" class="sr-only">
            Recording. {{ formatDuration(elapsedMs / 1000) }} elapsed.
          </div>

          <Transition name="fade">
            <div v-if="silenceWarning" class="silence-warning" role="alert">
              We're not detecting audio — check that your mic isn't covered or muted.
            </div>
          </Transition>

          <Transition name="fade">
            <p v-if="longRecordingNotice" class="long-notice" role="alert">
              You're at 25 minutes — recording will automatically stop at 30 minutes.
            </p>
          </Transition>
        </div>

        <!-- ── PREVIEW ─────────────────────────────────────────────── -->
        <div v-else-if="state === 'preview'" key="preview" class="view-upper">
          <header class="preview-header">
            <h2 class="preview-title">Listen back</h2>
            <p class="preview-meta">{{ formatDuration(recordingDuration) }} recording</p>
          </header>

          <audio
            ref="audioRef"
            class="preview-player"
            controls
            :src="audioBlobUrl"
            aria-label="Your recording"
          />

          <Transition name="fade">
            <div v-if="postStopSilent" class="silence-warning" role="alert">
              This recording sounds very quiet — the microphone may not have picked up your voice.
              We recommend re-recording, but you can still submit if you'd like.
            </div>
          </Transition>

          <div class="preview-actions">
            <button class="btn btn--ghost" @click="requestReRecord" aria-label="Discard and record again">
              Re-record
            </button>
            <button class="btn btn--primary" @click="handleSubmit" aria-label="Submit your voice message">
              Send message
            </button>
          </div>

          <!-- Re-record confirmation (F17: only when take > 30 s) -->
          <Transition name="fade">
            <div v-if="confirmReRecord" class="confirm-overlay" role="dialog" aria-modal="true"
                 aria-labelledby="confirm-title">
              <div class="confirm-card">
                <h3 id="confirm-title" class="confirm-title">Discard this recording?</h3>
                <p class="confirm-body">
                  Your {{ formatDuration(recordingDuration) }} recording will be deleted.
                </p>
                <div class="confirm-actions">
                  <button class="btn btn--danger" @click="confirmDiscardReRecord">Yes, discard</button>
                  <button class="btn btn--ghost"  @click="cancelReRecord">Keep it</button>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- ── UPLOADING ────────────────────────────────────────────── -->
        <div v-else-if="state === 'uploading'" key="uploading" class="view-upper view-upper--center">
          <div aria-live="assertive" class="sr-only">Uploading… {{ progress }}%</div>

          <h2 class="section-title">Sending your message…</h2>
          <p class="status-text">Don't close this page.</p>

          <div class="progress-bar-wrap" role="progressbar"
               :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" :style="{ transform: `scaleX(${progress / 100})` }" />
          </div>

          <p class="progress-label tabular-nums">
            {{ formatBytes(bytesUploaded) }} / {{ formatBytes(bytesTotal) }}
            ({{ progress }}%)
          </p>
        </div>

        <!-- ── SUCCESS ──────────────────────────────────────────────── -->
        <div v-else-if="state === 'success'" key="success" class="view-upper view-upper--center">
          <div class="success-icon" aria-hidden="true">✓</div>
          <h2 class="section-title">Message received.</h2>
          <p class="status-text">The runner will hear it before the start line. Thank you.</p>
        </div>

        <!-- ── ERROR ───────────────────────────────────────────────── -->
        <div v-else-if="state === 'error'" key="error" class="view-upper">
          <h2 class="section-title">Something went wrong</h2>

          <div class="error-body">
            <template v-if="errorType === 'NotAllowedError'">
              <p>Microphone access was blocked.</p>
              <ol class="error-steps">
                <li><strong>iOS Safari:</strong> Settings → Safari → Microphone → Allow</li>
                <li><strong>Android Chrome:</strong> Tap the lock icon in the address bar → Microphone → Allow</li>
                <li><strong>Desktop:</strong> Click the lock icon in the address bar and allow microphone</li>
              </ol>
            </template>
            <template v-else-if="errorType === 'NotFoundError'">
              <p>No microphone was found. Try a different device or attach a microphone and reload.</p>
            </template>
            <template v-else-if="errorType === 'NotReadableError'">
              <p>Your microphone is in use by another app. Close other apps and try again.</p>
            </template>
            <template v-else-if="errorType === 'upload-failed'">
              <p>Your recording was captured but the upload failed.</p>
              <div class="error-actions">
                <button class="btn btn--primary" @click="handleRetryUpload">Try uploading again</button>
                <button class="btn btn--ghost"   @click="handleLocalDownload">Save to my device</button>
              </div>
            </template>
            <template v-else-if="errorType === 'UnsupportedBrowser'">
              <p>This browser doesn't support audio recording. Please open this link in Safari or Chrome.</p>
            </template>
            <template v-else>
              <p>An unexpected error occurred. Please try again.</p>
            </template>
          </div>

          <button
            v-if="errorType !== 'upload-failed'"
            class="btn btn--primary"
            @click="retryFromError"
          >
            Try again
          </button>
        </div>

      </Transition>

      <!--
        ── PERSISTENT RECORD AREA ──────────────────────────────────────────
        Kept outside the Transition so the WaveformCanvas is never unmounted
        while recording is starting. v-show keeps the DOM element alive.

        Shown for: intro | requesting | recording
        Hidden for: preview | uploading | success | error
      -->
      <div
        v-show="['intro', 'requesting', 'recording'].includes(state)"
        class="record-area"
        :aria-hidden="!['intro', 'requesting', 'recording'].includes(state)"
      >
        <!--
          WaveformCanvas is always mounted here.
          getCanvas() (the HTMLCanvasElement) is passed to startRecording(),
          which hands it to useWaveform.start(). Because the canvas is never
          unmounted between intro and recording, the ref is always valid.
        -->
        <WaveformCanvas
          ref="waveformRef"
          :active="state === 'recording'"
          :level="waveformLevel"
        />

        <!-- Elapsed timer — only visible during recording -->
        <div
          v-show="state === 'recording'"
          class="timer tabular-nums"
          aria-label="Recording time"
        >
          {{ formatDuration(elapsedMs / 1000) }}
        </div>

        <!--
          Single button that toggles between idle and recording.
          Disabled (visually only) while requesting permission.
        -->
        <button
          class="record-btn"
          :class="{
            'record-btn--idle':      state !== 'recording',
            'record-btn--recording': state === 'recording',
            'record-btn--requesting': state === 'requesting',
          }"
          :aria-label="state === 'recording' ? 'Stop recording' : 'Start recording'"
          :aria-disabled="state === 'requesting'"
          @click="handleButtonClick"
        >
          <!-- Idle / requesting: mic dot -->
          <svg v-if="state !== 'recording'" class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="6" fill="currentColor" />
          </svg>
          <!-- Recording: stop square -->
          <svg v-else class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
          </svg>
        </button>

        <p class="record-hint">
          <span v-if="state === 'requesting'">Waiting for permission…</span>
          <span v-else-if="state === 'recording'">Tap to stop</span>
          <span v-else>Tap to record</span>
        </p>
      </div>

    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import InAppBrowserBanner from './components/InAppBrowserBanner.vue'
import WaveformCanvas     from './components/WaveformCanvas.vue'
import { getInAppBrowserStatus } from './utils/inAppBrowser.js'
import { useRecorder }   from './composables/useRecorder.js'
import { useUpload }     from './composables/useUpload.js'
import { useIndexedDB }  from './composables/useIndexedDB.js'
import { supabase }      from './utils/supabase.js'

// ── In-app browser ────────────────────────────────────────────────────────────
const iabStatus = ref(getInAppBrowserStatus())

// ── Admin-editable landing heading ────────────────────────────────────────────
const DEFAULT_HEADLINE = 'Leave a voice message<br />for the run.'
const headline = ref(DEFAULT_HEADLINE)

async function loadHeadline() {
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('heading')
      .eq('id', 'landing')
      .single()

    if (error) throw error
    if (data?.heading?.trim()) headline.value = data.heading
  } catch (e) {
    console.error('[voice-app] Failed to load custom heading, using default.', e)
  }
}

// ── Destructure so all refs auto-unwrap in the template ───────────────────────
const {
  state,
  errorType,
  displayName,
  elapsedMs,
  silenceWarning,
  longRecordingNotice,
  postStopSilent,
  confirmReRecord,
  recordingBlob,
  recordingMimeType,
  recordingFilename,
  recordingDuration,
  startRecording,
  stopRecording,
  requestReRecord,
  confirmDiscardReRecord,
  cancelReRecord,
  setUploading,
  setSuccess,
  setError,
  retryFromError,
  restoreOrphan,
  waveformLevel,
} = useRecorder()

const {
  progress,
  bytesUploaded,
  bytesTotal,
  upload,
  retry: retryUpload,
  downloadLocally,
} = useUpload()

const idb = useIndexedDB()

// ── DOM refs ──────────────────────────────────────────────────────────────────
const waveformRef = ref(null)   // → WaveformCanvas component instance
const audioRef    = ref(null)
const orphan      = ref(null)
const nameError   = ref(false)
let   blobUrl     = null

// ── Audio preview URL ─────────────────────────────────────────────────────────
const audioBlobUrl = computed(() => {
  if (state.value !== 'preview' || !recordingBlob.value) return null
  if (blobUrl) URL.revokeObjectURL(blobUrl)
  blobUrl = URL.createObjectURL(recordingBlob.value)
  return blobUrl
})

onBeforeUnmount(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })

// ── beforeunload guard during upload (F3) ─────────────────────────────────────
function beforeUnloadGuard(e) {
  if (state.value === 'uploading') { e.preventDefault(); e.returnValue = '' }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnloadGuard)
  checkForOrphan()
  loadHeadline()
})
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnloadGuard) })

// ── Orphan recovery (F4 Layer 3) ──────────────────────────────────────────────
async function checkForOrphan() {
  try { const found = await idb.checkOrphan(); if (found) orphan.value = found }
  catch { /* IDB unavailable */ }
}
async function handleRestoreOrphan() {
  if (!orphan.value) return
  await restoreOrphan(orphan.value)
  orphan.value = null
}
async function handleDiscardOrphan() { await idb.clear(); orphan.value = null }

// ── Record / stop button ──────────────────────────────────────────────────────
function handleButtonClick() {
  if (state.value === 'recording')  { stopRecording(); return }
  if (state.value === 'requesting') return  // ignore taps while permission dialog is open
  handleRecordClick()
}

async function handleRecordClick() {
  // Name is required — show inline error and focus the field
  if (!displayName.value.trim()) {
    nameError.value = true
    document.getElementById('contributor-name')?.focus()
    return
  }

  // getCanvas() is exposed by WaveformCanvas and returns the raw HTMLCanvasElement.
  // We use a method rather than a ref property because Vue 3.3+ auto-unwraps
  // refs in defineExpose, making .canvasRef.value resolve to undefined.
  const canvas = waveformRef.value?.getCanvas() ?? null
  await startRecording(canvas)
}

// ── Submit ────────────────────────────────────────────────────────────────────
let submitting = false
async function handleSubmit() {
  if (submitting || state.value !== 'preview') return
  submitting = true
  setUploading()
  const { ok, error } = await upload(
    recordingBlob.value,
    recordingFilename.value,
    recordingMimeType.value,
    displayName.value,
    recordingDuration.value,
  )
  ok ? setSuccess() : (setError('upload-failed'), console.error('[app] upload failed:', error))
  submitting = false
}

// ── Retry / local download (F4) ───────────────────────────────────────────────
async function handleRetryUpload() {
  setUploading()
  const { ok } = await retryUpload(
    recordingFilename.value, recordingMimeType.value,
    displayName.value, recordingDuration.value,
  )
  ok ? setSuccess() : setError('upload-failed')
}
function handleLocalDownload() {
  if (recordingBlob.value) downloadLocally(recordingBlob.value, recordingFilename.value)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(totalSec) {
  const s   = Math.floor(totalSec || 0)
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}
function formatBytes(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<style scoped>
/* ── Shell ───────────────────────────────────────────────────────────────── */
.app-shell {
  min-height: 100dvh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  color: var(--color-text);
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.25rem 3rem;
  gap: 2rem;
  width: 100%;
  max-width: 28rem;
  margin: 0 auto;
  box-sizing: border-box;
}

/* ── Upper (transitioning) area ──────────────────────────────────────────── */
.view-upper {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  text-align: center;
}

.view-upper--center {
  justify-content: center;
  min-height: 80px;
}

/* ── Intro ───────────────────────────────────────────────────────────────── */
.intro-header { display: flex; flex-direction: column; gap: 0.75rem; }

.headline {
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  line-height: 1.15;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.subhead {
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--color-muted);
  max-width: 22rem;
  margin: 0 auto;
}

/* ── Name field ──────────────────────────────────────────────────────────── */
.name-field {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  text-align: left;
}

.field-label  { font-size: 0.8125rem; font-weight: 500; color: var(--color-text); }
.field-required { color: var(--color-accent); font-weight: 600; margin-left: 2px; }
.field-error  { font-size: 0.78125rem; color: #c0392b; margin: 0.25rem 0 0; }

.field-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: 'DM Sans', sans-serif;
  font-size: 1rem;
  transition: border-color 150ms ease;
  box-sizing: border-box;
}
.field-input:focus { outline: none; border-color: var(--color-accent); }
.field-input--error { border-color: #c0392b !important; }
.field-input::placeholder { color: var(--color-muted); }

/* ── Status text ─────────────────────────────────────────────────────────── */
.status-text { font-size: 0.9375rem; color: var(--color-muted); margin: 0; }

/* ── Persistent record area ──────────────────────────────────────────────── */
.record-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

/* ── Record button ───────────────────────────────────────────────────────── */
.record-btn {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 200ms ease-out, background 200ms ease-out, box-shadow 200ms ease-out, opacity 200ms ease;
}
.record-btn:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; }
.record-btn:active { transform: scale(0.96); }

.record-btn--idle {
  background: var(--color-surface);
  color: var(--color-text);
}
.record-btn--idle:hover {
  transform: scale(1.06);
  box-shadow: 0 4px 20px rgba(0,0,0,0.1);
}

.record-btn--requesting {
  background: var(--color-surface);
  color: var(--color-muted);
  opacity: 0.6;
  cursor: default;
}

.record-btn--recording {
  background: var(--color-accent);
  color: #fff;
}
.record-btn--recording:hover { transform: scale(1.04); background: #e05e0f; }

.btn-icon { width: 28px; height: 28px; }

.record-hint { font-size: 0.8125rem; color: var(--color-muted); margin: 0; }

/* ── Timer ───────────────────────────────────────────────────────────────── */
.timer {
  font-size: 2rem;
  font-weight: 300;
  letter-spacing: -0.01em;
  color: var(--color-text);
  line-height: 1;
}

/* ── Warnings ────────────────────────────────────────────────────────────── */
.silence-warning {
  font-size: 0.8125rem;
  padding: 8px 14px;
  border-radius: 6px;
  background: var(--color-accent-dim);
  color: #7a3000;
  border: 1px solid #f5cba7;
  max-width: 24rem;
  text-align: center;
}
.long-notice { font-size: 0.8125rem; color: var(--color-muted); text-align: center; margin: 0; }

/* ── Preview ─────────────────────────────────────────────────────────────── */
.preview-header { display: flex; flex-direction: column; gap: 0.25rem; }
.preview-title {
  font-family: var(--font-display);
  font-size: 1.75rem; font-weight: 600; margin: 0;
}
.preview-meta { font-size: 0.875rem; color: var(--color-muted); margin: 0; }
.preview-player { width: 100%; border-radius: 8px; }
.preview-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center; }

/* ── Section title (uploading / success / error) ─────────────────────────── */
.section-title {
  font-family: var(--font-display);
  font-size: 1.75rem; font-weight: 600; margin: 0; text-align: center;
}

/* ── Progress bar ────────────────────────────────────────────────────────── */
.progress-bar-wrap {
  width: 100%; max-width: 20rem; height: 8px;
  background: var(--color-border); border-radius: 4px; overflow: hidden;
}
.progress-bar {
  height: 100%; background: var(--color-accent); border-radius: 4px;
  width: 100%;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 200ms ease;
}
.progress-label { font-size: 0.8125rem; color: var(--color-muted); margin: 0; }

/* ── Success ─────────────────────────────────────────────────────────────── */
.success-icon {
  width: 60px; height: 60px; border-radius: 50%;
  background: var(--color-accent-dim); border: 2px solid var(--color-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; color: var(--color-accent);
}

/* ── Error ───────────────────────────────────────────────────────────────── */
.error-body {
  font-size: 0.9rem; color: var(--color-muted);
  line-height: 1.6; text-align: left; width: 100%;
}
.error-body p { margin: 0 0 0.75rem; }
.error-steps {
  padding: 0.875rem 1rem 0.875rem 2rem;
  border-radius: 8px;
  background: var(--color-bg-subtle);
  display: flex; flex-direction: column;
  gap: 0.625rem; margin: 0.75rem 0 0; color: var(--color-text);
}
.error-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }

/* ── Overlays ────────────────────────────────────────────────────────────── */
.orphan-overlay,
.confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(26,23,20,0.5);
  display: flex; align-items: center; justify-content: center;
  padding: 1.25rem; z-index: 100;
}
.orphan-card,
.confirm-card {
  background: var(--color-bg); border-radius: 12px; padding: 1.75rem;
  max-width: 22rem; width: 100%;
  display: flex; flex-direction: column; gap: 1rem; text-align: center;
}
.orphan-title, .confirm-title {
  font-family: var(--font-display);
  font-size: 1.25rem; font-weight: 600; margin: 0;
}
.orphan-body, .confirm-body {
  font-size: 0.875rem; color: var(--color-muted); line-height: 1.5; margin: 0;
}
.orphan-actions, .confirm-actions {
  display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;
}

/* ── Shared buttons ──────────────────────────────────────────────────────── */
.btn {
  padding: 0.625rem 1.25rem; border-radius: 8px;
  font-family: 'DM Sans', sans-serif; font-size: 0.9375rem; font-weight: 500;
  cursor: pointer; border: 1.5px solid transparent;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
  min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
}
.btn:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
.btn:active { transform: scale(0.97); }

.btn--primary { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
.btn--primary:hover { background: #e05e0f; border-color: #e05e0f; box-shadow: 0 4px 16px rgba(247,107,21,0.25); }

.btn--ghost { background: transparent; color: var(--color-text); border-color: var(--color-border); }
.btn--ghost:hover { background: var(--color-bg-subtle); border-color: var(--color-text); }

.btn--danger { background: #c0392b; color: #fff; border-color: #c0392b; }
.btn--danger:hover { background: #a93226; border-color: #a93226; }

/* ── Utilities ───────────────────────────────────────────────────────────── */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
</style>
