import { describe, it, expect } from 'vitest'
import { BinaryTable, DATA_ACCESSORS } from '../src/binary-table'
import { Header } from '../src/header'
import { makeHeaderBlock, card } from './helpers'

/**
 * Helper: build a minimal BINTABLE FITS HDU (header + data) as an ArrayBuffer.
 * Returns the data portion (just the table rows, no header).
 */
function makeBinaryTableBuffer(
  cols: { name: string; form: string }[],
  rowByteSize: number,
  rowData: ArrayBuffer,
  pcount = 0,
  heapData?: ArrayBuffer,
): { header: Header; data: ArrayBuffer } {
  const nRows = rowData.byteLength / rowByteSize
  const cards: string[] = [
    card("XTENSION= 'BINTABLE'           / Binary table extension"),
    card('BITPIX  =                    8 / Bits per pixel'),
    card('NAXIS   =                    2 / Number of axes'),
    card(`NAXIS1  = ${String(rowByteSize).padStart(20)} / Bytes per row`),
    card(`NAXIS2  = ${String(nRows).padStart(20)} / Number of rows`),
    card(`PCOUNT  = ${String(pcount).padStart(20)} / Heap size`),
    card('GCOUNT  =                    1 / One group'),
    card(`TFIELDS = ${String(cols.length).padStart(20)} / Number of fields`),
  ]
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!
    cards.push(card(`TFORM${i + 1}  = '${col.form.padEnd(8)}'           / Format`))
    cards.push(card(`TTYPE${i + 1}  = '${col.name.padEnd(8)}'           / Name`))
  }

  const headerStr = makeHeaderBlock(cards)
  const header = new Header(headerStr)

  // Combine row data + heap
  let dataBuffer: ArrayBuffer
  if (heapData) {
    const combined = new Uint8Array(rowData.byteLength + heapData.byteLength)
    combined.set(new Uint8Array(rowData), 0)
    combined.set(new Uint8Array(heapData), rowData.byteLength)
    dataBuffer = combined.buffer
  } else {
    dataBuffer = rowData
  }

  return { header, data: dataBuffer }
}

describe('BinaryTable', () => {
  describe('DATA_ACCESSORS', () => {
    it('L accessor should read logical (T=84 is true, other is false)', () => {
      const buf = new ArrayBuffer(2)
      const view = new DataView(buf)
      view.setInt8(0, 84) // 'T'
      view.setInt8(1, 70) // 'F'

      const [val1, off1] = DATA_ACCESSORS['L']!(view, 0)
      expect(val1).toBe(true)
      expect(off1).toBe(1)

      const [val2, off2] = DATA_ACCESSORS['L']!(view, 1)
      expect(val2).toBe(false)
      expect(off2).toBe(2)
    })

    it('B accessor should read unsigned byte', () => {
      const buf = new ArrayBuffer(1)
      new DataView(buf).setUint8(0, 200)
      const [val, off] = DATA_ACCESSORS['B']!(new DataView(buf), 0)
      expect(val).toBe(200)
      expect(off).toBe(1)
    })

    it('I accessor should read big-endian int16', () => {
      const buf = new ArrayBuffer(2)
      new DataView(buf).setInt16(0, -1234, false)
      const [val, off] = DATA_ACCESSORS['I']!(new DataView(buf), 0)
      expect(val).toBe(-1234)
      expect(off).toBe(2)
    })

    it('J accessor should read big-endian int32', () => {
      const buf = new ArrayBuffer(4)
      new DataView(buf).setInt32(0, 123456, false)
      const [val, off] = DATA_ACCESSORS['J']!(new DataView(buf), 0)
      expect(val).toBe(123456)
      expect(off).toBe(4)
    })

    it('E accessor should read big-endian float32', () => {
      const buf = new ArrayBuffer(4)
      new DataView(buf).setFloat32(0, 3.14, false)
      const [val, off] = DATA_ACCESSORS['E']!(new DataView(buf), 0)
      expect(val).toBeCloseTo(3.14, 2)
      expect(off).toBe(4)
    })

    it('D accessor should read big-endian float64', () => {
      const buf = new ArrayBuffer(8)
      new DataView(buf).setFloat64(0, 2.718281828, false)
      const [val, off] = DATA_ACCESSORS['D']!(new DataView(buf), 0)
      expect(val).toBeCloseTo(2.718281828, 8)
      expect(off).toBe(8)
    })

    it('A accessor should read single ASCII character', () => {
      const buf = new ArrayBuffer(1)
      new DataView(buf).setUint8(0, 65) // 'A'
      const [val, off] = DATA_ACCESSORS['A']!(new DataView(buf), 0)
      expect(val).toBe('A')
      expect(off).toBe(1)
    })

    it('C accessor should read complex (two float32)', () => {
      const buf = new ArrayBuffer(8)
      const view = new DataView(buf)
      view.setFloat32(0, 1.5, false)
      view.setFloat32(4, -2.5, false)
      const [val, off] = DATA_ACCESSORS['C']!(view, 0)
      expect(val).toEqual([expect.closeTo(1.5, 5), expect.closeTo(-2.5, 5)])
      expect(off).toBe(8)
    })

    it('M accessor should read double complex (two float64)', () => {
      const buf = new ArrayBuffer(16)
      const view = new DataView(buf)
      view.setFloat64(0, 1.23456789, false)
      view.setFloat64(8, -9.87654321, false)
      const [val, off] = DATA_ACCESSORS['M']!(view, 0)
      const arr = val as number[]
      expect(arr[0]).toBeCloseTo(1.23456789, 8)
      expect(arr[1]).toBeCloseTo(-9.87654321, 8)
      expect(off).toBe(16)
    })

    it('K accessor should read int64 as bigint', () => {
      const buf = new ArrayBuffer(8)
      new DataView(buf).setBigInt64(0, BigInt(1234), false)
      const [val, off] = DATA_ACCESSORS['K']!(new DataView(buf), 0)
      expect(val).toBe(1234n)
      expect(off).toBe(8)
    })
  })

  describe('Single-value column reading', () => {
    it('should read rows with single J (int32) and E (float32) columns', async () => {
      // 2 columns: J (4 bytes) + E (4 bytes) = 8 bytes per row, 2 rows
      const rowByteSize = 8
      const nRows = 2
      const rowBuf = new ArrayBuffer(rowByteSize * nRows)
      const view = new DataView(rowBuf)

      // Row 0: J=42, E=1.5
      view.setInt32(0, 42, false)
      view.setFloat32(4, 1.5, false)
      // Row 1: J=-10, E=3.14
      view.setInt32(8, -10, false)
      view.setFloat32(12, 3.14, false)

      const { header, data } = makeBinaryTableBuffer(
        [
          { name: 'COUNT', form: '1J' },
          { name: 'VALUE', form: '1E' },
        ],
        rowByteSize,
        rowBuf,
      )

      const table = new BinaryTable(header, data)
      expect(table.rows).toBe(2)
      expect(table.cols).toBe(2)
      expect(table.columns).toEqual(['COUNT', 'VALUE'])

      const rows = await table.getRows(0, 2)
      const rowArr = rows as Record<string, unknown>[]
      expect(rowArr).toHaveLength(2)
      expect(rowArr[0]!['COUNT']).toBe(42)
      expect(rowArr[0]!['VALUE']).toBeCloseTo(1.5, 5)
      expect(rowArr[1]!['COUNT']).toBe(-10)
      expect(rowArr[1]!['VALUE']).toBeCloseTo(3.14, 2)
    })
  })

  describe('Character array column reading', () => {
    it('should read rows with character array (8A) column', async () => {
      const rowByteSize = 8
      const nRows = 1
      const rowBuf = new ArrayBuffer(rowByteSize * nRows)
      const arr = new Uint8Array(rowBuf)
      // "Hello   "
      const text = 'Hello   '
      for (let i = 0; i < text.length; i++) {
        arr[i] = text.charCodeAt(i)
      }

      const { header, data } = makeBinaryTableBuffer(
        [{ name: 'LABEL', form: '8A' }],
        rowByteSize,
        rowBuf,
      )

      const table = new BinaryTable(header, data)
      const rows = await table.getRows(0, 1)
      const rowArr = rows as Record<string, unknown>[]
      expect(rowArr[0]!['LABEL']).toBe('Hello')
    })
  })

  describe('Bit array column reading', () => {
    it('should read bit arrays correctly with fixed nBytes=ceil(count/8)', async () => {
      // 16X => 2 bytes per row
      const rowByteSize = 2
      const nRows = 1
      const rowBuf = new ArrayBuffer(rowByteSize * nRows)
      const view = new DataView(rowBuf)
      // 0b10110001 0b11000010 = [1,0,1,1,0,0,0,1, 1,1,0,0,0,0,1,0]
      view.setUint8(0, 0b10110001)
      view.setUint8(1, 0b11000010)

      const { header, data } = makeBinaryTableBuffer(
        [{ name: 'FLAGS', form: '16X' }],
        rowByteSize,
        rowBuf,
      )

      const table = new BinaryTable(header, data)
      const rows = await table.getRows(0, 1)
      const rowArr = rows as Record<string, unknown>[]
      expect(rowArr[0]!['FLAGS']).toEqual([1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0])
    })

    it('should handle 8X (1 byte)', async () => {
      const rowByteSize = 1
      const rowBuf = new ArrayBuffer(1)
      new DataView(rowBuf).setUint8(0, 0xff)

      const { header, data } = makeBinaryTableBuffer(
        [{ name: 'BITS', form: '8X' }],
        rowByteSize,
        rowBuf,
      )

      const table = new BinaryTable(header, data)
      const rows = await table.getRows(0, 1)
      const rowArr = rows as Record<string, unknown>[]
      expect(rowArr[0]!['BITS']).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    })
  })

  describe('Multi-value column reading', () => {
    it('should read 3E (three float32 values)', async () => {
      const rowByteSize = 12 // 3 * 4 bytes
      const nRows = 1
      const rowBuf = new ArrayBuffer(rowByteSize * nRows)
      const view = new DataView(rowBuf)
      view.setFloat32(0, 1.0, false)
      view.setFloat32(4, 2.0, false)
      view.setFloat32(8, 3.0, false)

      const { header, data } = makeBinaryTableBuffer(
        [{ name: 'COORDS', form: '3E' }],
        rowByteSize,
        rowBuf,
      )

      const table = new BinaryTable(header, data)
      const rows = await table.getRows(0, 1)
      const rowArr = rows as Record<string, unknown>[]
      const coords = rowArr[0]!['COORDS'] as number[]
      expect(coords).toHaveLength(3)
      expect(coords[0]).toBeCloseTo(1.0, 5)
      expect(coords[1]).toBeCloseTo(2.0, 5)
      expect(coords[2]).toBeCloseTo(3.0, 5)
    })
  })

  describe('getColumn', () => {
    it('should read all values for a named column', async () => {
      const rowByteSize = 4
      const nRows = 3
      const rowBuf = new ArrayBuffer(rowByteSize * nRows)
      const view = new DataView(rowBuf)
      view.setInt32(0, 100, false)
      view.setInt32(4, 200, false)
      view.setInt32(8, 300, false)

      const { header, data } = makeBinaryTableBuffer(
        [{ name: 'VAL', form: '1J' }],
        rowByteSize,
        rowBuf,
      )

      const table = new BinaryTable(header, data)
      const column = await table.getColumn('VAL')
      expect(column).toEqual([100, 200, 300])
    })

    it('should throw for unknown column name', async () => {
      const rowBuf = new ArrayBuffer(4)
      new DataView(rowBuf).setInt32(0, 1, false)
      const { header, data } = makeBinaryTableBuffer([{ name: 'X', form: '1J' }], 4, rowBuf)
      const table = new BinaryTable(header, data)
      await expect(table.getColumn('NONEXISTENT')).rejects.toThrow('not found')
    })
  })

  describe('edge branches', () => {
    it('throws when heap data is requested but not available on blob-backed table', async () => {
      const row = new ArrayBuffer(8)
      const view = new DataView(row)
      view.setInt32(0, 1, false)
      view.setInt32(4, 0, false)
      const { header } = makeBinaryTableBuffer([{ name: 'ARR', form: '1PB' }], 8, row, 1)
      const table = new BinaryTable(header, new Blob([new Uint8Array(row)]))
      await expect(table.getRows(0, 1)).rejects.toThrow('Heap not available')
    })

    it('throws when variable-length descriptor has no typed array constructor', async () => {
      const row = new ArrayBuffer(8)
      const rowView = new DataView(row)
      rowView.setInt32(0, 1, false)
      rowView.setInt32(4, 0, false)
      const heap = Uint8Array.from([1]).buffer
      const { header, data } = makeBinaryTableBuffer(
        [{ name: 'ARR', form: '1PL' }],
        8,
        row,
        1,
        heap,
      )
      const table = new BinaryTable(header, data)
      await expect(table.getRows(0, 1)).rejects.toThrow('No typed array constructor')
    })

    it('throws for invalid internal accessor setup descriptors', () => {
      const row = new ArrayBuffer(4)
      new DataView(row).setInt32(0, 1, false)
      const { header, data } = makeBinaryTableBuffer([{ name: 'X', form: '1J' }], 4, row)
      const table = new BinaryTable(header, data) as unknown as {
        setupSingleAccessor(descriptor: string): void
        setupMultiAccessor(descriptor: string, count: number): void
      }

      expect(() => table.setupSingleAccessor('Z')).toThrow('Unknown binary table type code')
      expect(() => table.setupMultiAccessor('Z', 2)).toThrow('Unknown binary table type code')
    })

    it('supports generic heap arrays and explicit GZIP compressed-data accessors', async () => {
      const row = new ArrayBuffer(8)
      const rowView = new DataView(row)
      rowView.setInt32(0, 1, false)
      rowView.setInt32(4, 0, false)
      const heap = Uint8Array.from([99]).buffer
      const generic = makeBinaryTableBuffer([{ name: 'ARR', form: '1PB' }], 8, row, 1, heap)
      const genericTable = new BinaryTable(generic.header, generic.data)
      const rows = (await genericTable.getRows(0, 1)) as Record<string, unknown>[]
      expect(Array.from(rows[0]!['ARR'] as Uint8Array)).toEqual([99])

      const genericWithMax = makeBinaryTableBuffer(
        [{ name: 'ARR_MAX', form: '1PB(63)' }],
        8,
        row,
        1,
        heap,
      )
      const genericWithMaxTable = new BinaryTable(genericWithMax.header, genericWithMax.data)
      const rowsWithMax = (await genericWithMaxTable.getRows(0, 1)) as Record<string, unknown>[]
      expect(Array.from(rowsWithMax[0]!['ARR_MAX'] as Uint8Array)).toEqual([99])

      const gzip = makeBinaryTableBuffer([{ name: 'GZIP_COMPRESSED_DATA', form: '1PB' }], 8, row, 0)
      const gzipTable = new BinaryTable(gzip.header, gzip.data)
      await expect(gzipTable.getRows(0, 1)).rejects.toThrow(
        'GZIP decompression is not yet implemented',
      )
    })
  })
})
