import { describe, expect, it } from 'vitest'
import type { HiPSExportTarget } from '../../src/hips/hips-types'
import { convertFitsToHiPS } from '../../src/hips/hips-build'

class MemoryTarget implements HiPSExportTarget {
  async writeBinary(_path: string, _data: Uint8Array | ArrayBuffer): Promise<void> {}
  async writeText(_path: string, _text: string): Promise<void> {}
  async readBinary(_path: string): Promise<Uint8Array> {
    throw new Error('not implemented')
  }
  async readText(_path: string): Promise<string> {
    throw new Error('not implemented')
  }
  async exists(_path: string): Promise<boolean> {
    return false
  }
}

describe('hips/hips-build', () => {
  it('throws when FITS input has no image HDU', async () => {
    await expect(
      convertFitsToHiPS(new ArrayBuffer(0), {
        output: new MemoryTarget(),
      }),
    ).rejects.toThrow('No image HDU found')
  })
})
