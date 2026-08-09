
/**
 * useUpload
 *
 * Handles the upload of a recorded Blob to Supabase Storage via the tus
 * resumable upload protocol, and inserts a metadata row into run_messages.
 *
 * Plan resolutions:
 *   F3 – real byte-level progress + resumable transfer (tus protocol)
 *   F4 – Layer 1: keep blob in memory on failure for retry without re-recording
 *        Layer 2: local download fallback when uploads keep failing
 *   F5 – pre-upload file size check against bucket limit
 */

import { ref }       from 'vue'
import * as tus      from 'tus-js-client'
import { supabase, BUCKET, TUS_ENDPOINT } from '../utils/supabase.js'

// Set the bucket max to 200 MB — at 32 kbps, that covers ~13+ hours.
// Adjust to match what you actually configure in the Supabase dashboard.
const MAX_FILE_BYTES = 200 * 1024 * 1024

export function useUpload() {
  const progress      = ref(0)     // 0–100
  const bytesUploaded = ref(0)
  const bytesTotal    = ref(0)
  const uploading     = ref(false)
  const uploadError   = ref(null)  // null | string

  let tusUpload  = null
  let _retryBlob = null  // kept in memory for Layer 1 retry (F4)

  /**
   * Upload a recorded Blob to Supabase Storage, then insert a metadata row.
   *
   * @param {Blob}   blob          The recorded audio blob
   * @param {string} filename      Storage path (e.g. "20260812T140322Z__name__abc123.webm")
   * @param {string} mimeType      e.g. "audio/webm;codecs=opus"
   * @param {string} displayName   Original (unsanitized) contributor name
   * @param {number} durationSec   Recording duration in seconds
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async function upload(blob, filename, mimeType, displayName, durationSec) {
    // ── F5: Pre-upload size check ──────────────────────────────────────────
    if (blob.size > MAX_FILE_BYTES) {
      const mb = (blob.size / 1024 / 1024).toFixed(1)
      return {
        ok: false,
        error: `Your recording is ${mb} MB, which exceeds the upload limit. Please try a shorter message.`,
      }
    }

    _retryBlob   = blob  // keep for Layer 1 retry
    uploading.value   = true
    uploadError.value = null
    progress.value    = 0
    bytesUploaded.value = 0
    bytesTotal.value    = blob.size

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    return new Promise((resolve) => {
      tusUpload = new tus.Upload(blob, {
        endpoint: TUS_ENDPOINT,

        // Retry on transient failures — 0 ms, then 1s, 3s, 5s
        retryDelays: [0, 1000, 3000, 5000],

        headers: {
          Authorization: `Bearer ${anonKey}`,
          'x-upsert': 'false',  // never overwrite; explicit (F12)
        },

        // Supabase-specific tus metadata
        metadata: {
          bucketName:   BUCKET,
          objectName:   filename,
          contentType:  mimeType,
          cacheControl: '3600',
        },

        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,

        onError(err) {
          console.error('[upload] tus error', err)
          uploading.value   = false
          uploadError.value = err.message || 'Upload failed. Please try again.'
          resolve({ ok: false, error: uploadError.value })
        },

        onProgress(uploaded, total) {
          bytesUploaded.value = uploaded
          bytesTotal.value    = total || blob.size
          progress.value = total
            ? Math.round((uploaded / total) * 100)
            : 0
        },

        async onSuccess() {
          // Insert metadata row — fire but don't block success on it
          try {
            await supabase.from('run_messages').insert({
              display_name:     displayName || 'anonymous',
              file_path:        filename,
              duration_seconds: durationSec,
              mime_type:        mimeType,
            })
          } catch (metaErr) {
            // Non-fatal: the audio file is already uploaded
            console.warn('[upload] metadata insert failed', metaErr)
          }

          uploading.value    = false
          progress.value     = 100
          _retryBlob         = null
          resolve({ ok: true })
        },
      })

      tusUpload.start()
    })
  }

  /**
   * Layer 1 retry (F4): reuse the blob from the failed upload without re-recording.
   * Returns the same Promise shape as upload().
   */
  async function retry(filename, mimeType, displayName, durationSec) {
    if (!_retryBlob) return { ok: false, error: 'No recording to retry.' }
    return upload(_retryBlob, filename, mimeType, displayName, durationSec)
  }

  /** Abort an in-flight upload. */
  function abort() {
    tusUpload?.abort().catch(() => {})
    uploading.value = false
  }

  /**
   * Layer 2 local download fallback (F4):
   * Let the contributor save the file to their device so they can send it another
   * way if uploads keep failing. Uses the same blob already held in memory.
   */
  function downloadLocally(blob, filename) {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download  = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return {
    progress,
    bytesUploaded,
    bytesTotal,
    uploading,
    uploadError,
    upload,
    retry,
    abort,
    downloadLocally,
  }
}
