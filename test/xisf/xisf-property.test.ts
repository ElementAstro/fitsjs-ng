import { describe, expect, it } from 'vitest'
import { createDocument } from '../../src/xisf/xisf-xml'
import { parseDataBlockAttributes, parsePropertyElement } from '../../src/xisf/xisf-property'
import { XISFValidationError } from '../../src/xisf/xisf-errors'

describe('xisf/xisf-property', () => {
  it('parses inline datablock attributes', () => {
    const doc = createDocument()
    const property = doc.createElement('Property')
    property.setAttribute('location', 'inline:base64')
    property.textContent = 'AQID'

    const block = parseDataBlockAttributes(property)
    expect(block?.location.type).toBe('inline')
    expect(block?.inlineData).toBe('AQID')
  })

  it('parses embedded datablock with data child', () => {
    const doc = createDocument()
    const property = doc.createElement('Property')
    property.setAttribute('location', 'embedded')
    const data = doc.createElement('Data')
    data.setAttribute('encoding', 'hex')
    data.textContent = '0A0B'
    property.appendChild(data)

    const block = parseDataBlockAttributes(property)
    expect(block?.location.type).toBe('embedded')
    expect(block?.embeddedData).toBe('0A0B')
  })

  it('rejects missing type in strict mode', async () => {
    const doc = createDocument()
    const property = doc.createElement('Property')
    await expect(
      parsePropertyElement(property, async () => new Uint8Array(0), { strictValidation: true }),
    ).rejects.toThrowError(XISFValidationError)
  })
})
