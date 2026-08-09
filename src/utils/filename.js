/**
 * Build storage filename: {iso_timestamp}__{sanitized_name}__{random6}.{ext}
 * Example: 2026-08-12T140322Z__tita_marissa__k7d2mq.mp4
 * Resolves F12.
 */

export function sanitizeName(name) {
  const result = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40)
  return result || 'anonymous'
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0')
}

function isoTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
}

/**
 * @param {string} displayName
 * @param {string} extension
 * @returns {{ path: string, sanitizedName: string }}
 */
export function buildFilename(displayName, extension) {
  const ts            = isoTimestamp()
  const sanitizedName = sanitizeName(displayName)
  const suffix        = randomSuffix()
  const path          = `${ts}__${sanitizedName}__${suffix}.${extension}`
  return { path, sanitizedName }
}
