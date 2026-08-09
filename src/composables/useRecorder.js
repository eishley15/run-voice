
/**
 * useRecorder
 *
 * Core recording state machine. Manages the full lifecycle:
 *   intro → requesting → recording → preview → uploading → success | error
 *
 * Key plan resolutions implemented here:
 *   F1  – timeslice start so chunks arrive incrementally (no single giant buffer)
 *   F2  – visibilitychange / pagehide graceful stop (iOS backgrounding)
 *   F4  – in-memory blob kept on upload failure for retry / local download
 *   F6  – explicit audioBitsPerSecond (32 kbps — clean for speech, small files)
 *   F8  – silence warning fires once in the first 10 s only
 *   F13 – duration measured with timestamps (audio.duration = Infinity for webm)
 *   F16 – minimum take length raised to 2 s
 *   F17 – re-record confirmation for takes > 30 s
 */

import { ref, readonly } from 'vue'
import { probeMimeType, extensionFromMime } from '../utils/mime.js'
import { buildFilename }                    from '../utils/filename.js'
import { useWaveform }                      from './useWaveform.js'
import { useIndexedDB }                     from './useIndexedDB.js'

// Runaway guard: stop at 30 min, soft notice at 10 min (plan §recording_flow)
const HARD_CEILING_MS  = 30 * 60 * 1000
const SOFT_NOTICE_MS   = 25 * 60 * 1000   // warn at 25 min — stops at 30
const SILENCE_WINDOW_MS = 10_000   // only warn in the first 10 s (F8)
const SILENCE_DELAY_MS  =  3_000   // warn after 3 continuous silent seconds
const MIN_DURATION_MS   =  2_000   // reject accidental taps (F16)
const CONFIRM_THRESHOLD =     30   // seconds above which re-record needs confirm (F17)

export function useRecorder() {
  // ── Reactive state ────────────────────────────────────────────────────────
  const state              = ref('intro')  // 'intro' | 'requesting' | 'recording' |
                                           // 'preview' | 'uploading' | 'success' | 'error'
  const errorType          = ref(null)     // 'NotAllowedError' | 'NotFoundError' | ...
  const displayName        = ref('')       // contributor-supplied name
  const elapsedMs          = ref(0)
  const silenceWarning     = ref(false)    // brief mic-dead warning during recording
  const longRecordingNotice = ref(false)   // "still recording" nudge at 10 min
  const postStopSilent     = ref(false)    // waveform never moved — shown at preview
  const confirmReRecord    = ref(false)    // show re-record confirm dialog

  // Immutable after recording ends:
  const recordingBlob      = ref(null)
  const recordingMimeType  = ref('')
  const recordingFilename  = ref('')
  const recordingDuration  = ref(0)        // seconds

  // ── Internal refs ─────────────────────────────────────────────────────────
  let stream        = null
  let recorder      = null
  let chunks        = []
  let startTime     = null
  let timerInterval = null
  let hardStopTimer = null
  let softNoticeTimer = null
  let silenceWarnTimer = null
  let peakLevel     = 0  // track peak across entire take

  const waveform = useWaveform()
  const idb      = useIndexedDB()

  // ── Visibilitychange / pagehide (F2: iOS backgrounding) ──────────────────
  function onVisibilityChange() {
    if (document.hidden && state.value === 'recording') {
      _gracefulStop('backgrounded')
    }
  }

  function onPageHide() {
    if (state.value === 'recording') {
      _gracefulStop('backgrounded')
    }
  }

  function _attachPageListeners() {
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
  }

  function _detachPageListeners() {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
  }

  // ── Timer ─────────────────────────────────────────────────────────────────
  function _startTimer() {
    startTime = Date.now()
    timerInterval = setInterval(() => {
      elapsedMs.value = Date.now() - startTime
      idb.updateDuration(elapsedMs.value).catch(() => {})
    }, 200)
  }

  function _stopTimer() {
    clearInterval(timerInterval)
    timerInterval = null
  }

  // ── Silence detection (F8: fires once in the first 10 s only) ────────────
  function _startSilenceWatch() {
    // Only arm the silence watcher for the first SILENCE_WINDOW_MS of recording
    const watchEnd = Date.now() + SILENCE_WINDOW_MS

    function check() {
      if (Date.now() > watchEnd) return  // window closed — never warn again
      if (waveform.currentLevel.value < waveform.SILENCE_THRESHOLD) {
        // Mic looks silent — set a timer; cancel it if level rises
        silenceWarnTimer = setTimeout(() => {
          // Re-check after the delay: are we still silent AND still in window?
          if (
            Date.now() <= watchEnd &&
            waveform.currentLevel.value < waveform.SILENCE_THRESHOLD
          ) {
            silenceWarning.value = true
          }
        }, SILENCE_DELAY_MS)
      } else {
        clearTimeout(silenceWarnTimer)
        silenceWarnTimer = null
        silenceWarning.value = false
      }
    }

    // Poll every 500 ms while inside the early window
    const watchInterval = setInterval(() => {
      if (Date.now() > watchEnd) {
        clearInterval(watchInterval)
        return
      }
      // Track peak for post-stop check
      if (waveform.currentLevel.value > peakLevel) {
        peakLevel = waveform.currentLevel.value
      }
      check()
    }, 500)

    // Also track peak continuously after the early window
    const peakInterval = setInterval(() => {
      if (state.value !== 'recording') {
        clearInterval(peakInterval)
        return
      }
      if (waveform.currentLevel.value > peakLevel) {
        peakLevel = waveform.currentLevel.value
      }
    }, 500)
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  function _cleanup() {
    _stopTimer()
    clearTimeout(hardStopTimer)
    clearTimeout(softNoticeTimer)
    clearTimeout(silenceWarnTimer)
    _detachPageListeners()
    waveform.stop()
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
    recorder = null
  }

  // ── Graceful stop (shared by user-stop and backgrounding) ─────────────────
  function _gracefulStop(reason) {
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()  // ondataavailable fires, then onstop fires
    // State transitions happen in onstop
  }

  // ── startRecording ─────────────────────────────────────────────────────────
  /**
   * Called from a click/tap handler. getUserMedia and AudioContext.resume()
   * must both happen while the user gesture is still active on iOS.
   *
   * @param {HTMLCanvasElement} canvas  The waveform canvas element
   */
  async function startRecording(canvas) {
    if (state.value !== 'intro') return

    state.value      = 'requesting'
    silenceWarning.value  = false
    longRecordingNotice.value = false
    postStopSilent.value = false
    peakLevel = 0
    chunks    = []

    // ── Phase A: Fire AudioContext synchronously (iOS gesture unlock) ──────
    // We create the context and call resume() BEFORE the first await so the
    // gesture context is still valid on iOS Safari.
    let audioCtx
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      if (audioCtx.state === 'suspended') audioCtx.resume()
    } catch (e) {
      console.warn('[recorder] AudioContext creation failed', e)
    }

    // ── Phase B: Request microphone ────────────────────────────────────────
    let liveStream
    try {
      liveStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // off: phone-call processing degrades voice quality
          noiseSuppression: false,  // off: makes voices sound robotic/tinny
          autoGainControl:  false,  // off: causes volume pumping artifacts
        },
      })
    } catch (err) {
      if (audioCtx) audioCtx.close().catch(() => {})
      state.value = 'error'
      errorType.value = err.name || 'UnknownError'
      return
    }

    stream = liveStream

    // ── Phase C: Wire waveform ─────────────────────────────────────────────
    // Await start() — it is now async so it can await AudioContext.resume()
    // before creating nodes. Not awaiting would let the first frames read
    // from a still-suspended context (all zeros → silence warning + no bars).
    // start() takes ownership of audioCtx and will close it in stop().
    await waveform.start(stream, canvas, audioCtx)
    audioCtx = null  // ownership transferred — don't double-close in error paths

    // ── Phase D: MediaRecorder ─────────────────────────────────────────────
    // Prefer the gain-boosted stream from the waveform GainNode pipeline.
    // Falls back to the raw mic stream if MediaStreamDestination isn't available.
    const recordStream = waveform.gainedStream.value || stream

    const probedType = probeMimeType()
    const recorderOptions = { audioBitsPerSecond: 128_000 }  // 128 kbps: clear quality for playback
    if (probedType) recorderOptions.mimeType = probedType

    try {
      recorder = new MediaRecorder(recordStream, recorderOptions)
    } catch {
      // Some browsers reject specific mimeType options — retry without
      try {
        recorder = new MediaRecorder(recordStream, { audioBitsPerSecond: 128_000 })
      } catch (err2) {
        _cleanup()
        state.value   = 'error'
        errorType.value = 'UnsupportedBrowser'
        return
      }
    }

    // Read back the actual mimeType — browser may have substituted (F11)
    const actualMime = recorder.mimeType || 'audio/webm'
    const ext        = extensionFromMime(actualMime)
    const { path }   = buildFilename(displayName.value, ext)

    recordingMimeType.value = actualMime
    recordingFilename.value = path

    // Persist session to IndexedDB before the first chunk arrives (F4 Layer 3)
    await idb.beginSession(actualMime)

    // ondataavailable: collect chunks + persist to IndexedDB (F1 timeslice)
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data)
        idb.appendChunk(e.data).catch(() => {})
      }
    }

    // onstop: assemble the final blob and transition to preview
    recorder.onstop = async () => {
      _cleanup()

      const stopTime = Date.now()
      const durationMs = stopTime - (startTime || stopTime)

      // Reject accidental taps under 2 s (F16)
      if (durationMs < MIN_DURATION_MS || chunks.length === 0) {
        recordingBlob.value = null
        elapsedMs.value     = 0
        state.value         = 'intro'
        await idb.clear()
        return
      }

      const blob = new Blob(chunks, { type: actualMime })
      recordingBlob.value     = blob
      recordingDuration.value = Math.round(durationMs / 1000)
      elapsedMs.value         = durationMs

      // Post-stop silence check: was the peak level always near zero?
      postStopSilent.value = peakLevel < waveform.SILENCE_THRESHOLD

      state.value = 'preview'
    }

    // Start recording with a 1-second timeslice (F1: incremental chunks)
    recorder.start(1000)
    _startTimer()
    _startSilenceWatch()
    _attachPageListeners()

    // Runaway guard: hard stop at 30 min (F safety_net)
    hardStopTimer = setTimeout(() => {
      if (state.value === 'recording') _gracefulStop('runaway-guard')
    }, HARD_CEILING_MS)

    // Soft notice at 10 min
    softNoticeTimer = setTimeout(() => {
      if (state.value === 'recording') longRecordingNotice.value = true
    }, SOFT_NOTICE_MS)

    state.value = 'recording'
  }

  // ── stopRecording ──────────────────────────────────────────────────────────
  function stopRecording() {
    if (state.value !== 'recording') return
    _gracefulStop('user')
  }

  // ── requestReRecord ────────────────────────────────────────────────────────
  function requestReRecord() {
    const durationSec = Math.round(elapsedMs.value / 1000)
    if (durationSec > CONFIRM_THRESHOLD) {
      confirmReRecord.value = true  // show confirmation dialog (F17)
    } else {
      _discardAndReset()
    }
  }

  function confirmDiscardReRecord() {
    confirmReRecord.value = false
    _discardAndReset()
  }

  function cancelReRecord() {
    confirmReRecord.value = false
  }

  function _discardAndReset() {
    // Revoke the object URL if the preview was already playing it
    recordingBlob.value     = null
    recordingDuration.value = 0
    elapsedMs.value         = 0
    postStopSilent.value    = false
    state.value             = 'intro'
    idb.clear().catch(() => {})
  }

  // ── setUploadState / setSuccess / setError ─────────────────────────────────
  function setUploading() { state.value = 'uploading' }
  function setSuccess()   {
    state.value = 'success'
    idb.clear().catch(() => {})
  }
  function setError(type) {
    errorType.value = type
    state.value     = 'error'
  }

  function retryFromError() {
    errorType.value = null
    state.value     = 'intro'
  }

  // ── Restore an orphaned recording from IndexedDB ───────────────────────────
  async function restoreOrphan(orphan) {
    recordingBlob.value     = orphan.blob
    recordingMimeType.value = orphan.mimeType
    recordingDuration.value = Math.round(orphan.durationMs / 1000)
    elapsedMs.value         = orphan.durationMs

    const ext  = extensionFromMime(orphan.mimeType)
    const { path } = buildFilename(displayName.value, ext)
    recordingFilename.value = path

    state.value = 'preview'
  }

  return {
    // State
    state: readonly(state),
    errorType: readonly(errorType),
    displayName,
    elapsedMs: readonly(elapsedMs),
    silenceWarning: readonly(silenceWarning),
    longRecordingNotice: readonly(longRecordingNotice),
    postStopSilent: readonly(postStopSilent),
    confirmReRecord: readonly(confirmReRecord),
    recordingBlob: readonly(recordingBlob),
    recordingMimeType: readonly(recordingMimeType),
    recordingFilename: readonly(recordingFilename),
    recordingDuration: readonly(recordingDuration),
    // Waveform (for WaveformCanvas component)
    waveformActive: waveform.isActive,
    waveformLevel:  waveform.currentLevel,
    // Actions
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
  }
}
