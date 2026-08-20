<template>
  <!--
    Displayed when the user is in an in-app browser (Instagram, Messenger, etc.)
    or when the browser lacks MediaRecorder / getUserMedia capability.

    Tone: helpful guidance, not a blocking error. Many users won't know what an
    in-app browser is — the copy names the specific app when possible.
  -->
  <div role="banner" aria-live="polite" class="iab-banner">
    <div class="iab-inner">
      <p class="iab-text">
        <span v-if="missingCapability">
          Recording isn't supported in this browser.
          Open this link in <strong>Safari</strong> or <strong>Chrome</strong> to leave your message.
        </span>
        <span v-else-if="appName">
          You're using the <strong>{{ appName }}</strong> browser, which doesn't allow microphone access.
          Open this link in <strong>Safari</strong> or <strong>Chrome</strong> to leave your message.
        </span>
        <span v-else>
          Recording may not work in this browser.
          Try opening in <strong>Safari</strong> or <strong>Chrome</strong>.
        </span>
      </p>

      <button
        class="iab-copy-btn"
        @click="copyLink"
        :aria-label="copied ? 'Link copied' : 'Copy link to clipboard'"
      >
        {{ copied ? 'Copied!' : 'Copy link' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  appName:          { type: String,  default: null },
  missingCapability:{ type: Boolean, default: false },
})

const copied = ref(false)

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2500)
  } catch {
    // Fallback: select the URL bar
    prompt('Copy this link and paste it in Safari or Chrome:', window.location.href)
  }
}
</script>

<style scoped>
.iab-banner {
  position: relative;
  z-index: 10;
  background: var(--color-accent-dim);
  border-bottom: 1px solid var(--accent-terracotta);
  padding: 10px 16px;
  width: 100%;
}

.iab-inner {
  max-width: 28rem;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.iab-text {
  flex: 1;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--color-text);
  margin: 0;
}

.iab-copy-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 3px;
  border: 1.5px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}

.iab-copy-btn:hover,
.iab-copy-btn:focus-visible {
  background: var(--color-accent);
  color: var(--surface-page);
  outline: none;
}

.iab-copy-btn:focus-visible {
  box-shadow: 0 0 0 3px var(--accent-terracotta-dim);
}
</style>
