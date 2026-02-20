import { describe, expect, it } from 'vitest'
import {
  createDocument,
  getChildrenByName,
  getFirstChildByName,
  getNodeName,
  getXISFNamespace,
  parseXISFXML,
  serializeXML,
} from '../../src/xisf/xisf-xml'
import { XISFValidationError } from '../../src/xisf/xisf-errors'

describe('xisf/xisf-xml', () => {
  it('creates, serializes, and parses a valid XISF document', () => {
    const doc = createDocument()
    const root = doc.documentElement
    const metadata = doc.createElement('Metadata')
    root.appendChild(metadata)

    const xml = serializeXML(doc)
    const parsed = parseXISFXML(xml)
    expect(getXISFNamespace()).toBe('http://www.pixinsight.com/xisf')
    expect(getNodeName(parsed.documentElement)).toBe('xisf')
    expect(getChildrenByName(parsed.documentElement, 'Metadata')).toHaveLength(1)
    expect(getFirstChildByName(parsed.documentElement, 'Metadata')).not.toBeNull()
  })

  it('rejects XML with invalid root element', () => {
    expect(() => parseXISFXML('<root version="1.0" />')).toThrowError(XISFValidationError)
  })
})
