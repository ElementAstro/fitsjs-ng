import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { XISFParseError, XISFValidationError } from './xisf-errors'

const XML_NS = 'http://www.pixinsight.com/xisf'

function nodeName(node: Node): string {
  const anyNode = node as Node & { localName?: string; nodeName: string }
  const local = anyNode.localName
  if (local && local.length > 0) return local
  const raw = anyNode.nodeName
  const idx = raw.indexOf(':')
  return idx >= 0 ? raw.slice(idx + 1) : raw
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1
}

export function parseXISFXML(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseErrors = doc.getElementsByTagName('parsererror')
  if (parseErrors.length > 0) {
    throw new XISFParseError((parseErrors[0]?.textContent ?? 'Invalid XML').trim())
  }
  const root = doc.documentElement
  if (!root) {
    throw new XISFParseError('Empty XML document')
  }
  if (nodeName(root) !== 'xisf') {
    throw new XISFValidationError(`Invalid root element: ${root.nodeName}`)
  }
  const version = root.getAttribute('version')
  if (version !== '1.0') {
    throw new XISFValidationError(`Unsupported XISF version: ${version ?? 'none'}`)
  }
  return doc
}

export function getXISFNamespace(): string {
  return XML_NS
}

export function getElementChildren(parent: Element): Element[] {
  const out: Element[] = []
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes.item(i)
    if (node && isElementNode(node)) {
      out.push(node)
    }
  }
  return out
}

export function getChildrenByName(parent: Element, name: string): Element[] {
  return getElementChildren(parent).filter((e) => nodeName(e) === name)
}

export function getFirstChildByName(parent: Element, name: string): Element | null {
  const children = getChildrenByName(parent, name)
  return children.length > 0 ? children[0]! : null
}

export function getNodeName(node: Node): string {
  return nodeName(node)
}

export function serializeXML(doc: Document): string {
  return new XMLSerializer().serializeToString(doc)
}

export function createDocument(): Document {
  const doc = new DOMParser().parseFromString(
    '<?xml version="1.0" encoding="UTF-8"?><xisf version="1.0"/>',
    'application/xml',
  )
  const root = doc.documentElement
  root.setAttribute('xmlns', XML_NS)
  root.setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
  root.setAttribute(
    'xsi:schemaLocation',
    'http://www.pixinsight.com/xisf http://pixinsight.com/xisf/xisf-1.0.xsd',
  )
  return doc
}
