import type { FITS } from './fits'
import type { TypedArray } from './types'
import type { ConversionOptions, XISFReadOptions, XISFWriteOptions } from './xisf-types'

export type HiPSFrame = 'equatorial' | 'galactic' | 'ecliptic'
export type HiPSTileFormat = 'fits' | 'png' | 'jpeg'
export type HiPSDataproductType = 'image' | 'cube'
export type HiPSInterpolation = 'nearest' | 'bilinear' | 'bicubic'
export type HiPSBackend = 'local' | 'remote' | 'auto'
export type HiPSMapOrdering = 'NESTED' | 'RING'

export interface HiPSTileMeta {
  order: number
  ipix: number
  frame: HiPSFrame
  format: HiPSTileFormat
  spectralOrder?: number
  spectralIndex?: number
}

export interface HiPSWCSDefinition {
  ctype1: string
  ctype2: string
  crpix1: number
  crpix2: number
  crval1: number
  crval2: number
  cd11?: number
  cd12?: number
  cd21?: number
  cd22?: number
  cdelt1?: number
  cdelt2?: number
  crota2?: number
}

export interface ReprojectOptions {
  interpolation?: HiPSInterpolation
  blankValue?: number
}

export interface HiPSExportTarget {
  writeBinary(path: string, data: Uint8Array | ArrayBuffer): Promise<void>
  writeText(path: string, text: string): Promise<void>
  readBinary(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  finalize?(): Promise<unknown>
}

export interface HiPSBuildOptions extends ReprojectOptions {
  output: HiPSExportTarget
  title?: string
  creatorDid?: string
  hipsOrder?: number
  minOrder?: number
  tileWidth?: number
  frame?: HiPSFrame
  formats?: HiPSTileFormat[]
  includeCompatibilityFields?: boolean
  includeMoc?: boolean
  includeAllsky?: boolean
  includeIndexHtml?: boolean
  includeTreeTiles?: boolean
  propertiesOverrides?: Record<string, string>
  maxTilesPerOrder?: number
}

export type FITSInput = ArrayBuffer | Blob | FITS

export interface HiPSCutoutOptions extends ReprojectOptions {
  width: number
  height: number
  projection?: string
  ra?: number
  dec?: number
  fov?: number
  coordsys?: 'icrs' | 'galactic'
  rotationAngle?: number
  wcs?: Record<string, string | number>
  format?: 'fits' | 'png' | 'jpeg'
  backend?: HiPSBackend
  hipsId?: string
}

export interface HiPSExportTileOptions {
  order: number
  ipix: number
  format?: HiPSTileFormat
}

export interface HiPSExportMapOptions {
  order?: number
  ordering?: HiPSMapOrdering
  columnName?: string
  frame?: HiPSFrame
}

export interface HiPSReadTileResult {
  meta: HiPSTileMeta
  width: number
  height: number
  depth: number
  data: TypedArray
}

export interface HiPSMapResult {
  order: number
  nside: number
  ordering: HiPSMapOrdering
  values: Float32Array
}

export interface HiPSRemoteOptions {
  endpoint?: string
  endpointFallback?: string
  timeoutMs?: number
}

export interface ConvertFitsToHiPSOptions extends HiPSBuildOptions {
  backend?: 'local'
}

export interface ConvertHiPSToFITSOptions extends HiPSRemoteOptions {
  output?: HiPSExportTarget
  backend?: HiPSBackend
  hipsId?: string
  tile?: HiPSExportTileOptions
  map?: HiPSExportMapOptions
  cutout?: HiPSCutoutOptions
}

export interface ConvertXisfToHiPSOptions extends ConvertFitsToHiPSOptions {
  imageIndex?: number
  xisfReadOptions?: XISFReadOptions
}

export interface ConvertHiPSToXisfOptions extends ConvertHiPSToFITSOptions {
  distributed?: boolean
  writeOptions?: XISFWriteOptions
  conversionOptions?: ConversionOptions
}

export type HiPSInput = string | URL | HiPSExportTarget | { root: string; propertiesPath?: string }
