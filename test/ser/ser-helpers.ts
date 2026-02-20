import { writeSER } from '../../src/ser/ser-writer'
import type { SERColorId } from '../../src/ser/ser-types'

export function makeFrameU8(
  width: number,
  height: number,
  channels: number,
  seed: number,
): Uint8Array {
  const out = new Uint8Array(width * height * channels)
  for (let i = 0; i < out.length; i++) {
    out[i] = (seed + i * 7) & 0xff
  }
  return out
}

export function makeFrameU16LE(
  width: number,
  height: number,
  channels: number,
  seed: number,
): Uint8Array {
  const out = new Uint8Array(width * height * channels * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < width * height * channels; i++) {
    view.setUint16(i * 2, (seed + i * 97) & 0xffff, true)
  }
  return out
}

export function buildSerSequence(params: {
  colorId: SERColorId
  width: number
  height: number
  pixelDepth: number
  frameCount: number
  littleEndian?: boolean
  luId?: number
  observer?: string
  instrument?: string
  telescope?: string
  withTimestamps?: boolean
}): { buffer: ArrayBuffer; frames: Uint8Array[]; timestamps?: bigint[] } {
  const channels = params.colorId >= 100 ? 3 : 1
  const frames: Uint8Array[] = []
  for (let i = 0; i < params.frameCount; i++) {
    if (params.pixelDepth <= 8) {
      frames.push(makeFrameU8(params.width, params.height, channels, 13 + i * 17))
    } else {
      frames.push(makeFrameU16LE(params.width, params.height, channels, 97 + i * 131))
    }
  }

  const timestamps = params.withTimestamps
    ? Array.from({ length: params.frameCount }, (_, i) => 638000000000000000n + BigInt(i) * 100000n)
    : undefined

  const buffer = writeSER({
    header: {
      colorId: params.colorId,
      width: params.width,
      height: params.height,
      pixelDepth: params.pixelDepth,
      littleEndian: params.littleEndian ?? true,
      luId: params.luId ?? 42,
      observer: params.observer ?? 'Observer',
      instrument: params.instrument ?? 'Instrument',
      telescope: params.telescope ?? 'Telescope',
      startTime: 638000000000000000n,
      startTimeUtc: 638000000000000000n,
    },
    frames,
    timestamps,
  })

  return { buffer, frames, timestamps }
}
