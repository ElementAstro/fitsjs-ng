import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintHiPS } from '../../src/validation/hips-lint'

function minimalProperties(): string {
  return (
    [
      'creator_did = ivo://example/test',
      'obs_title = lint test',
      'dataproduct_type = image',
      'hips_version = 1.4',
      'hips_frame = equatorial',
      'hips_order = 0',
      'hips_tile_width = 512',
      'hips_tile_format = fits',
    ].join('\n') + '\n'
  )
}

describe('hips-lint', () => {
  it('detects local Moc.fits when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-lint-'))
    try {
      await writeFile(join(dir, 'properties'), minimalProperties(), 'utf8')
      await writeFile(join(dir, 'Moc.fits'), new Uint8Array([0x46, 0x49, 0x54, 0x53]))
      await mkdir(join(dir, 'Norder0', 'Dir0'), { recursive: true })
      await writeFile(join(dir, 'Norder0', 'Dir0', 'Npix0.fits'), new Uint8Array([0, 1, 2, 3]))

      const report = await lintHiPS(dir)
      const mocIssue = report.issues.find((issue) => issue.code === 'MOC_MISSING')
      expect(mocIssue).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports required-property violations as errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-lint-required-'))
    try {
      await writeFile(join(dir, 'properties'), 'hips_tile_format = fits\n', 'utf8')
      const report = await lintHiPS(dir)
      expect(report.ok).toBe(false)
      const missingIssues = report.issues.filter((issue) => issue.code === 'MISSING_PROPERTY')
      expect(missingIssues.length).toBeGreaterThan(0)
      expect(missingIssues.every((issue) => issue.level === 'error')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('warns on tile order/format mismatches against declared properties', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-lint-mismatch-'))
    try {
      await writeFile(join(dir, 'properties'), minimalProperties(), 'utf8')
      await mkdir(join(dir, 'Norder1', 'Dir0'), { recursive: true })
      await writeFile(join(dir, 'Norder1', 'Dir0', 'Npix0.png'), new Uint8Array([1, 2, 3]))

      const report = await lintHiPS(dir)
      const codes = new Set(report.issues.map((issue) => issue.code))
      expect(codes.has('TILE_ORDER_EXCEEDS_MAX')).toBe(true)
      expect(codes.has('TILE_FORMAT_UNDECLARED')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('warns when cube datasets use non-cube tile naming', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-lint-cube-'))
    try {
      await writeFile(
        join(dir, 'properties'),
        [
          'creator_did = ivo://example/cube',
          'obs_title = lint cube',
          'dataproduct_type = cube',
          'hips_version = 1.4',
          'hips_frame = equatorial',
          'hips_order = 0',
          'hips_tile_width = 512',
          'hips_tile_format = fits',
          'hips_cube_depth = 4',
          'hips_cube_firstframe = 0',
        ].join('\n') + '\n',
        'utf8',
      )
      await mkdir(join(dir, 'Norder0', 'Dir0'), { recursive: true })
      await writeFile(join(dir, 'Norder0', 'Dir0', 'Npix0.fits'), new Uint8Array([0, 1]))

      const report = await lintHiPS(dir)
      expect(report.issues.some((issue) => issue.code === 'CUBE_TILE_PATTERN_EXPECTED')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
