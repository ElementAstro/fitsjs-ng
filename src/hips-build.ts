import {
  ang2vec,
  max_pixrad,
  order2nside,
  pix2ang_nest,
  query_disc_inclusive_nest,
} from '@hscmap/healpix'
import { FITS } from './fits'
import { hipsAllskyPath, hipsTilePath } from './hips-path'
import { createDefaultHiPSProperties, HiPSProperties } from './hips-properties'
import { downsampleTile, reprojectToHiPSTile } from './hips-reproject'
import { encodeHiPSTile } from './hips-tile'
import type { ConvertFitsToHiPSOptions, FITSInput, HiPSBuildOptions } from './hips-types'
import { estimateOrderFromImageResolution, readLinearWCSFromHeader } from './hips-wcs'
import type { Image } from './image'

function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

function angularDistanceDeg(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const aLonRad = degToRad(aLon)
  const aLatRad = degToRad(aLat)
  const bLonRad = degToRad(bLon)
  const bLatRad = degToRad(bLat)
  const cosD =
    Math.sin(aLatRad) * Math.sin(bLatRad) +
    Math.cos(aLatRad) * Math.cos(bLatRad) * Math.cos(aLonRad - bLonRad)
  const clamped = Math.max(-1, Math.min(1, cosD))
  return (Math.acos(clamped) * 180) / Math.PI
}

function asArrayBuffer(input: ArrayBuffer | Blob): Promise<ArrayBuffer> | ArrayBuffer {
  if (input instanceof ArrayBuffer) return input
  return input.arrayBuffer()
}

async function parseInputFITS(input: FITSInput): Promise<FITS> {
  if (input instanceof FITS) return input
  return FITS.fromArrayBuffer(await asArrayBuffer(input))
}

function normalizeBuildOptions(options: HiPSBuildOptions): Required<
  Omit<HiPSBuildOptions, 'output' | 'propertiesOverrides'>
> & {
  propertiesOverrides?: Record<string, string>
} {
  return {
    title: options.title ?? 'fitsjs-ng HiPS dataset',
    creatorDid: options.creatorDid ?? 'ivo://fitsjs-ng/generated',
    hipsOrder: options.hipsOrder ?? 0,
    minOrder: options.minOrder ?? 0,
    tileWidth: options.tileWidth ?? 512,
    frame: options.frame ?? 'equatorial',
    formats: options.formats && options.formats.length > 0 ? options.formats : ['fits'],
    includeCompatibilityFields: options.includeCompatibilityFields ?? true,
    includeMoc: options.includeMoc ?? true,
    includeAllsky: options.includeAllsky ?? true,
    includeIndexHtml: options.includeIndexHtml ?? true,
    includeTreeTiles: options.includeTreeTiles ?? true,
    interpolation: options.interpolation ?? 'bilinear',
    blankValue: options.blankValue ?? Number.NaN,
    maxTilesPerOrder: options.maxTilesPerOrder ?? 200_000,
    propertiesOverrides: options.propertiesOverrides,
  }
}

function asFloat64(frame: ArrayLike<number | bigint>): Float64Array {
  if (frame instanceof Float64Array) return frame
  const out = new Float64Array(frame.length)
  for (let i = 0; i < frame.length; i++) out[i] = Number(frame[i] ?? Number.NaN)
  return out
}

function reduceToAllskyTile(
  tile: Float32Array,
  tileWidth: number,
  depth: number,
  targetWidth: number = 64,
): Float32Array {
  if (tileWidth <= targetWidth) return tile
  let current = tile
  let currentWidth = tileWidth
  while (currentWidth > targetWidth) {
    current = downsampleTile(current, currentWidth, depth, 'mean')
    currentWidth = Math.max(1, Math.floor(currentWidth / 2))
  }
  return current
}

async function createMocFitsFromTileCenters(
  coordsDeg: number[],
  order: number,
): Promise<Uint8Array> {
  if (coordsDeg.length === 0) {
    return new Uint8Array()
  }
  try {
    const moc = await import('@fxpineau/moc-wasm')
    const coverage = moc.MOC.fromCoo(Math.min(29, order), new Float64Array(coordsDeg))
    return coverage.toFits(true)
  } catch {
    return new Uint8Array()
  }
}

function makeIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body>
  <script src="https://aladin.cds.unistra.fr/hips-templates/hips-landing-page.js"></script>
  <script>buildLandingPage({alScriptURL:'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js'})</script>
</body>
</html>
`
}

function assertImageDataUnit(image: unknown): asserts image is Image {
  if (
    !image ||
    typeof image !== 'object' ||
    !('width' in image) ||
    !('height' in image) ||
    !('getFrame' in image)
  ) {
    throw new Error('FITS input does not contain an image data unit')
  }
}

export interface HiPSBuildResult {
  properties: HiPSProperties
  maxOrder: number
  minOrder: number
  generatedTiles: number
}

export async function buildHiPSFromFITS(
  input: FITSInput,
  options: HiPSBuildOptions,
): Promise<HiPSBuildResult> {
  const normalized = normalizeBuildOptions(options)
  const fits = await parseInputFITS(input)
  const hdu = fits.getHDU()
  if (!hdu?.data) {
    throw new Error('No image HDU found in FITS input')
  }
  assertImageDataUnit(hdu.data)

  const image = hdu.data
  const sourceWCS = readLinearWCSFromHeader(hdu.header)
  const depth = image.depth
  const planes: Float64Array[] = []
  for (let z = 0; z < depth; z++) {
    planes.push(asFloat64(await image.getFrame(z)))
  }

  const autoOrder = estimateOrderFromImageResolution(
    image.width,
    image.height,
    normalized.tileWidth,
  )
  const maxOrder = normalized.hipsOrder > 0 ? normalized.hipsOrder : autoOrder
  const minOrder = Math.max(0, Math.min(normalized.minOrder, maxOrder))
  const firstOrder = normalized.includeTreeTiles ? minOrder : maxOrder

  const center = sourceWCS.pixelToWorld((image.width - 1) / 2, (image.height - 1) / 2)
  const corners = [
    sourceWCS.pixelToWorld(0, 0),
    sourceWCS.pixelToWorld(image.width - 1, 0),
    sourceWCS.pixelToWorld(0, image.height - 1),
    sourceWCS.pixelToWorld(image.width - 1, image.height - 1),
  ]
  let radiusDeg = 0
  for (const corner of corners) {
    radiusDeg = Math.max(
      radiusDeg,
      angularDistanceDeg(center.lon, center.lat, corner.lon, corner.lat),
    )
  }

  const tileCentersForMoc: number[] = []
  const order3AllskyTiles = new Map<number, Float32Array>()
  let generatedTiles = 0

  for (let order = firstOrder; order <= maxOrder; order++) {
    const nside = order2nside(order)
    const radiusRad = Math.min(Math.PI, degToRad(radiusDeg) + max_pixrad(nside))
    const centerVec = ang2vec(degToRad(90 - center.lat), degToRad(center.lon))
    const candidates: number[] = []
    query_disc_inclusive_nest(nside, centerVec, radiusRad, (ipix) => {
      candidates.push(ipix)
    })

    if (candidates.length > normalized.maxTilesPerOrder) {
      throw new Error(
        `Order ${order} would generate ${candidates.length} tiles, above maxTilesPerOrder=${normalized.maxTilesPerOrder}`,
      )
    }

    for (const ipix of candidates) {
      const tileMetaBase = {
        order,
        ipix,
        frame: normalized.frame,
      } as const

      const tile = reprojectToHiPSTile(
        {
          width: image.width,
          height: image.height,
          depth,
          planes,
          wcs: sourceWCS,
          blankValue: normalized.blankValue,
        },
        {
          ...tileMetaBase,
          format: 'fits',
        },
        normalized.tileWidth,
        {
          interpolation: normalized.interpolation,
          blankValue: normalized.blankValue,
        },
      )

      for (const format of normalized.formats) {
        if (depth > 1 && format !== 'fits') continue
        const encoded = encodeHiPSTile(
          {
            ...tileMetaBase,
            format,
          },
          tile,
          normalized.tileWidth,
          depth,
        )
        await options.output.writeBinary(
          hipsTilePath({
            ...tileMetaBase,
            format,
          }),
          encoded,
        )
      }

      generatedTiles++
      if (order === maxOrder && normalized.includeMoc) {
        const { theta, phi } = pix2ang_nest(nside, ipix)
        tileCentersForMoc.push((phi * 180) / Math.PI, 90 - (theta * 180) / Math.PI)
      }
      if (order === 3 && normalized.includeAllsky) {
        order3AllskyTiles.set(ipix, reduceToAllskyTile(tile, normalized.tileWidth, depth, 64))
      }
    }
  }

  const properties = createDefaultHiPSProperties({
    creatorDid: normalized.creatorDid,
    obsTitle: normalized.title,
    dataproductType: depth > 1 ? 'cube' : 'image',
    frame: normalized.frame,
    order: maxOrder,
    tileWidth: normalized.tileWidth,
    formats: normalized.formats,
    extras: normalized.propertiesOverrides,
  })
  properties.set('hips_order_min', minOrder)
  if (normalized.includeCompatibilityFields) {
    properties.withCompatibilityFields()
  }
  if (depth > 1) {
    properties
      .set('hips_cube_depth', depth)
      .set('hips_cube_firstframe', 0)
      .set('hips_allsky_restriction', 'non-fits allsky not generated for cube dataproduct')
  }
  await options.output.writeText('properties', properties.toString())

  if (normalized.includeAllsky && order3AllskyTiles.size > 0) {
    const allskyOrder = 3
    const allskyTileWidth = 64
    const npix = order2nside(allskyOrder)
    const totalTiles = 12 * npix * npix
    const cols = Math.ceil(Math.sqrt(totalTiles))
    const rows = Math.ceil(totalTiles / cols)
    const width = cols * allskyTileWidth
    const height = rows * allskyTileWidth
    const planeLen = width * height
    const allskyData = new Float32Array(planeLen * depth)
    allskyData.fill(Number.NaN)
    for (const [ipix, tile] of order3AllskyTiles.entries()) {
      const row = Math.floor(ipix / cols)
      const col = ipix % cols
      const srcPlaneLen = allskyTileWidth * allskyTileWidth
      for (let z = 0; z < depth; z++) {
        const srcBase = z * srcPlaneLen
        const dstBase = z * planeLen
        for (let y = 0; y < allskyTileWidth; y++) {
          const dy = row * allskyTileWidth + y
          for (let x = 0; x < allskyTileWidth; x++) {
            const dx = col * allskyTileWidth + x
            allskyData[dstBase + dy * width + dx] =
              tile[srcBase + y * allskyTileWidth + x] ?? Number.NaN
          }
        }
      }
    }

    for (const format of normalized.formats) {
      if (depth > 1 && format !== 'fits') continue
      const encoded = encodeHiPSTile(
        {
          order: allskyOrder,
          ipix: 0,
          frame: normalized.frame,
          format,
        },
        allskyData,
        width,
        depth,
      )
      await options.output.writeBinary(hipsAllskyPath(format), encoded)
    }
  }

  if (normalized.includeMoc) {
    const mocFits = await createMocFitsFromTileCenters(tileCentersForMoc, maxOrder)
    if (mocFits.byteLength > 0) {
      await options.output.writeBinary('Moc.fits', mocFits)
    }
  }

  if (normalized.includeIndexHtml) {
    await options.output.writeText('index.html', makeIndexHtml(normalized.title))
  }

  return {
    properties,
    maxOrder,
    minOrder,
    generatedTiles,
  }
}

export async function convertFitsToHiPS(
  input: FITSInput,
  options: ConvertFitsToHiPSOptions,
): Promise<HiPSBuildResult> {
  return buildHiPSFromFITS(input, options)
}
