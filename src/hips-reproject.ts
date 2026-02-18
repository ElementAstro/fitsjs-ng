import type { HiPSInterpolation, ReprojectOptions } from './hips-types'
import type { LinearWCS } from './hips-wcs'
import { tilePixelLonLat } from './hips-wcs'
import type { HiPSTileMeta } from './hips-types'

export interface ReprojectSource {
  width: number
  height: number
  depth: number
  planes: Float64Array[]
  wcs: LinearWCS
  blankValue?: number
}

function getValue(
  plane: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  blankValue: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return blankValue
  return plane[y * width + x] ?? blankValue
}

function nearestSample(
  plane: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  blankValue: number,
): number {
  return getValue(plane, width, height, Math.round(x), Math.round(y), blankValue)
}

function bilinearSample(
  plane: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  blankValue: number,
): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const tx = x - x0
  const ty = y - y0

  const v00 = getValue(plane, width, height, x0, y0, Number.NaN)
  const v10 = getValue(plane, width, height, x1, y0, Number.NaN)
  const v01 = getValue(plane, width, height, x0, y1, Number.NaN)
  const v11 = getValue(plane, width, height, x1, y1, Number.NaN)

  let acc = 0
  let wsum = 0
  const pairs: Array<[number, number]> = [
    [v00, (1 - tx) * (1 - ty)],
    [v10, tx * (1 - ty)],
    [v01, (1 - tx) * ty],
    [v11, tx * ty],
  ]

  for (const [value, weight] of pairs) {
    if (!Number.isFinite(value)) continue
    acc += value * weight
    wsum += weight
  }

  if (wsum === 0) return blankValue
  return acc / wsum
}

function cubic1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
  const c = -0.5 * p0 + 0.5 * p2
  return ((a * t + b) * t + c) * t + p1
}

function bicubicSample(
  plane: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  blankValue: number,
): number {
  const xBase = Math.floor(x)
  const yBase = Math.floor(y)
  const tx = x - xBase
  const ty = y - yBase

  const rows = new Float64Array(4)
  for (let m = -1; m <= 2; m++) {
    const samples = new Float64Array(4)
    for (let n = -1; n <= 2; n++) {
      samples[n + 1] = getValue(plane, width, height, xBase + n, yBase + m, Number.NaN)
    }
    if ([samples[0], samples[1], samples[2], samples[3]].some((v) => !Number.isFinite(v))) {
      return bilinearSample(plane, width, height, x, y, blankValue)
    }
    rows[m + 1] = cubic1D(samples[0]!, samples[1]!, samples[2]!, samples[3]!, tx)
  }

  return cubic1D(rows[0]!, rows[1]!, rows[2]!, rows[3]!, ty)
}

export function samplePlane(
  plane: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  interpolation: HiPSInterpolation,
  blankValue: number,
): number {
  if (interpolation === 'nearest') {
    return nearestSample(plane, width, height, x, y, blankValue)
  }
  if (interpolation === 'bicubic') {
    return bicubicSample(plane, width, height, x, y, blankValue)
  }
  return bilinearSample(plane, width, height, x, y, blankValue)
}

export function reprojectToHiPSTile(
  source: ReprojectSource,
  meta: HiPSTileMeta,
  tileWidth: number,
  options: ReprojectOptions = {},
): Float32Array {
  const blankValue = options.blankValue ?? source.blankValue ?? Number.NaN
  const interpolation = options.interpolation ?? 'bilinear'
  const planeLength = tileWidth * tileWidth
  const output = new Float32Array(planeLength * source.depth)

  for (let y = 0; y < tileWidth; y++) {
    for (let x = 0; x < tileWidth; x++) {
      const { lon, lat } = tilePixelLonLat(meta, x, y, tileWidth)
      const inPixel = source.wcs.worldToPixel(lon, lat)
      for (let z = 0; z < source.depth; z++) {
        const plane = source.planes[z]!
        const value = samplePlane(
          plane,
          source.width,
          source.height,
          inPixel.x,
          inPixel.y,
          interpolation,
          blankValue,
        )
        output[z * planeLength + y * tileWidth + x] = value
      }
    }
  }

  return output
}

export function downsampleTile(
  data: Float32Array,
  width: number,
  depth: number,
  mode: 'mean' | 'nearest' = 'mean',
): Float32Array {
  const outWidth = Math.max(1, Math.floor(width / 2))
  const out = new Float32Array(outWidth * outWidth * depth)
  const srcPlaneLen = width * width
  const dstPlaneLen = outWidth * outWidth

  for (let z = 0; z < depth; z++) {
    const srcBase = z * srcPlaneLen
    const dstBase = z * dstPlaneLen
    for (let y = 0; y < outWidth; y++) {
      for (let x = 0; x < outWidth; x++) {
        const sx = x * 2
        const sy = y * 2
        if (mode === 'nearest') {
          out[dstBase + y * outWidth + x] = data[srcBase + sy * width + sx] ?? Number.NaN
          continue
        }
        let acc = 0
        let count = 0
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const v = data[srcBase + (sy + dy) * width + (sx + dx)]
            if (v !== undefined && Number.isFinite(v)) {
              acc += v
              count++
            }
          }
        }
        out[dstBase + y * outWidth + x] = count > 0 ? acc / count : Number.NaN
      }
    }
  }

  return out
}
