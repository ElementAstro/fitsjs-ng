import sha3Module from 'js-sha3'
import type { XISFChecksumSpec } from './xisf-types'
import { XISFChecksumError } from './xisf-errors'
import { importNodeModule } from '../core/runtime'

const sha3_256: (data: Uint8Array) => string = (
  sha3Module as unknown as { sha3_256: (data: Uint8Array) => string }
).sha3_256
const sha3_512: (data: Uint8Array) => string = (
  sha3Module as unknown as { sha3_512: (data: Uint8Array) => string }
).sha3_512

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

async function digestSubtle(algorithm: string, data: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digestInput = new Uint8Array(data.byteLength)
    digestInput.set(data)
    const digest = await crypto.subtle.digest(algorithm, digestInput)
    return toHex(digest)
  }

  const mod = await importNodeModule<{
    createHash(name: string): { update(data: Uint8Array): unknown; digest(enc: 'hex'): string }
  }>(
    'crypto',
    `XISF checksum ${algorithm} without WebCrypto`,
    'Enable WebCrypto or run in Node.js for checksum verification.',
  )

  const h = mod.createHash(algorithm.toLowerCase().replace('-', ''))
  h.update(data)
  return h.digest('hex')
}

export async function computeChecksum(
  data: Uint8Array,
  algorithm: XISFChecksumSpec['algorithm'],
): Promise<string> {
  const normalized = algorithm.toLowerCase()
  switch (normalized) {
    case 'sha1':
    case 'sha-1':
      return digestSubtle('SHA-1', data)
    case 'sha256':
    case 'sha-256':
      return digestSubtle('SHA-256', data)
    case 'sha512':
    case 'sha-512':
      return digestSubtle('SHA-512', data)
    case 'sha3-256':
      return sha3_256(data)
    case 'sha3-512':
      return sha3_512(data)
    default:
      throw new XISFChecksumError(`Unsupported checksum algorithm: ${algorithm}`)
  }
}

export async function verifyChecksum(data: Uint8Array, spec: XISFChecksumSpec): Promise<boolean> {
  const computed = await computeChecksum(data, spec.algorithm)
  return computed.toLowerCase() === spec.digest.toLowerCase()
}
