import { decode as decodePng, encode as encodePng } from 'fast-png'
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'
import { FITS } from '../fits'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../fits/fits-writer'
import { Image } from '../fits/image'
import { createHiPSTileHeader } from './hips-wcs'
import type { HiPSReadTileResult, HiPSTileMeta } from './hips-types'
import type { TypedArray } from '../core/types'

function finiteExtent(values: Float32Array | Float64Array): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) return [min, min + 1]
  return [min, max]
}

function floatToBytePlane(values: Float32Array | Float64Array): Uint8Array {
  const [min, max] = finiteExtent(values)
  const scale = max === min ? 0 : 255 / (max - min)
  const out = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    if (!Number.isFinite(value)) {
      out[i] = 0
      continue
    }
    const normalized = Math.max(0, Math.min(255, Math.round((value - min) * scale)))
    out[i] = normalized
  }
  return out
}

function byteToFloatPlane(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) out[i] = values[i]!
  return out
}

function toFloat32(values: ArrayLike<number | bigint>): Float32Array {
  if (values instanceof Float32Array) return values
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    out[i] = Number(values[i] ?? Number.NaN)
  }
  return out
}

function ensureUint8(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
  ) {
    return data.buffer
  }
  return data.slice().buffer
}

function rgbaToGray(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Float32Array {
  const out = new Float32Array(width * height)
  if (channels === 1) {
    for (let i = 0; i < out.length; i++) out[i] = data[i] ?? 0
    return out
  }
  for (let i = 0; i < out.length; i++) {
    const base = i * channels
    const r = data[base] ?? 0
    const g = data[base + 1] ?? r
    const b = data[base + 2] ?? r
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return out
}

export async function decodeHiPSTile(
  meta: HiPSTileMeta,
  tileData: Uint8Array | ArrayBuffer,
): Promise<HiPSReadTileResult> {
  const bytes = ensureUint8(tileData)
  if (meta.format === 'fits') {
    const fits = FITS.fromArrayBuffer(toArrayBuffer(bytes))
    const image = fits.getDataUnit()
    if (!(image instanceof Image)) {
      throw new Error('FITS tile does not contain image data')
    }
    const frames: TypedArray[] = []
    const depth = image.depth
    for (let i = 0; i < depth; i++) {
      frames.push(await image.getFrame(i))
    }
    const planeSize = image.width * image.height
    const combined = new Float32Array(planeSize * depth)
    for (let z = 0; z < depth; z++) {
      const frame = frames[z]!
      for (let i = 0; i < planeSize; i++)
        combined[z * planeSize + i] = Number(frame[i] ?? Number.NaN)
    }
    return {
      meta,
      width: image.width,
      height: image.height,
      depth,
      data: combined,
    }
  }

  if (meta.format === 'png') {
    const decoded = decodePng(bytes)
    const gray = rgbaToGray(
      decoded.data as Uint8Array,
      decoded.width,
      decoded.height,
      decoded.channels,
    )
    return {
      meta,
      width: decoded.width,
      height: decoded.height,
      depth: 1,
      data: gray,
    }
  }

  const decoded = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true })
  const gray = rgbaToGray(decoded.data as Uint8Array, decoded.width, decoded.height, 4)
  return {
    meta,
    width: decoded.width,
    height: decoded.height,
    depth: 1,
    data: gray,
  }
}

export function encodeHiPSTile(
  meta: HiPSTileMeta,
  pixels: Float32Array,
  tileWidth: number,
  depth: number,
): Uint8Array {
  const planeLength = tileWidth * tileWidth
  if (pixels.length !== planeLength * depth) {
    throw new Error(
      `Tile pixel length mismatch: got=${pixels.length} expected=${planeLength * depth}`,
    )
  }

  if (meta.format === 'fits') {
    const bytes = createImageBytesFromArray(pixels, -32)
    const cards = createHiPSTileHeader(meta, tileWidth, depth)
    const hdu = createImageHDU({
      primary: true,
      width: tileWidth,
      height: tileWidth,
      depth,
      bitpix: -32,
      data: bytes,
      additionalCards: cards,
    })
    return new Uint8Array(writeFITS([hdu]))
  }

  const bytePlane = floatToBytePlane(pixels.subarray(0, planeLength))
  if (meta.format === 'png') {
    return encodePng({
      width: tileWidth,
      height: tileWidth,
      depth: 8,
      channels: 1,
      data: bytePlane,
    })
  }

  const rgba = new Uint8Array(tileWidth * tileWidth * 4)
  for (let i = 0; i < bytePlane.length; i++) {
    const value = bytePlane[i]!
    const base = i * 4
    rgba[base] = value
    rgba[base + 1] = value
    rgba[base + 2] = value
    rgba[base + 3] = 255
  }
  const encoded = encodeJpeg(
    {
      width: tileWidth,
      height: tileWidth,
      data: rgba,
    },
    90,
  )
  return new Uint8Array(encoded.data)
}

export function convertTileFormat(
  source: HiPSReadTileResult,
  targetMeta: HiPSTileMeta,
): Uint8Array {
  const floatData = toFloat32(source.data)
  return encodeHiPSTile(targetMeta, floatData, source.width, source.depth)
}

export function grayByteTileToFloat(tileBytes: Uint8Array): Float32Array {
  return byteToFloatPlane(tileBytes)
}
