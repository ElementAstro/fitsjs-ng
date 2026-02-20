import { describe, expect, it, vi } from 'vitest'
import { createDocument } from '../../src/xisf/xisf-xml'
import { hasDetachedSignature, verifyDetachedSignature } from '../../src/xisf/xisf-signature'

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

  it('fails signature verification strictly when no subtle crypto in non-node runtime', async () => {
    const doc = createDocument()
    const ns = 'http://www.w3.org/2000/09/xmldsig#'
    const signature = doc.createElementNS(ns, 'Signature')
    const signedInfo = doc.createElementNS(ns, 'SignedInfo')
    const canonicalizationMethod = doc.createElementNS(ns, 'CanonicalizationMethod')
    canonicalizationMethod.setAttribute(
      'Algorithm',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    )
    const signatureMethod = doc.createElementNS(ns, 'SignatureMethod')
    signatureMethod.setAttribute('Algorithm', 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256')
    const reference = doc.createElementNS(ns, 'Reference')
    reference.setAttribute('URI', '')
    const digestMethod = doc.createElementNS(ns, 'DigestMethod')
    digestMethod.setAttribute('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
    const digestValue = doc.createElementNS(ns, 'DigestValue')
    digestValue.textContent = 'AA=='
    reference.appendChild(digestMethod)
    reference.appendChild(digestValue)
    signedInfo.appendChild(canonicalizationMethod)
    signedInfo.appendChild(signatureMethod)
    signedInfo.appendChild(reference)
    signature.appendChild(signedInfo)
    const signatureValue = doc.createElementNS(ns, 'SignatureValue')
    signatureValue.textContent = 'AA=='
    signature.appendChild(signatureValue)
    doc.documentElement.appendChild(signature)

    const originalCrypto = globalThis.crypto
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    vi.stubGlobal('crypto', undefined)
    Object.defineProperty(globalThis, 'navigator', {
      value: { product: 'ReactNative' },
      configurable: true,
    })
    try {
      const result = await verifyDetachedSignature(doc)
      expect(result.present).toBe(true)
      expect(result.verified).toBe(false)
      expect(result.reason).toContain('requires Node.js runtime')
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
      } else {
        delete (globalThis as { navigator?: unknown }).navigator
      }
    }
  })
})
