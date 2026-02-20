import { describe, expect, it } from 'vitest'
import { createDocument } from '../../src/xisf/xisf-xml'
import { parseTableElement } from '../../src/xisf/xisf-table'
import { XISFValidationError } from '../../src/xisf/xisf-errors'

describe('xisf/xisf-table', () => {
  it('rejects row count mismatch in strict mode', async () => {
    const doc = createDocument()
    const table = doc.createElement('Table')
    table.setAttribute('id', 'T0')
    table.setAttribute('rows', '1')
    table.setAttribute('columns', '1')

    await expect(
      parseTableElement(
        table,
        () => null,
        async () => new Uint8Array(0),
        {
          strictValidation: true,
        },
      ),
    ).rejects.toThrowError(XISFValidationError)
  })

  it('parses empty table in relaxed mode', async () => {
    const doc = createDocument()
    const table = doc.createElement('Table')
    table.setAttribute('id', 'T1')

    const parsed = await parseTableElement(
      table,
      () => null,
      async () => new Uint8Array(0),
      {
        strictValidation: false,
      },
    )
    expect(parsed.id).toBe('T1')
    expect(parsed.dataRows).toHaveLength(0)
  })
})
