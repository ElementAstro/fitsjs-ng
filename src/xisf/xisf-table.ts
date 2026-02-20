import type { XISFStructureField, XISFTable, XISFTableRow } from './xisf-types'
import { getChildrenByName, getFirstChildByName } from './xisf-xml'
import {
  parsePropertyElement,
  type ParsePropertyOptions,
  type ReadDataBlock,
} from './xisf-property'
import { XISFValidationError } from './xisf-errors'

function parseField(element: Element): XISFStructureField {
  return {
    id: element.getAttribute('id') ?? '',
    type: element.getAttribute('type') ?? '',
    format: element.getAttribute('format') ?? undefined,
    header: element.getAttribute('header') ?? undefined,
  }
}

interface ParseTableOptions {
  strictValidation?: boolean
}

function cloneCellAsProperty(source: Element, field: XISFStructureField | undefined): Element {
  const propertyLike = source.cloneNode(true) as Element
  if (field?.id && !propertyLike.getAttribute('id')) {
    propertyLike.setAttribute('id', field.id)
  }
  if (field?.type && !propertyLike.getAttribute('type')) {
    propertyLike.setAttribute('type', field.type)
  }
  if (field?.format && !propertyLike.getAttribute('format')) {
    propertyLike.setAttribute('format', field.format)
  }
  return propertyLike
}

async function parseRow(
  element: Element,
  fields: XISFStructureField[],
  readDataBlock: ReadDataBlock,
  options?: ParsePropertyOptions,
): Promise<XISFTableRow> {
  const cells = getChildrenByName(element, 'Cell')
  const parsedCells = await Promise.all(
    cells.map((cell, index) => {
      const field = fields[index]
      const propertyNode = cloneCellAsProperty(cell, field)
      return parsePropertyElement(propertyNode, readDataBlock, {
        ...options,
        defaultType: field?.type,
        defaultId: field?.id,
        defaultFormat: field?.format,
      })
    }),
  )
  return { cells: parsedCells }
}

export async function parseTableElement(
  element: Element,
  resolveReference: (ref: string) => Element | null,
  readDataBlock: ReadDataBlock,
  options?: ParseTableOptions,
): Promise<XISFTable> {
  const strict = options?.strictValidation ?? true
  const id = element.getAttribute('id') ?? ''
  const caption = element.getAttribute('caption') ?? undefined
  const rows = element.getAttribute('rows') ? Number(element.getAttribute('rows')) : undefined
  const columns = element.getAttribute('columns')
    ? Number(element.getAttribute('columns'))
    : undefined
  const comment = element.getAttribute('comment') ?? undefined
  if (strict && rows !== undefined && (!Number.isInteger(rows) || rows < 0)) {
    throw new XISFValidationError(`Table '${id || '<unnamed>'}' has invalid rows value`)
  }
  if (strict && columns !== undefined && (!Number.isInteger(columns) || columns < 0)) {
    throw new XISFValidationError(`Table '${id || '<unnamed>'}' has invalid columns value`)
  }

  let structureElement = getFirstChildByName(element, 'Structure')
  if (!structureElement) {
    const ref = getFirstChildByName(element, 'Reference')
    if (ref) {
      const refId = ref.getAttribute('ref')
      if (refId) {
        const target = resolveReference(refId)
        if (target && target.tagName.toLowerCase().endsWith('structure')) {
          structureElement = target
        } else if (strict) {
          throw new XISFValidationError(
            `Table '${id || '<unnamed>'}' has invalid Structure reference '${refId}'`,
          )
        }
      }
    }
  }

  const fields: XISFStructureField[] = structureElement
    ? getChildrenByName(structureElement, 'Field').map(parseField)
    : []

  const rowElements = getChildrenByName(element, 'Row')
  const dataRows = await Promise.all(
    rowElements.map((rowElement) =>
      parseRow(rowElement, fields, readDataBlock, { strictValidation: strict }),
    ),
  )
  if (strict && rows !== undefined && rows !== dataRows.length) {
    throw new XISFValidationError(`Table '${id || '<unnamed>'}' row count mismatch`)
  }
  if (strict && columns !== undefined) {
    for (const row of dataRows) {
      if (row.cells.length !== columns) {
        throw new XISFValidationError(`Table '${id || '<unnamed>'}' column count mismatch`)
      }
    }
  }
  if (strict && fields.length > 0) {
    for (const row of dataRows) {
      if (row.cells.length !== fields.length) {
        throw new XISFValidationError(`Table '${id || '<unnamed>'}' field/cell count mismatch`)
      }
    }
  }

  return {
    id,
    caption,
    rows,
    columns,
    comment,
    structure: fields,
    dataRows,
  }
}
