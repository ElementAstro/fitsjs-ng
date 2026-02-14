import { Tabular } from './tabular'
import { DecompressionError } from './errors'
import type { Header } from './header'
import type { BinaryAccessor, TableRow, TypedArray } from './types'
import { BINARY_TYPE_BYTE_SIZES, TYPED_ARRAY_CONSTRUCTORS } from './types'
import { swapEndian, toBits } from './utils'

/**
 * Binary table data accessor functions keyed by type code.
 * Each returns [value, newOffset].
 */
const DATA_ACCESSORS: Record<string, (view: DataView, offset: number) => [unknown, number]> = {
  L(view, offset) {
    const x = view.getInt8(offset)
    return [x === 84, offset + 1]
  },
  B(view, offset) {
    return [view.getUint8(offset), offset + 1]
  },
  I(view, offset) {
    return [view.getInt16(offset, false), offset + 2]
  },
  J(view, offset) {
    return [view.getInt32(offset, false), offset + 4]
  },
  K(view, offset) {
    const val = view.getBigInt64(offset, false)
    return [Number(val), offset + 8]
  },
  A(view, offset) {
    const val = String.fromCharCode(view.getUint8(offset))
    return [val, offset + 1]
  },
  E(view, offset) {
    return [view.getFloat32(offset, false), offset + 4]
  },
  D(view, offset) {
    return [view.getFloat64(offset, false), offset + 8]
  },
  C(view, offset) {
    const val1 = view.getFloat32(offset, false)
    const val2 = view.getFloat32(offset + 4, false)
    return [[val1, val2], offset + 8]
  },
  M(view, offset) {
    const val1 = view.getFloat64(offset, false)
    const val2 = view.getFloat64(offset + 8, false)
    return [[val1, val2], offset + 16]
  },
}

/**
 * Reads binary tables from FITS files (XTENSION = 'BINTABLE').
 *
 * Binary tables support a rich set of data types including logical,
 * integer, float, complex, character, bit arrays, and variable-length
 * array descriptors pointing to a heap area.
 */
export class BinaryTable extends Tabular {
  constructor(header: Header, data: ArrayBuffer | Blob) {
    super(header, data)
    this.initAccessors(header)
  }

  protected setAccessors(header: Header): void {
    const pattern = /(\d*)([PQ]*)([LXBIJKAEDCM])$/

    for (let i = 1; i <= this.cols; i++) {
      const form = header.getString(`TFORM${i}`)
      const type = header.getString(`TTYPE${i}`)
      const match = pattern.exec(form)
      if (!match) {
        throw new Error(`Unsupported or invalid TFORM${i} value: '${form}'`)
      }

      const count = parseInt(match[1]!, 10) || 1
      const isArray = match[2]!
      const descriptor = match[3]!

      this.descriptors.push(descriptor)
      this.columnTypes.push(type)
      this.elementByteLengths.push((BINARY_TYPE_BYTE_SIZES[descriptor] ?? 1) * count)

      if (isArray) {
        this.setupArrayAccessor(descriptor, type)
      } else if (count === 1) {
        this.setupSingleAccessor(descriptor)
      } else if (descriptor === 'X') {
        this.setupBitArrayAccessor(count)
      } else if (descriptor === 'A') {
        this.setupCharArrayAccessor(count)
      } else {
        this.setupMultiAccessor(descriptor, count)
      }
    }
  }

  /**
   * Read data from the heap area following the main table data.
   */
  protected getFromHeap(view: DataView, offset: number, descriptor: string): [TypedArray, number] {
    const length = view.getInt32(offset, false)
    offset += 4
    const heapOffset = view.getInt32(offset, false)
    offset += 4

    if (!this.heap) {
      throw new Error('Heap not available')
    }

    const bytesPerElement = BINARY_TYPE_BYTE_SIZES[descriptor] ?? 1
    const heapSlice = this.heap.slice(heapOffset, heapOffset + length * bytesPerElement)
    const Ctor = TYPED_ARRAY_CONSTRUCTORS[descriptor]
    if (!Ctor) {
      throw new Error(`No typed array constructor for descriptor: ${descriptor}`)
    }

    const arr = new Ctor(heapSlice) as TypedArray

    // Endian swap (byte arrays don't need swapping)
    const swapFn = swapEndian[descriptor]
    if (swapFn && descriptor !== 'B') {
      for (let j = 0; j < arr.length; j++) {
        ;(arr as Int32Array)[j] = swapFn(arr[j]!) as number
      }
    }

    return [arr, offset]
  }

  private setupArrayAccessor(descriptor: string, type: string): void {
    if (type === 'COMPRESSED_DATA') {
      const accessor: BinaryAccessor = (view, offset) => {
        const [arr, newOffset] = this.getFromHeap(view, offset, descriptor)
        // Rice decompression is handled by CompressedImage subclass
        return [arr, newOffset]
      }
      this.accessors.push(accessor)
    } else if (type === 'GZIP_COMPRESSED_DATA') {
      const accessor: BinaryAccessor = (_view, _offset) => {
        throw new DecompressionError('GZIP decompression is not yet implemented')
      }
      this.accessors.push(accessor)
    } else {
      const accessor: BinaryAccessor = (view, offset) => {
        return this.getFromHeap(view, offset, descriptor)
      }
      this.accessors.push(accessor)
    }
  }

  private setupSingleAccessor(descriptor: string): void {
    const dataAccessor = DATA_ACCESSORS[descriptor]
    if (!dataAccessor) {
      throw new Error(`Unknown binary table type code: ${descriptor}`)
    }
    const accessor: BinaryAccessor = (view, offset) => {
      return dataAccessor(view, offset)
    }
    this.accessors.push(accessor)
  }

  private setupBitArrayAccessor(count: number): void {
    const nBytes = Math.ceil(count / 8)
    const accessor: BinaryAccessor = (view, offset) => {
      const buffer = view.buffer.slice(offset, offset + nBytes)
      const bytes = new Uint8Array(buffer)
      let bits: number[] = []
      for (let b = 0; b < bytes.length; b++) {
        bits = bits.concat(toBits(bytes[b]!))
      }
      return [bits.slice(0, count), offset + nBytes]
    }
    this.accessors.push(accessor)
  }

  private setupCharArrayAccessor(count: number): void {
    const accessor: BinaryAccessor = (view, offset) => {
      const buffer = view.buffer.slice(offset, offset + count)
      const arr = new Uint8Array(buffer)
      let s = ''
      for (let c = 0; c < arr.length; c++) {
        s += String.fromCharCode(arr[c]!)
      }
      return [s.trim(), offset + count]
    }
    this.accessors.push(accessor)
  }

  private setupMultiAccessor(descriptor: string, count: number): void {
    const dataAccessor = DATA_ACCESSORS[descriptor]
    if (!dataAccessor) {
      throw new Error(`Unknown binary table type code: ${descriptor}`)
    }
    const accessor: BinaryAccessor = (view, offset) => {
      const data: unknown[] = []
      let off = offset
      for (let c = 0; c < count; c++) {
        const [value, newOff] = dataAccessor(view, off)
        data.push(value)
        off = newOff
      }
      return [data, off]
    }
    this.accessors.push(accessor)
  }

  protected override _getRows(buffer: ArrayBuffer, nRows: number): TableRow[] | Float32Array {
    const view = new DataView(buffer)
    let offset = 0
    const rows: TableRow[] = []

    for (let r = 0; r < nRows; r++) {
      const row: TableRow = {}
      for (let c = 0; c < this.accessors.length; c++) {
        const [value, newOffset] = this.accessors[c]!(view, offset)
        offset = newOffset
        if (this.columns) {
          row[this.columns[c]!] = value
        }
      }
      rows.push(row)
    }

    return rows
  }
}

export { DATA_ACCESSORS }
