const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = new Int16Array(128).fill(-1)

for (let i = 0; i < BASE64_ALPHABET.length; i++) {
  BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(i)] = i
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    out += String.fromCharCode(...part)
  }
  return out
}

function binaryStringToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff
  }
  return out
}

function lookupBase64(code: number): number {
  if (code < 0 || code >= BASE64_LOOKUP.length) return -1
  return BASE64_LOOKUP[code] ?? -1
}

export function normalizeBase64(input: string): string {
  let normalized = input.replace(/\s+/gu, '').replace(/-/gu, '+').replace(/_/gu, '/')
  const remainder = normalized.length % 4
  if (remainder !== 0) {
    normalized = normalized.padEnd(normalized.length + (4 - remainder), '=')
  }
  return normalized
}

function encodeBase64Fallback(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const triple = (a << 16) | (b << 8) | c
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f]
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f]
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '='
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : '='
  }
  return out
}

function decodeBase64Fallback(input: string): Uint8Array {
  const normalized = normalizeBase64(input)
  if (normalized.length % 4 !== 0) {
    throw new Error('Invalid base64 payload length')
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  const out = new Uint8Array((normalized.length / 4) * 3 - padding)
  let oi = 0

  for (let i = 0; i < normalized.length; i += 4) {
    const c0 = normalized.charCodeAt(i)
    const c1 = normalized.charCodeAt(i + 1)
    const c2 = normalized.charCodeAt(i + 2)
    const c3 = normalized.charCodeAt(i + 3)

    const v0 = c0 < 128 ? lookupBase64(c0) : -1
    const v1 = c1 < 128 ? lookupBase64(c1) : -1
    const v2 = c2 === 61 ? -2 : c2 < 128 ? lookupBase64(c2) : -1
    const v3 = c3 === 61 ? -2 : c3 < 128 ? lookupBase64(c3) : -1

    if (v0 < 0 || v1 < 0 || v2 === -1 || v3 === -1) {
      throw new Error('Invalid base64 payload characters')
    }

    const sextet2 = v2 < 0 ? 0 : v2
    const sextet3 = v3 < 0 ? 0 : v3
    const triple = (v0 << 18) | (v1 << 12) | (sextet2 << 6) | sextet3

    out[oi++] = (triple >> 16) & 0xff
    if (v2 >= 0) out[oi++] = (triple >> 8) & 0xff
    if (v3 >= 0) out[oi++] = triple & 0xff
  }

  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    return btoa(bytesToBinaryString(bytes))
  }
  return encodeBase64Fallback(bytes)
}

export function base64ToBytes(input: string): Uint8Array {
  const normalized = normalizeBase64(input)
  if (typeof atob === 'function') {
    return binaryStringToBytes(atob(normalized))
  }
  return decodeBase64Fallback(normalized)
}
