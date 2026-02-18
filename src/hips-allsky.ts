import { nside2npix, order2nside } from '@hscmap/healpix'
import type { HiPSTileFormat } from './hips-types'
import { encodeHiPSTile } from './hips-tile'

export interface AllskyGrid {
  order: number
  tileWidth: number
  depth: number
  width: number
  height: number
  cols: number
  rows: number
  data: Float32Array
}

function layout(npix: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(npix))
  const rows = Math.ceil(npix / cols)
  return { cols, rows }
}

export function assembleAllsky(
  order: number,
  tileWidth: number,
  depth: number,
  tiles: Map<number, Float32Array>,
): AllskyGrid {
  const npix = nside2npix(order2nside(order))
  const { cols, rows } = layout(npix)
  const width = cols * tileWidth
  const height = rows * tileWidth
  const data = new Float32Array(width * height * depth)
  data.fill(Number.NaN)

  const tilePixels = tileWidth * tileWidth
  for (let ipix = 0; ipix < npix; ipix++) {
    const tile = tiles.get(ipix)
    if (!tile) continue
    const row = Math.floor(ipix / cols)
    const col = ipix % cols
    for (let z = 0; z < depth; z++) {
      const srcBase = z * tilePixels
      const dstBase = z * width * height
      for (let y = 0; y < tileWidth; y++) {
        const dy = row * tileWidth + y
        for (let x = 0; x < tileWidth; x++) {
          const dx = col * tileWidth + x
          data[dstBase + dy * width + dx] = tile[srcBase + y * tileWidth + x] ?? Number.NaN
        }
      }
    }
  }

  return { order, tileWidth, depth, width, height, cols, rows, data }
}

export function splitAllsky(allsky: AllskyGrid): Map<number, Float32Array> {
  const npix = nside2npix(order2nside(allsky.order))
  const out = new Map<number, Float32Array>()
  const tilePixels = allsky.tileWidth * allsky.tileWidth
  for (let ipix = 0; ipix < npix; ipix++) {
    const row = Math.floor(ipix / allsky.cols)
    const col = ipix % allsky.cols
    const tile = new Float32Array(tilePixels * allsky.depth)
    for (let z = 0; z < allsky.depth; z++) {
      const srcBase = z * allsky.width * allsky.height
      const dstBase = z * tilePixels
      for (let y = 0; y < allsky.tileWidth; y++) {
        const sy = row * allsky.tileWidth + y
        for (let x = 0; x < allsky.tileWidth; x++) {
          const sx = col * allsky.tileWidth + x
          tile[dstBase + y * allsky.tileWidth + x] =
            allsky.data[srcBase + sy * allsky.width + sx] ?? Number.NaN
        }
      }
    }
    out.set(ipix, tile)
  }
  return out
}

export function encodeAllsky(
  order: number,
  format: HiPSTileFormat,
  frame: 'equatorial' | 'galactic' | 'ecliptic',
  tileWidth: number,
  depth: number,
  tiles: Map<number, Float32Array>,
): Uint8Array {
  const assembled = assembleAllsky(order, tileWidth, depth, tiles)
  const side = Math.max(assembled.width, assembled.height)
  const square = new Float32Array(side * side * depth)
  square.fill(Number.NaN)
  for (let z = 0; z < depth; z++) {
    const srcBase = z * assembled.width * assembled.height
    const dstBase = z * side * side
    for (let y = 0; y < assembled.height; y++) {
      const srcRowStart = srcBase + y * assembled.width
      const dstRowStart = dstBase + y * side
      square.set(assembled.data.subarray(srcRowStart, srcRowStart + assembled.width), dstRowStart)
    }
  }
  return encodeHiPSTile(
    {
      order,
      ipix: 0,
      frame,
      format,
    },
    square,
    side,
    depth,
  )
}
