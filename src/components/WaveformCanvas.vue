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
    <div class="waveform-clip">
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
/*
  Collapses via grid-template-rows (0fr → 1fr) instead of animating height
  directly — avoids per-frame layout thrash from a height transition.
  .waveform-clip is the required min-height:0 + overflow:hidden layer that
  makes the grid row actually clip during the transition.
*/
.waveform-wrap {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease;
}

/* Only takes up space once it's actually got something to show */
.waveform-wrap--active {
  grid-template-rows: 1fr;
}

.waveform-clip {
  position: relative;
  min-height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.waveform-canvas {
  width: 100%;
  height: clamp(24px, 7vw, 40px);
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
  font-family: var(--font-body), sans-serif;
}

@media (prefers-reduced-motion: reduce) {
  .waveform-canvas {
    /* Hide the animated canvas; show the level text instead */
    display: none;
  }
}
</style>
