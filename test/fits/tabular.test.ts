import { describe, expect, it } from 'vitest'
import { Tabular } from '../../src/fits/tabular'

class HeaderStub {
  constructor(private readonly values: Record<string, string | number>) {}

  contains(key: string): boolean {
    return key in this.values
  }

  getNumber(key: string, fallback?: number): number {
    const value = this.values[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim() !== '') return Number(value)
    return fallback ?? 0
  }

  getString(key: string, fallback?: string): string {
    const value = this.values[key]
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    return fallback ?? ''
  }
}

class TestTabular extends Tabular {
  constructor(header: HeaderStub, data: ArrayBuffer | Blob) {
    super(header as never, data)
    this.initAccessors(header as never)
  }

  protected setAccessors(): void {
    this.accessors.push((view, offset) => [view.getInt8(offset), offset + 1])
    this.descriptors.push('Int8')
    this.elementByteLengths.push(1)
    this.columnTypes.push('COL1')
  }

  protected _getRows(buffer: ArrayBuffer, nRows: number): Array<Record<string, unknown>> {
    const view = new DataView(buffer)
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < nRows; i++) {
      const value = view.getInt8(i)
      rows.push({ [this.columns?.[0] ?? 'COL1']: value })
    }
    return rows
  }
}

function makeHeader(withColumns: boolean = true, rows: number = 4): HeaderStub {
  return new HeaderStub({
    NAXIS1: 1,
    NAXIS2: rows,
    TFIELDS: 1,
    ...(withColumns ? { TTYPE1: 'COL1' } : {}),
  })
}

describe('tabular', () => {
  it('reads rows and columns from in-memory ArrayBuffer tables', async () => {
    const table = new TestTabular(makeHeader(true, 3), Uint8Array.from([10, 20, 30]).buffer)
    expect(await table.getRows(0, 2)).toEqual([{ COL1: 10 }, { COL1: 20 }])
    expect(await table.getColumn('COL1')).toEqual([10, 20, 30])
    await expect(table.getColumn('missing')).rejects.toThrow('not found')
  })

  it('reads rows and columns from Blob-backed tables with caching/chunking', async () => {
    const table = new TestTabular(makeHeader(true, 5), new Blob([Uint8Array.from([1, 2, 3, 4, 5])]))
    ;(table as unknown as { maxMemory: number }).maxMemory = 2
    ;(table as unknown as { nRowsInBuffer: number }).nRowsInBuffer = 2

    expect(await table.getRows(1, 2)).toEqual([{ COL1: 2 }, { COL1: 3 }])
    expect(await table.getRows(1, 1)).toEqual([{ COL1: 2 }])
    expect(await table.getColumn('COL1')).toEqual([1, 2, 3, 4, 5])
  })

  it('handles missing column metadata and missing data sources', async () => {
    const noNames = new TestTabular(makeHeader(false, 2), Uint8Array.from([7, 8]).buffer)
    await expect(noNames.getColumn('COL1')).rejects.toThrow('Column names not available')

    const noSource = new TestTabular(
      makeHeader(true, 1),
      Uint8Array.from([9]).buffer,
    ) as unknown as {
      buffer?: ArrayBuffer
      blob?: Blob
      getRows(row: number, n: number): Promise<unknown>
      getColumn(name: string): Promise<unknown>
    }
    noSource.buffer = undefined
    noSource.blob = undefined

    await expect(noSource.getRows(0, 1)).rejects.toThrow('No data source available')
    await expect(noSource.getColumn('COL1')).rejects.toThrow('No data source available')
  })

  it('covers defensive branches for in-memory checks and internal table buffer reads', async () => {
    const table = new TestTabular(
      makeHeader(true, 2),
      Uint8Array.from([4, 5]).buffer,
    ) as unknown as {
      getRows(row: number, n: number): Promise<unknown>
      rowsInMemory?: (first: number, last: number) => boolean
      buffer?: ArrayBuffer
      cachedBuffer?: ArrayBuffer
      getTableBuffer?: (row: number, n: number) => Promise<ArrayBuffer>
    }

    table.rowsInMemory = () => true
    table.buffer = undefined
    table.cachedBuffer = undefined
    await expect(table.getRows(0, 1)).rejects.toThrow('No data source available')

    const table2 = new TestTabular(
      makeHeader(true, 2),
      Uint8Array.from([6, 7]).buffer,
    ) as unknown as {
      getTableBuffer?: (row: number, n: number) => Promise<ArrayBuffer>
    }
    const buf = await table2.getTableBuffer!(0, 1)
    expect(Array.from(new Uint8Array(buf))).toEqual([6])
  })
})
