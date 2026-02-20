import { order2nside, pix2ang_nest, pixcoord2vec_nest, vec2ang } from '@hscmap/healpix'
import type { FITSHeaderCard } from '../fits/fits-writer'
import type { HiPSFrame, HiPSTileMeta, HiPSWCSDefinition } from './hips-types'

export interface LonLat {
  lon: number
  lat: number
}

export interface LinearWCS {
  definition: HiPSWCSDefinition
  pixelToWorld(x: number, y: number): LonLat
  worldToPixel(lon: number, lat: number): { x: number; y: number }
}

interface HeaderLike {
  getNumber(key: string, fallback?: number): number
  getString(key: string, fallback?: string): string
}

function wrap360(value: number): number {
  const wrapped = value % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function frameCTypes(frame: HiPSFrame): { ctype1: string; ctype2: string } {
  if (frame === 'galactic') return { ctype1: 'GLON-HPX', ctype2: 'GLAT-HPX' }
  if (frame === 'ecliptic') return { ctype1: 'ELON-HPX', ctype2: 'ELAT-HPX' }
  return { ctype1: 'RA---HPX', ctype2: 'DEC--HPX' }
}

export function inferFrameFromCType(ctype1: string, ctype2: string): HiPSFrame {
  const c1 = ctype1.toUpperCase()
  const c2 = ctype2.toUpperCase()
  if (c1.startsWith('GLON') || c2.startsWith('GLAT')) return 'galactic'
  if (c1.startsWith('ELON') || c2.startsWith('ELAT')) return 'ecliptic'
  return 'equatorial'
}

export function createLinearWCS(definition: HiPSWCSDefinition): LinearWCS {
  const crpix1 = definition.crpix1
  const crpix2 = definition.crpix2
  const crval1 = definition.crval1
  const crval2 = definition.crval2

  let cd11 = definition.cd11
  let cd12 = definition.cd12
  let cd21 = definition.cd21
  let cd22 = definition.cd22

  const hasCD = [cd11, cd12, cd21, cd22].every(
    (value) => typeof value === 'number' && Number.isFinite(value),
  )

  if (!hasCD) {
    const cdelt1 = Number.isFinite(definition.cdelt1) ? definition.cdelt1! : -1
    const cdelt2 = Number.isFinite(definition.cdelt2) ? definition.cdelt2! : 1
    const theta = ((definition.crota2 ?? 0) * Math.PI) / 180
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    cd11 = cdelt1 * cos
    cd12 = -cdelt2 * sin
    cd21 = cdelt1 * sin
    cd22 = cdelt2 * cos
  }

  const det = cd11! * cd22! - cd12! * cd21!
  if (Math.abs(det) < 1e-16) {
    throw new Error('WCS matrix is singular')
  }

  const inv11 = cd22! / det
  const inv12 = -cd12! / det
  const inv21 = -cd21! / det
  const inv22 = cd11! / det

  return {
    definition,
    pixelToWorld(x: number, y: number): LonLat {
      const dx = x + 1 - crpix1
      const dy = y + 1 - crpix2
      return {
        lon: wrap360(crval1 + cd11! * dx + cd12! * dy),
        lat: clamp(crval2 + cd21! * dx + cd22! * dy, -90, 90),
      }
    },
    worldToPixel(lon: number, lat: number): { x: number; y: number } {
      const dlon = ((lon - crval1 + 540) % 360) - 180
      const dlat = lat - crval2
      const dx = inv11 * dlon + inv12 * dlat
      const dy = inv21 * dlon + inv22 * dlat
      return {
        x: dx + crpix1 - 1,
        y: dy + crpix2 - 1,
      }
    },
  }
}

export function readLinearWCSFromHeader(header: HeaderLike): LinearWCS {
  return createLinearWCS({
    ctype1: header.getString('CTYPE1', 'RA---CAR'),
    ctype2: header.getString('CTYPE2', 'DEC--CAR'),
    crpix1: header.getNumber('CRPIX1', 1),
    crpix2: header.getNumber('CRPIX2', 1),
    crval1: header.getNumber('CRVAL1', 0),
    crval2: header.getNumber('CRVAL2', 0),
    cd11: header.getNumber('CD1_1', Number.NaN),
    cd12: header.getNumber('CD1_2', Number.NaN),
    cd21: header.getNumber('CD2_1', Number.NaN),
    cd22: header.getNumber('CD2_2', Number.NaN),
    cdelt1: header.getNumber('CDELT1', Number.NaN),
    cdelt2: header.getNumber('CDELT2', Number.NaN),
    crota2: header.getNumber('CROTA2', 0),
  })
}

export function readWCSFromCards(cards: Record<string, string | number>): LinearWCS {
  const getNumber = (key: string, fallback: number): number => {
    const value = cards[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return fallback
  }
  const getString = (key: string, fallback: string): string => {
    const value = cards[key]
    return typeof value === 'string' ? value : fallback
  }
  return createLinearWCS({
    ctype1: getString('CTYPE1', 'RA---TAN'),
    ctype2: getString('CTYPE2', 'DEC--TAN'),
    crpix1: getNumber('CRPIX1', 1),
    crpix2: getNumber('CRPIX2', 1),
    crval1: getNumber('CRVAL1', 0),
    crval2: getNumber('CRVAL2', 0),
    cd11: getNumber('CD1_1', Number.NaN),
    cd12: getNumber('CD1_2', Number.NaN),
    cd21: getNumber('CD2_1', Number.NaN),
    cd22: getNumber('CD2_2', Number.NaN),
    cdelt1: getNumber('CDELT1', Number.NaN),
    cdelt2: getNumber('CDELT2', Number.NaN),
    crota2: getNumber('CROTA2', 0),
  })
}

export function estimateOrderFromImageResolution(
  width: number,
  height: number,
  tileWidth: number,
): number {
  const maxDim = Math.max(width, height)
  const order = Math.max(0, Math.ceil(Math.log2(Math.max(1, maxDim / tileWidth))))
  return Math.min(order, 13)
}

export function tilePixelLonLat(
  meta: HiPSTileMeta,
  x: number,
  y: number,
  tileWidth: number,
): LonLat {
  const nside = order2nside(meta.order)
  const ne = (x + 0.5) / tileWidth
  const nw = (y + 0.5) / tileWidth
  const [vx, vy, vz] = pixcoord2vec_nest(nside, meta.ipix, ne, nw)
  const { theta, phi } = vec2ang([vx, vy, vz])
  return { lon: (phi * 180) / Math.PI, lat: 90 - (theta * 180) / Math.PI }
}

export function tileCenterLonLat(meta: HiPSTileMeta): LonLat {
  const nside = order2nside(meta.order)
  const { theta, phi } = pix2ang_nest(nside, meta.ipix)
  return { lon: (phi * 180) / Math.PI, lat: 90 - (theta * 180) / Math.PI }
}

export function createHiPSTileHeader(
  meta: HiPSTileMeta,
  tileWidth: number,
  depth: number = 1,
): FITSHeaderCard[] {
  const nside = order2nside(meta.order)
  const { ctype1, ctype2 } = frameCTypes(meta.frame)
  const res = 45 / tileWidth / nside
  const center = tileCenterLonLat(meta)

  const cards: FITSHeaderCard[] = [
    { key: 'CTYPE1', value: ctype1 },
    { key: 'CTYPE2', value: ctype2 },
    { key: 'CRPIX1', value: tileWidth / 2 + 0.5 },
    { key: 'CRPIX2', value: tileWidth / 2 + 0.5 },
    { key: 'CRVAL1', value: center.lon },
    { key: 'CRVAL2', value: center.lat },
    { key: 'CD1_1', value: -res },
    { key: 'CD1_2', value: 0 },
    { key: 'CD2_1', value: 0 },
    { key: 'CD2_2', value: res },
    { key: 'ORDER', value: meta.order },
    { key: 'NPIX', value: meta.ipix },
    { key: 'NSIDE', value: nside },
    { key: 'ORDERING', value: 'NESTED' },
  ]

  if (meta.spectralOrder !== undefined) cards.push({ key: 'FORDER', value: meta.spectralOrder })
  if (meta.spectralIndex !== undefined) cards.push({ key: 'FPIX', value: meta.spectralIndex })
  if (depth > 1) cards.push({ key: 'NAXIS3', value: depth })

  return cards
}
