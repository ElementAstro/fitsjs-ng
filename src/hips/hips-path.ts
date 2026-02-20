import type { HiPSTileFormat, HiPSTileMeta } from './hips-types'

const FORMAT_EXTENSION: Record<HiPSTileFormat, string> = {
  fits: 'fits',
  png: 'png',
  jpeg: 'jpg',
}

export function formatToExtension(format: HiPSTileFormat): string {
  return FORMAT_EXTENSION[format]
}

export function extensionToFormat(extension: string): HiPSTileFormat | null {
  const normalized = extension.toLowerCase()
  if (normalized === 'fits') return 'fits'
  if (normalized === 'png') return 'png'
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpeg'
  return null
}

export function hipsDirIndex(ipix: number): number {
  if (!Number.isInteger(ipix) || ipix < 0) {
    throw new Error(`Invalid ipix: ${ipix}`)
  }
  return Math.floor(ipix / 10_000) * 10_000
}

export function hipsTilePath(meta: HiPSTileMeta): string {
  if (meta.spectralOrder !== undefined || meta.spectralIndex !== undefined) {
    const sOrder = meta.spectralOrder ?? 0
    const sIndex = meta.spectralIndex ?? 0
    const dir = `${hipsDirIndex(meta.ipix)}_${Math.floor(sIndex / 10) * 10}`
    return `Norder${meta.order}_${sOrder}/Dir${dir}/Npix${meta.ipix}_${sIndex}.${formatToExtension(meta.format)}`
  }
  return `Norder${meta.order}/Dir${hipsDirIndex(meta.ipix)}/Npix${meta.ipix}.${formatToExtension(meta.format)}`
}

export function hipsAllskyPath(format: HiPSTileFormat): string {
  return `Norder3/Allsky.${formatToExtension(format)}`
}

export function parseHiPSTilePath(path: string): HiPSTileMeta | null {
  const normalized = path.replaceAll('\\', '/')
  const cube = /^Norder(\d+)_(\d+)\/Dir(\d+)_(\d+)\/Npix(\d+)_(\d+)\.(\w+)$/i.exec(normalized)
  if (cube) {
    const format = extensionToFormat(cube[7]!)
    if (!format) return null
    return {
      order: Number(cube[1]),
      spectralOrder: Number(cube[2]),
      ipix: Number(cube[5]),
      spectralIndex: Number(cube[6]),
      frame: 'equatorial',
      format,
    }
  }

  const image = /^Norder(\d+)\/Dir(\d+)\/Npix(\d+)\.(\w+)$/i.exec(normalized)
  if (!image) return null
  const format = extensionToFormat(image[4]!)
  if (!format) return null
  return {
    order: Number(image[1]),
    ipix: Number(image[3]),
    frame: 'equatorial',
    format,
  }
}
