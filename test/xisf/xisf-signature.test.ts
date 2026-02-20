import { describe, expect, it } from 'vitest'
import { createDocument } from '../../src/xisf/xisf-xml'
import { hasDetachedSignature } from '../../src/xisf/xisf-signature'

describe('xisf/xisf-signature', () => {
  it('detects absence of detached signature', () => {
    const doc = createDocument()
    expect(hasDetachedSignature(doc)).toBe(false)
  })

  it('detects detached signature element on root', () => {
    const doc = createDocument()
    const signature = doc.createElementNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')
    doc.documentElement.appendChild(signature)
    expect(hasDetachedSignature(doc)).toBe(true)
  })
})
