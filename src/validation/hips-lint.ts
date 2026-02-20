import { parseHiPSTilePath } from '../hips/hips-path'
import { HiPS } from '../hips'
import type { HiPSInput } from '../hips/hips-types'

export interface HiPSLintIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface HiPSLintReport {
  ok: boolean
  issues: HiPSLintIssue[]
}

function isUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value)
}

async function lintLocalStructure(root: string): Promise<HiPSLintIssue[]> {
  const issues: HiPSLintIssue[] = []
  const fs = await import('node:fs/promises')
  const pathApi = await import('node:path')

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = pathApi.join(dir, entry.name)
      const relative = pathApi.relative(root, full).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }

      if (relative === 'properties' || relative === 'Moc.fits' || relative === 'index.html') {
        continue
      }
      if (/^Norder\d+\/Allsky\.(fits|png|jpg)$/iu.test(relative)) {
        continue
      }
      if (relative.startsWith('Norder')) {
        const parsed = parseHiPSTilePath(relative)
        if (!parsed) {
          issues.push({
            level: 'warning',
            code: 'UNRECOGNIZED_TILE_NAME',
            message: `Unrecognized tile file path pattern: ${relative}`,
            path: relative,
          })
        }
      }
    }
  }

  await walk(root)
  return issues
}

async function lintLocalStructureWithProperties(
  root: string,
  properties: Awaited<ReturnType<HiPS['getProperties']>>,
): Promise<HiPSLintIssue[]> {
  const issues: HiPSLintIssue[] = []
  const fs = await import('node:fs/promises')
  const pathApi = await import('node:path')
  const maxOrderRaw = properties.get('hips_order')
  const maxOrder = maxOrderRaw !== undefined ? Number(maxOrderRaw) : undefined
  const dataproduct = properties.get('dataproduct_type')
  const allowedFormats = new Set(
    (properties.get('hips_tile_format') ?? 'fits')
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((fmt) => (fmt === 'jpg' ? 'jpeg' : fmt)),
  )
  let tileCount = 0

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = pathApi.join(dir, entry.name)
      const relative = pathApi.relative(root, full).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }

      if (relative === 'properties' || relative === 'Moc.fits' || relative === 'index.html') {
        continue
      }
      const allsky = /^Norder(\d+)\/Allsky\.(fits|png|jpg)$/iu.exec(relative)
      if (allsky) {
        const order = Number(allsky[1])
        const format = allsky[2]?.toLowerCase() === 'jpg' ? 'jpeg' : allsky[2]?.toLowerCase()
        if (order !== 3) {
          issues.push({
            level: 'warning',
            code: 'ALLSKY_ORDER_UNEXPECTED',
            message: `Allsky should be generated at Norder3, found Norder${order}`,
            path: relative,
          })
        }
        if (format && allowedFormats.size > 0 && !allowedFormats.has(format)) {
          issues.push({
            level: 'warning',
            code: 'ALLSKY_FORMAT_UNDECLARED',
            message: `Allsky format ${format} is not listed in hips_tile_format`,
            path: relative,
          })
        }
        continue
      }
      if (relative.startsWith('Norder')) {
        const parsed = parseHiPSTilePath(relative)
        if (!parsed) {
          issues.push({
            level: 'warning',
            code: 'UNRECOGNIZED_TILE_NAME',
            message: `Unrecognized tile file path pattern: ${relative}`,
            path: relative,
          })
        } else {
          tileCount++
          if (Number.isInteger(maxOrder) && parsed.order > (maxOrder as number)) {
            issues.push({
              level: 'warning',
              code: 'TILE_ORDER_EXCEEDS_MAX',
              message: `Tile order ${parsed.order} exceeds hips_order=${maxOrder}`,
              path: relative,
            })
          }
          if (allowedFormats.size > 0 && !allowedFormats.has(parsed.format)) {
            issues.push({
              level: 'warning',
              code: 'TILE_FORMAT_UNDECLARED',
              message: `Tile format ${parsed.format} is not listed in hips_tile_format`,
              path: relative,
            })
          }
          if (dataproduct === 'cube' && parsed.spectralOrder === undefined) {
            issues.push({
              level: 'warning',
              code: 'CUBE_TILE_PATTERN_EXPECTED',
              message: 'Cube dataproduct expects spectral tile naming pattern',
              path: relative,
            })
          }
          if (dataproduct !== 'cube' && parsed.spectralOrder !== undefined) {
            issues.push({
              level: 'warning',
              code: 'UNEXPECTED_CUBE_TILE_PATTERN',
              message: 'Found spectral tile naming in non-cube dataset',
              path: relative,
            })
          }
        }
      }
    }
  }

  await walk(root)
  if (tileCount === 0) {
    issues.push({
      level: 'warning',
      code: 'NO_TILES_FOUND',
      message: 'No valid HiPS tile files were discovered',
    })
  }
  return issues
}

export async function lintHiPS(source: HiPSInput): Promise<HiPSLintReport> {
  const hips = new HiPS(source)
  const issues: HiPSLintIssue[] = []

  try {
    const properties = await hips.getProperties()
    const validation = properties.validate()
    for (const key of validation.missing) {
      issues.push({
        level: 'error',
        code: 'MISSING_PROPERTY',
        message: `Required property is missing: ${key}`,
        path: 'properties',
      })
    }
    for (const issue of validation.invalid) {
      issues.push({
        level: 'error',
        code: 'INVALID_PROPERTY',
        message: `Invalid property value: ${issue}`,
        path: 'properties',
      })
    }
    for (const warning of validation.warnings) {
      issues.push({
        level: 'warning',
        code: 'PROPERTY_WARNING',
        message: warning,
        path: 'properties',
      })
    }

    if (
      !(await hips
        .readAllsky()
        .then(() => true)
        .catch(() => false))
    ) {
      issues.push({
        level: 'warning',
        code: 'ALLSKY_MISSING',
        message: 'No Allsky file found in declared formats',
      })
    }

    let hasMoc = false
    if (typeof source === 'object' && source !== null && 'exists' in source) {
      hasMoc = await source.exists('Moc.fits')
    } else if (typeof source === 'string' && !isUrl(source)) {
      try {
        const fs = await import('node:fs/promises')
        const pathApi = await import('node:path')
        await fs.access(pathApi.join(source, 'Moc.fits'))
        hasMoc = true
      } catch {
        hasMoc = false
      }
    } else if (typeof source === 'string' && isUrl(source)) {
      try {
        const response = await fetch(
          new URL('Moc.fits', `${source.replace(/\/+$/u, '')}/`).toString(),
          { method: 'HEAD' },
        )
        hasMoc = response.ok
      } catch {
        hasMoc = false
      }
    }
    if (!hasMoc) {
      issues.push({
        level: 'warning',
        code: 'MOC_MISSING',
        message: 'Moc.fits not found',
      })
    }
  } catch (error) {
    issues.push({
      level: 'error',
      code: 'PROPERTIES_READ_FAILED',
      message: `Unable to read properties: ${String(error)}`,
      path: 'properties',
    })
  }

  if (typeof source === 'string' && !isUrl(source)) {
    try {
      const properties = await new HiPS(source).getProperties()
      issues.push(...(await lintLocalStructureWithProperties(source, properties)))
    } catch {
      issues.push(...(await lintLocalStructure(source)))
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    issues,
  }
}
