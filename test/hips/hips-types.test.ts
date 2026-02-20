import { describe, expect, it } from 'vitest'
import type { HiPSBuildOptions, HiPSTileMeta } from '../../src/hips/hips-types'

describe('hips/hips-types', () => {
  it('keeps key public type contracts valid at compile time', () => {
    const tile: HiPSTileMeta = {
      order: 0,
      ipix: 0,
      frame: 'equatorial',
      format: 'fits',
    }
    expect(tile.order).toBe(0)
  })

  it('allows build options shape used by exporters', () => {
    const options = {
      output: {
        async writeBinary() {},
        async writeText() {},
        async readBinary() {
          return new Uint8Array(0)
        },
        async readText() {
          return ''
        },
        async exists() {
          return false
        },
      },
      tileWidth: 64,
    } satisfies HiPSBuildOptions

    expect(options.tileWidth).toBe(64)
  })
})
