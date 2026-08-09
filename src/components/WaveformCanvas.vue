<template>
  <!--
    Waveform placeholder space is always reserved so the layout never shifts
    when the waveform appears. aria-hidden because the live text status below
    carries the same information for screen readers.
  -->
  <div
    class="waveform-wrap"
    :class="{ 'waveform-wrap--active': active }"
    aria-hidden="true"
  >
    <canvas
      ref="canvasRef"
      class="waveform-canvas"
    />
    <!-- Reduced-motion fallback: a static level indicator that still updates -->
    <div
      v-if="reducedMotion && active"
      class="waveform-level-text"
      aria-hidden="true"
    >
      {{ levelLabel }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  /** Whether the waveform is currently live (recording in progress). */
  active: { type: Boolean, default: false },
  /** Current analyser level 0–255 (for reduced-motion fallback). */
  level:  { type: Number,  default: 0 },
})

const canvasRef    = ref(null)
const reducedMotion = ref(false)

let mql = null

onMounted(() => {
  mql = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mql.matches
  mql.addEventListener('change', onMqlChange)
})

onBeforeUnmount(() => {
  mql?.removeEventListener('change', onMqlChange)
})

function onMqlChange(e) {
  reducedMotion.value = e.matches
}

// A simple text label for the reduced-motion fallback
const levelLabel = computed(() => {
  const l = props.level
  if (l < 10)  return 'Listening…'
  if (l < 50)  return 'Low'
  if (l < 100) return 'Good'
  return 'Strong'
})

/**
 * Expose a method instead of the raw ref.
 * Vue 3.3+ auto-unwraps refs in defineExpose, so exposing canvasRef directly
 * makes the parent receive an HTMLCanvasElement where it expects a Ref —
 * accessing .value on it yields undefined. A plain function bypasses that.
 */
defineExpose({ getCanvas: () => canvasRef.value })
</script>

<style scoped>
.waveform-wrap {
  position: relative;
  width: 100%;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.waveform-canvas {
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0;
  transition: opacity 300ms ease;
}

.waveform-wrap--active .waveform-canvas {
  opacity: 1;
}

.waveform-level-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-accent);
  font-family: 'DM Sans', sans-serif;
}

@media (prefers-reduced-motion: reduce) {
  .waveform-canvas {
    /* Hide the animated canvas; show the level text instead */
    display: none;
  }
}
</style>
