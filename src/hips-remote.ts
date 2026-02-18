import type { HiPSCutoutOptions, HiPSRemoteOptions } from './hips-types'

const DEFAULT_ENDPOINT = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits'
const DEFAULT_ENDPOINT_FALLBACK = 'https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits'

function appendCutoutParams(url: URL, hipsId: string, cutout: HiPSCutoutOptions): void {
  url.searchParams.set('hips', hipsId)
  url.searchParams.set('width', String(cutout.width))
  url.searchParams.set('height', String(cutout.height))
  url.searchParams.set('format', cutout.format ?? 'fits')

  if (cutout.wcs) {
    url.searchParams.set('wcs', JSON.stringify(cutout.wcs))
  } else {
    url.searchParams.set('projection', cutout.projection ?? 'TAN')
    if (cutout.fov !== undefined) url.searchParams.set('fov', String(cutout.fov))
    if (cutout.ra !== undefined) url.searchParams.set('ra', String(cutout.ra))
    if (cutout.dec !== undefined) url.searchParams.set('dec', String(cutout.dec))
    if (cutout.coordsys) url.searchParams.set('coordsys', cutout.coordsys)
    if (cutout.rotationAngle !== undefined) {
      url.searchParams.set('rotation_angle', String(cutout.rotationAngle))
    }
  }
}

async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/fits,application/octet-stream,*/*',
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function requestHiPS2FITS(
  hipsId: string,
  cutout: HiPSCutoutOptions,
  options: HiPSRemoteOptions = {},
): Promise<ArrayBuffer> {
  const timeoutMs = options.timeoutMs ?? 25_000
  const endpoints = [
    options.endpoint ?? DEFAULT_ENDPOINT,
    options.endpointFallback ?? DEFAULT_ENDPOINT_FALLBACK,
  ]
  let lastError: unknown

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint)
      appendCutoutParams(url, hipsId, cutout)
      const response = await fetchWithTimeout(url, timeoutMs)
      if (!response.ok) {
        throw new Error(`hips2fits request failed (${response.status} ${response.statusText})`)
      }
      return await response.arrayBuffer()
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`hips2fits unavailable: ${String(lastError)}`)
}
