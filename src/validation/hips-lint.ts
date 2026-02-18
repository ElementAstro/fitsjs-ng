import { parseHiPSTilePath } from '../hips-path'
import { HiPS } from '../hips'
import type { HiPSInput } from '../hips-types'

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
    issues.push(...(await lintLocalStructure(source)))
  }

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    issues,
  }
}
