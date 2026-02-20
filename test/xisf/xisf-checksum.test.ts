import { describe, expect, it, vi } from 'vitest'
import { computeChecksum, verifyChecksum } from '../../src/xisf/xisf-checksum'
import { XISFChecksumError } from '../../src/xisf/xisf-errors'

describe('xisf-checksum', () => {
  const payload = new TextEncoder().encode('fitsjs-ng-checksum')

  it('computes supported checksum algorithms and verifies digests', async () => {
    const cases: Array<
      [
        algorithm:
          | 'sha1'
          | 'sha-1'
          | 'sha256'
          | 'sha-256'
          | 'sha512'
          | 'sha-512'
          | 'sha3-256'
          | 'sha3-512',
        expectedLength: number,
      ]
    > = [
      ['sha1', 40],
      ['sha-1', 40],
      ['sha256', 64],
      ['sha-256', 64],
      ['sha512', 128],
      ['sha-512', 128],
      ['sha3-256', 64],
      ['sha3-512', 128],
    ]

    for (const [algorithm, expectedLength] of cases) {
      const digest = await computeChecksum(payload, algorithm)
      expect(digest).toHaveLength(expectedLength)
      expect(await verifyChecksum(payload, { algorithm, digest })).toBe(true)
      expect(await verifyChecksum(payload, { algorithm, digest: `${digest.slice(0, -1)}0` })).toBe(
        false,
      )
    }
  })

  it('falls back to node:crypto when subtle crypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', undefined)
    try {
      const digest = await computeChecksum(payload, 'sha-256')
      expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })

  it('rejects unsupported checksum algorithms', async () => {
    await expect(computeChecksum(payload, 'crc32' as never)).rejects.toBeInstanceOf(
      XISFChecksumError,
    )
  })
})
