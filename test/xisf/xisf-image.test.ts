import { describe, expect, it } from 'vitest'
import { createDocument } from '../../src/xisf/xisf-xml'
import { parseImageElement } from '../../src/xisf/xisf-image'
import { XISFValidationError } from '../../src/xisf/xisf-errors'

describe('xisf/xisf-image', () => {
  it('rejects image without sampleFormat', async () => {
    const doc = createDocument()
    const image = doc.createElement('Image')
    image.setAttribute('geometry', '2:2:1')
    image.setAttribute('location', 'attachment:0:4')

    await expect(
      parseImageElement(
        image,
        () => null,
        async () => new Uint8Array([1, 2, 3, 4]),
        false,
        true,
      ),
    ).rejects.toThrowError(XISFValidationError)
  })

  it('parses a minimal valid image element', async () => {
    const doc = createDocument()
    const image = doc.createElement('Image')
    image.setAttribute('geometry', '2:2:1')
    image.setAttribute('sampleFormat', 'UInt8')
    image.setAttribute('location', 'attachment:0:4')

    const parsed = await parseImageElement(
      image,
      () => null,
      async () => new Uint8Array([1, 2, 3, 4]),
      false,
      true,
    )

    expect(parsed.sampleFormat).toBe('UInt8')
    expect(parsed.geometry).toEqual([2, 2])
    expect(parsed.channelCount).toBe(1)
    expect(parsed.data).toBeUndefined()
  })
})
