import { describe, it, expect } from 'vitest'
import { FITS } from '../../src/fits'
import { Table } from '../../src/fits/table'
import type { TableRow } from '../../src/core/types'
import { makeImageWithTable } from '../shared/helpers'

describe('Table (ASCII)', () => {
  function makeTestFits() {
    const tableRows = [
      ' -3.12 -3.12  0.00  0.00',
      ' -3.12  0.08 -0.59  0.09',
      '  3.12  3.12 -0.20 -0.07',
    ]
    const tableCols = [
      { name: 'XI', form: 'F6.2' },
      { name: 'ETA', form: 'F6.2' },
      { name: 'XI_CORR', form: 'F6.2' },
      { name: 'ETA_CORR', form: 'F6.2' },
    ]

    return makeImageWithTable(2, 2, 16, [1, 2, 3, 4], tableRows, tableCols)
  }

  it('should detect column names', () => {
    const buffer = makeTestFits()
    const fits = FITS.fromArrayBuffer(buffer)
    const table = fits.getDataUnit(1) as Table

    expect(table).toBeInstanceOf(Table)
    expect(table.columns).toEqual(['XI', 'ETA', 'XI_CORR', 'ETA_CORR'])
  })

  it('should read rows from an ASCII table', async () => {
    const buffer = makeTestFits()
    const fits = FITS.fromArrayBuffer(buffer)
    const table = fits.getDataUnit(1) as Table

    const rows = (await table.getRows(0, 3)) as TableRow[]
    expect(rows).toHaveLength(3)

    const row0 = rows[0]!
    expect(row0['XI']).toBeCloseTo(-3.12, 2)
    expect(row0['ETA']).toBeCloseTo(-3.12, 2)
    expect(row0['XI_CORR']).toBeCloseTo(0.0, 2)
    expect(row0['ETA_CORR']).toBeCloseTo(0.0, 2)

    const row1 = rows[1]!
    expect(row1['XI']).toBeCloseTo(-3.12, 2)
    expect(row1['ETA']).toBeCloseTo(0.08, 2)
    expect(row1['XI_CORR']).toBeCloseTo(-0.59, 2)
    expect(row1['ETA_CORR']).toBeCloseTo(0.09, 2)

    const row2 = rows[2]!
    expect(row2['XI']).toBeCloseTo(3.12, 2)
    expect(row2['ETA']).toBeCloseTo(3.12, 2)
    expect(row2['XI_CORR']).toBeCloseTo(-0.2, 2)
    expect(row2['ETA_CORR']).toBeCloseTo(-0.07, 2)
  })

  it('should report correct row and column counts', () => {
    const buffer = makeTestFits()
    const fits = FITS.fromArrayBuffer(buffer)
    const table = fits.getDataUnit(1) as Table

    expect(table.rows).toBe(3)
    expect(table.cols).toBe(4)
  })
})
