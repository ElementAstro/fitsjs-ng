import { bit_combine, nside2npix, nest2ring, order2nside, za2tu } from '@hscmap/healpix'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../fits/fits-writer'
import { HiPS } from './'
import { samplePlane } from './hips-reproject'
import { requestHiPS2FITS } from './hips-remote'
import { encodeHiPSTile } from './hips-tile'
import type {
  ConvertHiPSToFITSOptions,
  HiPSCutoutOptions,
  HiPSInput,
  HiPSMapOrdering,
  HiPSMapResult,
  HiPSTileMeta,
} from './hips-types'
import { createLinearWCS, readWCSFromCards } from './hips-wcs'

function frameToCoordSys(frame: string): string {
  if (frame === 'galactic') return 'G'
  if (frame === 'ecliptic') return 'E'
  return 'C'
}

function wrap(value: number, modulo: number): number {
  return value < 0 ? modulo - (-value % modulo) : value % modulo
}

function clip(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function lonLatToNestedTileSample(
  order: number,
  tileWidth: number,
  lon: number,
  lat: number,
): {
  ipix: number
  x: number
  y: number
} {
  const theta = ((90 - lat) * Math.PI) / 180
  const phi = wrap((lon * Math.PI) / 180, 2 * Math.PI)
  const z = Math.cos(theta)
  const { t: tRaw, u: uRaw } = za2tu(z, phi)

  const pi4 = Math.PI / 4
  let t = tRaw / pi4
  let u = uRaw / pi4
  t = wrap(t, 8)
  t -= 4
  u += 5

  const pp = clip((u + t) / 2, 0, 5)
  const ppi = Math.floor(pp)
  const qq = clip((u - t) / 2, 3 - ppi, 6 - ppi)
  const qqi = Math.floor(qq)
  const v = 5 - (ppi + qqi)
  const h = ppi - qqi + 4
  const f = 4 * v + ((h >> 1) % 4)
  const p = pp - ppi
  const q = qq - qqi

  const nside = order2nside(order)
  const xFloat = nside * p
  const yFloat = nside * q
  const xInt = Math.max(0, Math.min(nside - 1, Math.floor(xFloat)))
  const yInt = Math.max(0, Math.min(nside - 1, Math.floor(yFloat)))
  const ipix = f * nside * nside + bit_combine(xInt, yInt)
  return {
    ipix,
    x: (xFloat - xInt) * tileWidth,
    y: (yFloat - yInt) * tileWidth,
  }
}

function buildCutoutWCS(cutout: HiPSCutoutOptions) {
  if (cutout.wcs) {
    return readWCSFromCards(
      Object.fromEntries(Object.entries(cutout.wcs).map(([k, v]) => [k.toUpperCase(), v])),
    )
  }
  const projection = (cutout.projection ?? 'TAN').toUpperCase()
  const half = Math.max(cutout.width, cutout.height)
  const fov = cutout.fov ?? 1
  const cdelt = fov / half
  return createLinearWCS({
    ctype1: `RA---${projection}`,
    ctype2: `DEC--${projection}`,
    crpix1: cutout.width / 2 + 0.5,
    crpix2: cutout.height / 2 + 0.5,
    crval1: cutout.ra ?? 0,
    crval2: cutout.dec ?? 0,
    cdelt1: -cdelt,
    cdelt2: cdelt,
    crota2: cutout.rotationAngle ?? 0,
  })
}

async function exportTileFITS(
  hips: HiPS,
  options: NonNullable<ConvertHiPSToFITSOptions['tile']>,
): Promise<ArrayBuffer> {
  const props = await hips.getProperties()
  const frame = (props.get('hips_frame') as HiPSTileMeta['frame']) ?? 'equatorial'
  const tile = await hips.readTile({
    order: options.order,
    ipix: options.ipix,
    frame,
    format: options.format,
  })
  const data = toFloat32Values(tile.data)
  const encoded = encodeHiPSTile(
    {
      order: options.order,
      ipix: options.ipix,
      frame,
      format: 'fits',
    },
    data,
    tile.width,
    tile.depth,
  )
  return encoded.slice().buffer
}

function encodeFloat32BigEndian(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(i * 4, values[i] ?? Number.NaN, false)
  }
  return out
}

function createPrimaryNoDataHDU() {
  return {
    cards: [
      { key: 'SIMPLE', value: true, comment: 'Standard FITS' },
      { key: 'BITPIX', value: 8, comment: 'Character data' },
      { key: 'NAXIS', value: 0, comment: 'No data in primary HDU' },
      { key: 'EXTEND', value: true, comment: 'Extensions may be present' },
    ],
  }
}

function toFloat32Values(input: ArrayLike<number | bigint>): Float32Array {
  if (input instanceof Float32Array) return input
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    out[i] = Number(input[i] ?? Number.NaN)
  }
  return out
}

function toFloat64Values(input: ArrayLike<number | bigint>): Float64Array {
  if (input instanceof Float64Array) return input
  const out = new Float64Array(input.length)
  for (let i = 0; i < input.length; i++) {
    out[i] = Number(input[i] ?? Number.NaN)
  }
  return out
}

async function exportMapFITS(
  hips: HiPS,
  options: NonNullable<ConvertHiPSToFITSOptions['map']>,
): Promise<{
  fits: ArrayBuffer
  map: HiPSMapResult
}> {
  const props = await hips.getProperties()
  const order = options.order ?? Number(props.get('hips_order') ?? 0)
  const frame = options.frame ?? (props.get('hips_frame') as HiPSTileMeta['frame']) ?? 'equatorial'
  const ordering: HiPSMapOrdering = options.ordering ?? 'NESTED'
  const nside = order2nside(order)
  const npix = nside2npix(nside)
  const values = new Float32Array(npix)
  values.fill(Number.NaN)

  for (let ipix = 0; ipix < npix; ipix++) {
    try {
      const tile = await hips.readTile({ order, ipix, frame })
      const array = tile.data
      let sum = 0
      let count = 0
      for (let i = 0; i < array.length; i++) {
        const value = Number(array[i] ?? Number.NaN)
        if (!Number.isFinite(value)) continue
        sum += value
        count++
      }
      const targetIpix = ordering === 'RING' ? nest2ring(nside, ipix) : ipix
      values[targetIpix] = count > 0 ? sum / count : Number.NaN
    } catch {
      continue
    }
  }

  const bytes = encodeFloat32BigEndian(values)
  const bintableHDU = {
    cards: [
      { key: 'XTENSION', value: 'BINTABLE', comment: 'HEALPix map table' },
      { key: 'BITPIX', value: 8 },
      { key: 'NAXIS', value: 2 },
      { key: 'NAXIS1', value: 4 },
      { key: 'NAXIS2', value: npix },
      { key: 'PCOUNT', value: 0 },
      { key: 'GCOUNT', value: 1 },
      { key: 'TFIELDS', value: 1 },
      { key: 'TTYPE1', value: options.columnName ?? 'SIGNAL' },
      { key: 'TFORM1', value: 'E' },
      { key: 'ORDERING', value: ordering },
      { key: 'INDXSCHM', value: 'IMPLICIT' },
      { key: 'NSIDE', value: nside },
      { key: 'FIRSTPIX', value: 0 },
      { key: 'LASTPIX', value: npix - 1 },
      { key: 'COORDSYS', value: frameToCoordSys(frame) },
    ],
    data: bytes,
  }
  return {
    fits: writeFITS([createPrimaryNoDataHDU(), bintableHDU]),
    map: { order, nside, ordering, values },
  }
}

async function sampleHiPS(
  hips: HiPS,
  lon: number,
  lat: number,
  order: number,
  tileWidth: number,
  frame: HiPSTileMeta['frame'],
  interpolation: NonNullable<HiPSCutoutOptions['interpolation']>,
  cache: Map<number, Float64Array>,
): Promise<number> {
  const sample = lonLatToNestedTileSample(order, tileWidth, lon, lat)
  const ipix = sample.ipix
  let tile = cache.get(ipix)
  if (!tile) {
    const decoded = await hips.readTile({ order, ipix, frame })
    tile = toFloat64Values(decoded.data)
    cache.set(ipix, tile)
  }
  return samplePlane(tile, tileWidth, tileWidth, sample.x, sample.y, interpolation, Number.NaN)
}

async function exportCutoutLocal(hips: HiPS, cutout: HiPSCutoutOptions): Promise<ArrayBuffer> {
  const props = await hips.getProperties()
  const frame = (props.get('hips_frame') as HiPSTileMeta['frame']) ?? 'equatorial'
  const order = Number(props.get('hips_order') ?? 0)
  const tileWidth = Number(props.get('hips_tile_width') ?? 512)
  const wcs = buildCutoutWCS(cutout)
  const values = new Float32Array(cutout.width * cutout.height)
  const cache = new Map<number, Float64Array>()
  const interpolation = cutout.interpolation ?? 'bilinear'

  for (let y = 0; y < cutout.height; y++) {
    for (let x = 0; x < cutout.width; x++) {
      const world = wcs.pixelToWorld(x, y)
      values[y * cutout.width + x] = await sampleHiPS(
        hips,
        world.lon,
        world.lat,
        order,
        tileWidth,
        frame,
        interpolation,
        cache,
      )
    }
  }

  const cards = [
    { key: 'CTYPE1', value: wcs.definition.ctype1 },
    { key: 'CTYPE2', value: wcs.definition.ctype2 },
    { key: 'CRPIX1', value: wcs.definition.crpix1 },
    { key: 'CRPIX2', value: wcs.definition.crpix2 },
    { key: 'CRVAL1', value: wcs.definition.crval1 },
    { key: 'CRVAL2', value: wcs.definition.crval2 },
    { key: 'CDELT1', value: wcs.definition.cdelt1 ?? -1 },
    { key: 'CDELT2', value: wcs.definition.cdelt2 ?? 1 },
    { key: 'HIPSORD', value: order },
    { key: 'HIPSFWID', value: tileWidth },
  ]
  const hdu = createImageHDU({
    primary: true,
    width: cutout.width,
    height: cutout.height,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: cards,
  })
  return writeFITS([hdu])
}

export async function convertHiPSToFITS(
  input: HiPSInput | HiPS,
  options: ConvertHiPSToFITSOptions = {},
): Promise<ArrayBuffer> {
  const hips = input instanceof HiPS ? input : new HiPS(input)
  const backend = options.backend ?? 'local'

  let output: ArrayBuffer
  if (options.tile) {
    output = await exportTileFITS(hips, options.tile)
  } else if (options.map) {
    output = (await exportMapFITS(hips, options.map)).fits
  } else {
    const cutout = options.cutout ?? {
      width: 512,
      height: 512,
      projection: 'TAN',
      ra: 0,
      dec: 0,
      fov: 1,
      backend: backend,
    }

    if (backend === 'remote') {
      if (!options.cutout?.hipsId && !options.hipsId) {
        throw new Error('hipsId is required when backend=remote')
      }
      output = await requestHiPS2FITS(options.cutout?.hipsId ?? options.hipsId!, cutout, options)
    } else if (backend === 'auto') {
      try {
        output = await exportCutoutLocal(hips, cutout)
      } catch (localError) {
        const hipsId = options.cutout?.hipsId ?? options.hipsId
        if (!hipsId) throw localError
        output = await requestHiPS2FITS(hipsId, cutout, options)
      }
    } else {
      output = await exportCutoutLocal(hips, cutout)
    }
  }

  if (options.output) {
    await options.output.writeBinary('output.fits', new Uint8Array(output))
  }

  return output
}
