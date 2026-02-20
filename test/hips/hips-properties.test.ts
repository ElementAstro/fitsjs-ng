import { describe, expect, it } from 'vitest'
import { createDefaultHiPSProperties, HiPSProperties } from '../../src/hips/hips-properties'

describe('hips-properties', () => {
  it('parses and serializes properties', () => {
    const props = HiPSProperties.parse(`
creator_did = ivo://example/test
obs_title = My Survey
dataproduct_type = image
hips_version = 1.4
hips_frame = equatorial
hips_order = 5
hips_tile_width = 512
hips_tile_format = fits png
`)

    const text = props.toString()
    expect(text).toContain('creator_did')
    expect(props.get('obs_title')).toBe('My Survey')
    expect(props.validate().ok).toBe(true)
  })

  it('adds compatibility fields', () => {
    const props = createDefaultHiPSProperties({
      creatorDid: 'ivo://example/test',
      obsTitle: 'Survey',
      order: 3,
      tileWidth: 512,
      formats: ['fits'],
    })
    expect(props.get('coordsys')).toBe('equatorial')
    expect(props.get('maxOrder')).toBe('3')
    expect(props.get('format')).toBe('fits')
  })

  it('reports missing required keys', () => {
    const props = HiPSProperties.fromObject({
      obs_title: 'X',
    })
    const report = props.validate()
    expect(report.ok).toBe(false)
    expect(report.missing).toContain('creator_did')
  })

  it('validates cube-specific keys and order constraints', () => {
    const props = HiPSProperties.fromObject({
      creator_did: 'ivo://example/cube',
      obs_title: 'Cube Survey',
      dataproduct_type: 'cube',
      hips_version: '1.4',
      hips_frame: 'equatorial',
      hips_order: 3,
      hips_order_min: 4,
      hips_tile_width: 500,
      hips_tile_format: 'fits',
    })

    const report = props.validate()
    expect(report.ok).toBe(false)
    expect(report.missing).toContain('hips_cube_depth')
    expect(report.invalid.some((item) => item.includes('hips_order_min'))).toBe(true)
    expect(report.warnings.some((item) => item.includes('power of two'))).toBe(true)
  })
})
