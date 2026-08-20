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

      <!-- ── POSTCARD GROUP: intro | requesting | recording ─────────────── -->
      <div v-if="showPostcard" class="postcard-shell">

        <!-- Photo panel — framed portrait, sits above the paper panel.
             Self-hides if /portrait.jpg isn't present yet (@error), so
             nothing breaks before the file is added. -->
        <Transition name="fade">
          <div v-if="!portraitMissing" class="photo-panel">
            <img
              class="photo-panel__img"
              :src="'/portrait.jpg'"
              alt="Mau"
              @error="portraitMissing = true"
            />
          </div>
        </Transition>

        <div class="postcard-card">
          <div class="postcard-inner">
            <!-- Vintage Australian stamp, pinned to the paper's top-right corner -->
            <img class="stamp-box" src="/stampaus.png" alt="" aria-hidden="true" />

            <!-- ── INTRO | REQUESTING | RECORDING — one persistent two-column
                 postcard-back layout: message on the left (its content
                 swaps per state), name field + waveform + record button on
                 the right, divided by a ruled vertical line. Kept as ONE
                 always-mounted structure (not v-if-swapped per state) so
                 the WaveformCanvas's canvas element is never destroyed and
                 recreated mid-recording — that was silently breaking the
                 waveform: the analyser kept drawing onto a canvas that had
                 already been unmounted the moment intro's record button
                 flipped the state away from 'intro'. ───────────────────── -->
            <div v-if="state !== 'preview'" key="postcard-split" class="postcard-split">
              <header class="postcard-masthead">
                <p class="postcard-masthead-title">Post Card</p>
                <p class="postcard-masthead-sub">Before Race Day</p>
              </header>

              <div class="postcard-columns" :class="{ 'postcard-columns--solo': state !== 'intro' }">
                <div class="postcard-col postcard-col--message">
                  <Transition name="fade" mode="out-in">
                    <header v-if="state === 'intro'" key="intro-msg" class="intro-header">
                      <h1 class="headline" v-html="headline"></h1>
                      <p class="subhead">
                        Send me a voice note with your best pep talk! Hype me up,
                        make me laugh, tell me I've got this, or remind me that
                        quitting is NOT an option—whatever will get me through
                        42.2km.
                      </p>
                      <p class="closing">
                        I'll be taking your voices with me to the start line!
                      </p>
                      <p class="signoff-name">Love, Mau</p>
                    </header>

                    <div v-else-if="state === 'requesting'" key="requesting-msg" class="message-status">
                      <p class="status-text" aria-live="polite">Waiting for microphone access…</p>
                    </div>

                    <div v-else key="recording-msg" class="message-status">
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
                  </Transition>
                </div>

                <div class="postcard-divider" aria-hidden="true"></div>

                <div class="postcard-col postcard-col--reply">
                  <div class="name-field" v-show="state === 'intro'">
                    <label for="contributor-name" class="field-label">
                      From <span class="field-required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="contributor-name"
                      v-model="displayName"
                      type="text"
                      class="field-input"
                      :class="{ 'field-input--error': nameError }"
                      placeholder="write your name"
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

                  <div class="record-area">
                    <WaveformCanvas
                      ref="waveformRef"
                      :active="state === 'recording'"
                      :level="waveformLevel"
                    />

                    <div v-show="state === 'recording'" class="recording-status" aria-hidden="true">
                      <span class="recording-dot"></span>
                      <span class="recording-label">Recording</span>
                    </div>
                    <div
                      v-show="state === 'recording'"
                      class="timer tabular-nums"
                      aria-label="Recording time"
                    >
                      {{ formatDuration(elapsedMs / 1000) }}
                    </div>

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
                      <svg v-if="state !== 'recording'" class="btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="6" fill="currentColor" />
                      </svg>
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
                </div>
              </div>
            </div>

            <!-- ── PREVIEW — "Voice note recorded", still framed by the
                 postcard. Recording has already stopped here, so no
                 waveform canvas is needed. ──────────────────────────── -->
            <div v-else key="preview" class="view-upper">
              <header class="preview-header">
                <h2 class="preview-title">Voice note recorded</h2>
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
          </div>
        </div>
      </div>

      <!-- ── PLAIN GROUP: uploading | success | error ────────────────────── -->
      <Transition v-else name="fade" mode="out-in">

        <!-- ── UPLOADING ────────────────────────────────────────────── -->
        <div v-if="state === 'uploading'" key="uploading" class="view-upper view-upper--center">
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
const DEFAULT_HEADLINE = 'Calling all my Marathon Cheerleaders!'
const headline = ref(DEFAULT_HEADLINE)

// ── Portrait — hides itself if /portrait.jpg hasn't been added yet ───────────
const portraitMissing = ref(false)

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

// ── Postcard group — states shown inside the cream card over the hero photo ──
const showPostcard = computed(() => ['intro', 'requesting', 'recording', 'preview'].includes(state.value))

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
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  color: var(--color-text);
}

/* Weathered dark surface behind the postcards — bg.jpg toned down to a
   muted, desaturated vintage photograph (not the vivid original) with a
   dark vignette + fine grain over it, so the page reads as one aged
   photographed scene instead of a flat black background. A pseudo-element
   (rather than backgrounding .app-shell directly) keeps the filter off
   the actual UI content, which sits above it via .main-content's z-index. */
.app-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    var(--pc-grain),
    linear-gradient(to bottom, rgba(12, 9, 6, 0.6), rgba(12, 9, 6, 0.32) 35%, rgba(12, 9, 6, 0.68)),
    url('/bg.jpg') center / cover no-repeat;
  filter: grayscale(0.35) sepia(0.18) brightness(0.55) contrast(1.08);
}

.main-content {
  position: relative;
  z-index: 1;
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

.main-content:has(.postcard-shell) {
  max-width: 42rem;
}

/* ── Upper (transitioning) area ──────────────────────────────────────────── */
.view-upper {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(0.5rem, 2.4vw, 1.5rem);
  text-align: center;
}

.view-upper--center {
  justify-content: center;
}

.postcard-inner .view-upper {
  justify-content: center;
  flex: 1;
  min-height: 0;
}

/* ── Postcard shell — stacks the photo panel above the paper panel ────────── */
.postcard-shell {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}

/* ── Photo panel (front) and paper panel (back) — same landscape aspect
   ratio, same border/shadow treatment, opposite tiny rotations so the
   pair reads as two physical cards photographed on a surface rather than
   flat app panels. No scrolling anywhere: the paper's content is sized
   with clamp()/mobile overrides to fit the fixed box instead. ─────────── */
.photo-panel,
.postcard-card {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 2;
  /* Flex items with an aspect-ratio still expand past it if their content
     needs more room — their automatic min-height stays content-based
     unless overflow is set to something other than visible. This is what
     was letting the text-heavy back card grow taller than the front
     card; overflow: hidden here (on the flex item itself, not just its
     inner content wrapper) pins both cards to the exact same size.
     flex-shrink: 0 is needed too — without it, some engines (seen on
     real iOS Safari, not reproducible in desktop devtools) shrink an
     aspect-ratio flex item below its ratio-derived height when combined
     with a percentage-sized child (the photo below), silently clipping
     the bottom few px of the card. */
  flex-shrink: 0;
  overflow: hidden;
  background: var(--pc-cream);
  background-image: var(--pc-grain);
  border: 1px solid var(--pc-cream-line);
  padding: 7px;
  box-sizing: border-box;
  box-shadow:
    inset 0 0 22px 2px rgba(70, 50, 30, 0.12),
    0 1px 1px rgba(0, 0, 0, 0.15),
    0 18px 34px -14px rgba(0, 0, 0, 0.55);
}

/* Absolutely positioned (instead of width/height: 100% in normal flow) so
   it never depends on percentage-height resolving against an
   aspect-ratio + flexbox parent — that combination is where real Safari
   has diverged from desktop Chrome/devtools in testing, cropping the
   image's bottom edge. An abspos element's containing block is always
   definitively sized (the nearest positioned ancestor's padding box), so
   percentage width/height on it resolves reliably everywhere, unlike a
   normal-flow flex-item child. top/left: 7px restates .photo-panel's
   padding (an abspos child's containing block is the padding box, which
   would otherwise cover it); width/height then have to subtract that
   same 7px back out on both sides — plain width/height: 100% here would
   cover the padding too. (`width: auto` + `inset: 7px` was tried first
   and does NOT stretch a replaced element like <img> to fit — replaced
   elements fall back to intrinsic size when width/height is auto, even
   with all four inset offsets set, so the size has to be explicit.) */
.photo-panel__img {
  position: absolute;
  top: 7px;
  left: 7px;
  width: calc(100% - 14px);
  height: calc(100% - 14px);
  object-fit: cover;
  display: block;
  border: 1px solid var(--pc-cream-line);
  filter: saturate(0.85) contrast(0.96) sepia(0.08);
}

.postcard-inner {
  position: relative;
  height: 100%;
  border: 1px solid var(--pc-cream-line);
  padding: 0.875rem 1.125rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  box-sizing: border-box;
  overflow: hidden; /* safety net only — sizing below is tuned to fit, never scrolls */
}

/* ── Stamp — vintage Australian postage stamp image, top-right corner ─────── */
.stamp-box {
  position: absolute;
  top: 0.625rem;
  right: 0.625rem;
  width: clamp(48px, 13vw, 66px);
  height: clamp(48px, 13vw, 66px);
  object-fit: contain;
  transform: rotate(1.5deg);
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.18)) sepia(0.3) saturate(0.8);
}

/* ── Masthead — centered "POST CARD" title, matching the reference's
   travel-postcard header ──────────────────────────────────────────────── */
.postcard-masthead {
  text-align: center;
  flex-shrink: 0;
}
.postcard-masthead-title {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: clamp(0.9375rem, 3.4vw, 1.25rem);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--pc-ink);
  margin: 0;
}
.postcard-masthead-sub {
  font-family: var(--font-serif);
  font-size: clamp(0.5rem, 1.6vw, 0.6875rem);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--pc-ink-muted);
  margin: 0.125rem 0 0;
}

/* ── Postcard split — intro's two-column "back of postcard" layout ────────── */
.postcard-split {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: clamp(0.625rem, 3.4vw, 1.5rem);
}

.postcard-columns {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: clamp(0.25rem, 1.1vw, 0.625rem);
}

/* Requesting/recording — collapse back to the original single, centered
   column (no divider, no side-by-side split): any status text/warnings
   stack above the waveform, which sits directly above the record button.
   Structurally this is still the same DOM (same WaveformCanvas instance,
   never unmounted), just re-flowed with CSS instead of a different layout
   swapping the canvas out from under the recorder. */
.postcard-columns--solo {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(0.5rem, 2.4vw, 1rem);
}
.postcard-columns--solo .postcard-divider { display: none; }
.postcard-columns--solo .postcard-col--message,
.postcard-columns--solo .postcard-col--reply {
  flex: none;
  width: 100%;
}
.postcard-columns--solo .postcard-col--message { align-items: center; }
.postcard-columns--solo .message-status { align-items: center; text-align: center; }

.postcard-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.postcard-col--message {
  flex: 1.15;
  text-align: left;
  justify-content: center;
}
.postcard-col--message .intro-header { align-items: flex-start; text-align: left; }
.postcard-col--message .subhead,
.postcard-col--message .closing { margin: 0; max-width: none; }

/* Requesting/recording status content, in the same slot the intro copy
   occupies — kept in the message font/hand so the transition feels
   continuous rather than switching to plain UI text mid-recording. */
.message-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: clamp(0.25rem, 1.4vw, 0.625rem);
  text-align: left;
  width: 100%;
}
.message-status .closing { margin: 0; }

.postcard-col--reply {
  flex: 0.85;
  align-items: center;
  justify-content: center;
  gap: clamp(0.375rem, 1.8vw, 1rem);
  text-align: center;
}
.postcard-col--reply .name-field { text-align: left; }
.postcard-col--reply .record-area { gap: clamp(0.25rem, 1.4vw, 0.75rem); }
/* Same pen as the left column's message — was sitting in Cormorant italic
   (a "printed" serif) via the shared .postcard-inner .record-hint rule
   below, which read as a mismatched typeface next to the handwriting.
   (Extra .postcard-inner prefix is needed purely to out-specificity that
   shared rule, which is defined later in the file.) */
.postcard-inner .postcard-col--reply .record-hint {
  font-family: var(--font-message);
  font-style: normal;
  font-weight: 400;
}

.postcard-divider {
  align-self: stretch;
  width: 1px;
  background: var(--pc-cream-line);
  flex-shrink: 0;
}

/* ── Cream-context overrides — status text, warnings, record area reused
   inside the postcard card need ink tones instead of the dark-theme tokens */
.postcard-inner .status-text,
.postcard-inner .long-notice,
.postcard-inner .record-hint {
  font-family: var(--font-serif);
  font-style: italic;
  color: var(--pc-ink-muted);
}
.postcard-inner .silence-warning {
  background: transparent;
  border-color: var(--pc-accent);
  color: var(--pc-ink);
}
.postcard-inner .timer {
  color: var(--pc-ink);
}
.postcard-inner .record-area {
  margin-top: 0.25rem;
}
.postcard-inner .btn--primary {
  background: var(--pc-accent);
  color: var(--pc-cream);
  border-color: var(--pc-accent);
}
.postcard-inner .btn--primary:hover { opacity: 0.85; }
.postcard-inner .btn--ghost {
  color: var(--pc-ink);
  border-color: var(--pc-ink-muted);
}
.postcard-inner .btn--ghost:hover {
  background: transparent;
  border-color: var(--pc-ink);
}
.postcard-inner .btn {
  min-height: clamp(30px, 8vw, 44px);
  padding: clamp(0.25rem, 1.4vw, 0.625rem) clamp(0.625rem, 3vw, 1.25rem);
  font-size: clamp(0.6875rem, 2.6vw, 0.9375rem);
}

/* ── Intro — handwritten pen-on-paper hierarchy: a bold expressive
   headline, a natural-weight body message, a slightly more prominent
   closing line, and a signature. One handwritten family (Caveat) throughout,
   distinguished by weight/size rather than switching typefaces. ─────────── */
.intro-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(0.125rem, 1.1vw, 0.5rem);
  min-height: 0;
}

.headline {
  font-family: var(--font-script);
  font-weight: 700;
  font-size: clamp(0.5rem, 2.75vw, 0.9375rem);
  line-height: 1.1;
  color: var(--pc-ink);
  margin: 0;
}

/* Body message — a distinct vintage hand from the headline/signature.
   Sizing here is intentionally NOT tuned to fill .postcard-inner's
   overflow:hidden box exactly — it carries a safety margin below the
   fallback-font size, so text still fits before Google Fonts finish
   loading (display=swap paints Kalam's fallback immediately) and across
   engines with slightly different metrics for the same font. Below
   ~380px width the clamp() floor (not the vw term) is what's actually
   in effect for most phones, so the floor itself is what was verified
   against the fallback-font measurement down to a 360px-wide viewport. */
.subhead {
  font-family: var(--font-message);
  font-weight: 400;
  font-size: clamp(0.4375rem, 2.1vw, 0.75rem);
  line-height: 1.25;
  letter-spacing: 0.01em;
  color: var(--pc-ink);
  max-width: 26rem;
  margin: 0;
}

.closing {
  font-family: var(--font-message);
  font-weight: 700;
  font-size: clamp(0.5rem, 2.2vw, 0.8125rem);
  line-height: 1.2;
  letter-spacing: 0.01em;
  color: var(--pc-ink);
  max-width: 24rem;
  margin: 0;
}

.signoff-name {
  font-family: var(--font-script);
  font-weight: 700;
  font-size: clamp(0.625rem, 2.9vw, 1rem);
  color: var(--pc-ink);
  margin: 0;
}

/* ── Name field — a ruled address line, "written" in the same hand ────────── */
.name-field {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: clamp(0.125rem, 0.8vw, 0.375rem);
  text-align: left;
  padding-left: clamp(0.5rem, 3vw, 1.25rem);
  box-sizing: border-box;
}

.field-label  { font-family: var(--font-serif); font-size: clamp(0.4375rem, 1.5vw, 0.6875rem); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--pc-ink-muted); }
.field-required { color: var(--pc-accent); font-weight: 600; margin-left: 2px; }
.field-error  { font-family: var(--font-serif); font-style: italic; font-size: 0.75rem; color: var(--pc-error); margin: 0.125rem 0 0; }

.field-input {
  width: 100%;
  padding: 0.125rem 0.0625rem 0.25rem;
  border: none;
  border-bottom: 1.5px solid var(--pc-cream-line);
  border-radius: 0;
  background: transparent;
  color: var(--pc-ink);
  font-family: var(--font-script);
  font-weight: 500;
  font-size: clamp(0.8125rem, 3.4vw, 1.1875rem);
  transition: border-color 150ms ease;
  box-sizing: border-box;
}
.field-input:focus { outline: none; border-color: var(--pc-accent); }
.field-input--error { border-color: var(--pc-error) !important; }
.field-input::placeholder { color: var(--pc-ink-muted); opacity: 0.5; }

/* ── Status text ─────────────────────────────────────────────────────────── */
.status-text { font-size: clamp(0.75rem, 2.8vw, 0.9375rem); color: var(--color-muted); margin: 0; }

/* ── Persistent record area ──────────────────────────────────────────────── */
.record-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(0.375rem, 1.8vw, 0.875rem);
  width: 100%;
}

/* ── Record button — a small tactile ink-outlined dot, stamped onto the
   paper rather than a modern app control ──────────────────────────────── */
.record-btn {
  width: clamp(38px, 11vw, 64px);
  height: clamp(38px, 11vw, 64px);
  border-radius: 999px;
  border: 1.5px solid var(--pc-ink);
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, opacity 150ms ease;
}
.record-btn:focus-visible { outline: 3px solid var(--pc-accent); outline-offset: 3px; }
.record-btn:active { opacity: 0.8; }

.record-btn--idle {
  background: transparent;
  color: var(--pc-accent);
}
.record-btn--idle:hover {
  border-color: var(--pc-accent);
  color: var(--pc-accent);
}

.record-btn--requesting {
  background: transparent;
  border-color: var(--pc-ink-muted);
  color: var(--pc-ink-muted);
  opacity: 0.6;
  cursor: default;
}

.record-btn--recording {
  background: var(--pc-accent);
  border-color: var(--pc-accent);
  color: var(--pc-cream);
}
.record-btn--recording:hover { opacity: 0.85; }

.btn-icon { width: clamp(14px, 3.6vw, 24px); height: clamp(14px, 3.6vw, 24px); }

.record-hint { font-size: clamp(0.5625rem, 2vw, 0.8125rem); color: var(--color-muted); margin: 0; line-height: 1.3; }

/* ── Recording status — small ink dot + label, next to the timer ──────────── */
.recording-status {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-family: var(--font-serif);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-size: clamp(0.625rem, 2.2vw, 0.8125rem);
  color: var(--pc-accent);
}
.recording-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--pc-accent);
  animation: recording-pulse 1.4s ease-in-out infinite;
}
@keyframes recording-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .recording-dot { animation: none; }
}

/* ── Timer ───────────────────────────────────────────────────────────────── */
.timer {
  font-size: clamp(1.25rem, 5.5vw, 2rem);
  font-weight: 300;
  letter-spacing: -0.01em;
  color: var(--color-text);
  line-height: 1;
}

/* ── Warnings ────────────────────────────────────────────────────────────── */
.silence-warning {
  font-size: 0.8125rem;
  padding: 8px 14px;
  border-radius: 3px;
  background: var(--color-accent-dim);
  color: var(--color-text);
  border: 1px solid var(--accent-terracotta);
  max-width: 24rem;
  text-align: center;
}
.long-notice { font-size: 0.8125rem; color: var(--color-muted); text-align: center; margin: 0; }

/* ── Preview — "Voice note recorded", styled to match the postcard card ───── */
.preview-header { display: flex; flex-direction: column; gap: 0.125rem; }
.preview-title {
  font-family: var(--font-script);
  font-weight: 700;
  color: var(--pc-ink);
  font-size: clamp(1.125rem, 5vw, 1.75rem);
  margin: 0;
}
.preview-meta {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: clamp(0.6875rem, 2.6vw, 0.9375rem);
  color: var(--pc-ink-muted);
  margin: 0;
}
.preview-player {
  width: 100%;
  max-width: 20rem;
  height: clamp(32px, 8vw, 40px);
  border-radius: 3px;
  border: 1px solid var(--pc-cream-line);
}
.preview-actions { display: flex; gap: 0.625rem; flex-wrap: wrap; justify-content: center; }

/* ── Section title (uploading / success / error) ─────────────────────────── */
.section-title {
  font-family: var(--font-display);
  font-size: 1.75rem; font-weight: 600; margin: 0; text-align: center;
}

/* ── Progress bar ────────────────────────────────────────────────────────── */
.progress-bar-wrap {
  width: 100%; max-width: 20rem; height: 8px;
  background: var(--color-border); border-radius: 3px; overflow: hidden;
}
.progress-bar {
  height: 100%; background: var(--color-accent); border-radius: 3px;
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
  border-radius: 3px;
  background: var(--color-bg-subtle);
  display: flex; flex-direction: column;
  gap: 0.625rem; margin: 0.75rem 0 0; color: var(--color-text);
}
.error-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }

/* ── Overlays ────────────────────────────────────────────────────────────── */
.orphan-overlay,
.confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  padding: 1.25rem; z-index: 100;
}
.orphan-card,
.confirm-card {
  background: var(--surface-card); border: 1px solid var(--color-border);
  border-radius: 3px; padding: 1.75rem;
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
  padding: 0.625rem 1.25rem; border-radius: 3px;
  font-family: var(--font-body), sans-serif; font-size: 0.9375rem; font-weight: 500;
  cursor: pointer; border: 1.5px solid transparent;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, opacity 150ms ease;
  min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
}
.btn:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
.btn:active { opacity: 0.85; }

.btn--primary { background: var(--color-accent); color: var(--surface-page); border-color: var(--color-accent); }
.btn--primary:hover { background: var(--accent-terracotta-dim); border-color: var(--accent-terracotta-dim); }

.btn--ghost { background: transparent; color: var(--color-text); border-color: var(--color-border); }
.btn--ghost:hover { background: var(--color-bg-subtle); border-color: var(--color-text); }

.btn--danger { background: var(--accent-terracotta); color: var(--surface-page); border-color: var(--accent-terracotta); }
.btn--danger:hover { background: var(--accent-terracotta-dim); border-color: var(--accent-terracotta-dim); }

/* ── Utilities ───────────────────────────────────────────────────────────── */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
</style>
