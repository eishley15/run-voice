/**
 * In-app browser detection. Capability check first, UA second.
 * Resolves F14.
 */

export function hasRecordingCapability() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    !!window.MediaRecorder
  )
}

export function detectInAppBrowser() {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Instagram/i.test(ua) || /FBAN/.test(ua) || /FBAV/.test(ua)) return 'Instagram'
  if (/Messenger/i.test(ua)) return 'Messenger'
  if (/\bLine\b/i.test(ua)) return 'LINE'
  if (/Twitter/i.test(ua))    return 'X (Twitter)'
  if (/TikTok/i.test(ua))     return 'TikTok'
  if (/Snapchat/i.test(ua))   return 'Snapchat'
  return null
}

/** @returns {{ show: boolean, missingCapability: boolean, appName: string | null }} */
export function getInAppBrowserStatus() {
  const capable = hasRecordingCapability()
  const appName = detectInAppBrowser()
  return {
    show: !capable || appName !== null,
    missingCapability: !capable,
    appName,
  }
}
