/**
 * Probe MediaRecorder MIME type support in preference order.
 * Returns the first supported type, or null to let the browser choose.
 * Always read recorder.mimeType after construction to get the actual type.
 * Resolves F11.
 */

const PREFERRED_TYPES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
]

/** @returns {string | null} */
export function probeMimeType() {
  if (typeof window === 'undefined' || !window.MediaRecorder) return null
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return null
}

/** Derive a file extension from recorder.mimeType (NOT the requested type). */
export function extensionFromMime(mimeType) {
  if (!mimeType) return 'audio'
  if (mimeType.startsWith('audio/webm')) return 'webm'
  if (mimeType.startsWith('audio/mp4'))  return 'mp4'
  if (mimeType.startsWith('audio/ogg'))  return 'ogg'
  if (mimeType.startsWith('audio/wav'))  return 'wav'
  const match = mimeType.match(/audio\/([a-z0-9]+)/)
  return match ? match[1] : 'audio'
}
