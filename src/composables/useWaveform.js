
/**
 * useWaveform
 *
 * Drives the live frequency-bar waveform using an AudioContext AnalyserNode.
 * The waveform is the primary proof to contributors that their microphone
 * is actually capturing audio — permission granted ≠ audio reaching the recorder.
 *
 * Design decisions from the plan:
 *   - AudioContext created with NO forced sampleRate (resolves F18)
 *   - ctx.resume() called synchronously inside the user gesture (iOS unlock)
 *   - Frequency bars (getByteFrequencyData) rather than oscilloscope — reads
 *     more clearly as "listening" to a non-technical viewer
 *   - Throttled to ~30fps (resolves F9) — visually indistinguishable from 60fps
 *     for this component, saves battery on long recordings
 *   - Loop cancelled and context closed on stop to prevent orphaned rAF loops
 */

import { ref } from 'vue'

const BAR_COUNT           = 32    // visible bars; canvas width clips the rest
const MIN_BAR_HEIGHT_PX   = 3     // bars never collapse to zero (looks broken)
const FRAME_INTERVAL_MS   = 1000 / 30 // ~30fps cap
const SILENCE_THRESHOLD   = 12    // 0–255 frequency bin value
const GAIN_VALUE          = 1.8   // fixed boost for phone-far-from-mouth; no pumping

export function useWaveform() {
  const isActive        = ref(false)
  const currentLevel    = ref(0)   // 0–255 rolling average for silence detection
  const gainedStream    = ref(null) // MediaStream from GainNode → exposed for MediaRecorder

  let audioCtx   = null
  let analyser   = null
  let gainNode   = null
  let destNode   = null
  let source     = null
  let animId     = null
  let dataArray  = null
  let canvasEl   = null
  let lastFrameTs = 0

  /**
   * Start the waveform. Async so we can await AudioContext.resume() before
   * creating nodes — a suspended context returns all-zero frequency data.
   *
   * @param {MediaStream} stream  The live audio stream from getUserMedia
   * @param {HTMLCanvasElement} canvas
   * @param {AudioContext} [resumedCtx]  Already-gesture-unlocked context from
   *   useRecorder (iOS Safari won't resume a context created after an await).
   */
  async function start(stream, canvas, resumedCtx = null) {
    stop() // clean up any previous session

    canvasEl = canvas

    // Prefer the caller-supplied context (already gesture-unlocked on iOS).
    // Only create a fresh one as a fallback for non-iOS environments.
    if (resumedCtx && resumedCtx.state !== 'closed') {
      audioCtx = resumedCtx
    } else {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }

    // Await resume so the context is guaranteed running before we create nodes.
    // A suspended context feeds zeros to getByteFrequencyData — no bars, false
    // silence warnings. Fire-and-forget was the previous bug.
    if (audioCtx.state !== 'running') {
      try {
        await audioCtx.resume()
      } catch (e) {
        console.warn('[waveform] AudioContext resume failed', e)
      }
    }

    source   = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    gainNode = audioCtx.createGain()
    gainNode.gain.value = GAIN_VALUE

    // MediaStreamDestination captures the gained audio for MediaRecorder.
    // It is separate from ctx.destination (the speaker) so there is no feedback.
    destNode = audioCtx.createMediaStreamDestination()

    analyser.fftSize               = 256   // 128 frequency bins
    analyser.smoothingTimeConstant = 0.6   // calm, not jittery

    // source → gainNode → analyser (waveform reads the boosted signal)
    //                   → destNode (MediaRecorder reads the boosted stream)
    // Do NOT connect anything to ctx.destination — that routes to speaker → feedback.
    source.connect(gainNode)
    gainNode.connect(analyser)
    gainNode.connect(destNode)

    gainedStream.value = destNode.stream
    dataArray = new Uint8Array(analyser.frequencyBinCount)
    isActive.value = true

    scheduleFrame()
  }

  function scheduleFrame() {
    animId = requestAnimationFrame(drawFrame)
  }

  function drawFrame(ts) {
    if (!analyser || !canvasEl) return

    // Throttle to ~30fps
    if (ts - lastFrameTs < FRAME_INTERVAL_MS) {
      animId = requestAnimationFrame(drawFrame)
      return
    }
    lastFrameTs = ts

    // Pause rendering when the document is hidden (battery saver, pairs with F2)
    if (document.hidden) {
      animId = requestAnimationFrame(drawFrame)
      return
    }

    analyser.getByteFrequencyData(dataArray)

    // Compute a rolling average for silence detection
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
    currentLevel.value = Math.round(sum / dataArray.length)

    drawBars()
    animId = requestAnimationFrame(drawFrame)
  }

  function drawBars() {
    const canvas = canvasEl
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const w   = canvas.offsetWidth
    const h   = canvas.offsetHeight

    // Sync canvas buffer size to display size (sharp on retina / high-DPI)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width  = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }

    const ctx      = canvas.getContext('2d')
    const bufW     = canvas.width
    const bufH     = canvas.height

    ctx.clearRect(0, 0, bufW, bufH)

    const numBins  = dataArray.length
    const step     = Math.floor(numBins / BAR_COUNT)
    const barW     = Math.floor(bufW / BAR_COUNT)
    const gap      = Math.max(1, Math.floor(barW * 0.25))
    const netBarW  = barW - gap
    const centerY  = bufH / 2

    // Accent color — read from CSS custom property so it inherits design tokens
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent')
      .trim() || '#F76B15'

    ctx.fillStyle = accent

    for (let i = 0; i < BAR_COUNT; i++) {
      // Average the frequency bins assigned to this bar
      let binSum = 0
      for (let j = 0; j < step; j++) {
        binSum += dataArray[i * step + j] || 0
      }
      const binAvg   = binSum / step
      const fraction = binAvg / 255

      // Half-height of the bar (mirrors above and below the center line)
      const halfH    = Math.max(MIN_BAR_HEIGHT_PX, Math.round(fraction * centerY * 0.85))
      const x        = i * barW + Math.floor(gap / 2)

      ctx.beginPath()
      // roundRect is Safari 15.4+ / Chrome 99+. Fall back to rect() for older
      // iOS Safari where roundRect throws a TypeError and silently aborts drawing.
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, centerY - halfH, netBarW, halfH * 2, 2)
      } else {
        ctx.rect(x, centerY - halfH, netBarW, halfH * 2)
      }
      ctx.fill()
    }
  }

  /**
   * Stop the waveform and release all audio resources.
   * Order matters: cancel the rAF loop before closing the context.
   */
  function stop() {
    if (animId !== null) {
      cancelAnimationFrame(animId)
      animId = null
    }
    isActive.value    = false
    currentLevel.value = 0

    // Disconnect nodes before closing to avoid console warnings
    try { source?.disconnect() }   catch { /* ignore */ }
    try { gainNode?.disconnect() } catch { /* ignore */ }
    try { analyser?.disconnect() } catch { /* ignore */ }
    try { destNode?.disconnect() } catch { /* ignore */ }

    // Close the AudioContext. On iOS, leaving it open keeps the audio session
    // active (battery drain, lock indicator).
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {})
    }

    gainedStream.value = null
    audioCtx  = null
    analyser  = null
    gainNode  = null
    destNode  = null
    source    = null
    dataArray = null
    canvasEl  = null
    lastFrameTs = 0
  }

  return {
    isActive,
    currentLevel,
    gainedStream,
    SILENCE_THRESHOLD,
    start,
    stop,
  }
}
