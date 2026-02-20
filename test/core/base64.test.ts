import { describe, expect, it, vi } from 'vitest'
import { base64ToBytes, bytesToBase64 } from '../../src/core/base64'

describe('core/base64', () => {
  it('round-trips bytes with platform encoders', () => {
    const payload = new Uint8Array([0, 1, 2, 3, 252, 253, 254, 255])
    const encoded = bytesToBase64(payload)
    expect(encoded).toBe('AAECA/z9/v8=')
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(payload))
  })

  it('supports pure-TS fallback when atob/btoa are unavailable', () => {
    const originalAtob = globalThis.atob
    const originalBtoa = globalThis.btoa
    vi.stubGlobal('atob', undefined)
    vi.stubGlobal('btoa', undefined)
    try {
      const payload = new TextEncoder().encode('fitsjs-ng base64 fallback')
      const encoded = bytesToBase64(payload)
      expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/u)
      expect(new TextDecoder().decode(base64ToBytes(encoded))).toBe('fitsjs-ng base64 fallback')
    } finally {
      vi.stubGlobal('atob', originalAtob)
      vi.stubGlobal('btoa', originalBtoa)
    }
  })

  it('decodes base64url-style payloads', () => {
    const text = new TextEncoder().encode('base64-url')
    const encoded = bytesToBase64(text)
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_')
      .replace(/=+$/u, '')
    expect(new TextDecoder().decode(base64ToBytes(encoded))).toBe('base64-url')
  })
})
