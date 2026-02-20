import { describe, expect, it } from 'vitest'
import { convertHiPSToFITS } from '../../src/hips/hips-export'

describe('hips/hips-export', () => {
  it('requires hipsId for remote backend cutout', async () => {
    await expect(
      convertHiPSToFITS('https://example.com/hips', {
        backend: 'remote',
        cutout: {
          width: 16,
          height: 16,
          backend: 'remote',
        },
      }),
    ).rejects.toThrow('hipsId is required when backend=remote')
  })
})
