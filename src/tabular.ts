import { DataUnit } from './data-unit'
import type { Header } from './header'
import type { BinaryAccessor, TableRow, TypedArray } from './types'
import { TYPED_ARRAY_CONSTRUCTORS } from './types'

/**
 * Abstract base class for tabular FITS extensions (TABLE and BINTABLE).
 *
 * Handles shared logic for row/column access, buffer management,
 * and accessor setup. Derived classes must implement `setAccessors` and `_getRows`.
 */
export abstract class Tabular extends DataUnit {
  /** Maximum memory (bytes) to hold when reading from blob. */
  protected maxMemory = 1048576

  readonly rowByteSize: number
  readonly rows: number
  readonly cols: number
  readonly length: number
  readonly heapLength: number
  readonly columns: string[] | null

  /** Accessor functions for each column. */
  protected accessors: BinaryAccessor[] = []
  /** Type descriptor for each column. */
  protected descriptors: string[] = []
  /** Byte length of each column element. */
  protected elementByteLengths: number[] = []
  /** TTYPE values for each column (used by subclasses to identify column roles). */
  protected columnTypes: string[] = []

  /** Heap data for variable-length arrays. */
  heap?: ArrayBuffer

  /** Typed array constructor map (used by BinaryTable). */
  protected typedArray: Record<string, new (length: number | ArrayBuffer) => TypedArray> =
    TYPED_ARRAY_CONSTRUCTORS as Record<string, new (length: number | ArrayBuffer) => TypedArray>

  // For blob-based reading
  private firstRowInBuffer = 0
  private lastRowInBuffer = 0
  private nRowsInBuffer = 0
  private cachedBuffer?: ArrayBuffer

  constructor(header: Header, data: ArrayBuffer | Blob) {
    super(data)

    this.rowByteSize = header.getNumber('NAXIS1')
    this.rows = header.getNumber('NAXIS2')
    this.cols = header.getNumber('TFIELDS')

    this.length = this.rowByteSize * this.rows
    this.heapLength = header.getNumber('PCOUNT')
    this.columns = this.getColumns(header)

    if (this.buffer) {
      // Keep separate buffer for heap
      this.heap = this.buffer.slice(this.length, this.length + this.heapLength)
    } else {
      this.firstRowInBuffer = 0
      this.lastRowInBuffer = 0
      this.nRowsInBuffer = Math.floor(this.maxMemory / this.rowByteSize)
    }

    // NOTE: Do NOT call setAccessors here.
    // Subclass field initializers run after super() returns,
    // which would overwrite values set by setAccessors.
    // Subclasses must call this.initAccessors(header) at the end of their own constructor.
  }

  /**
   * Subclasses must call this at the end of their constructor.
   */
  protected initAccessors(header: Header): void {
    this.resetAccessors()
    this.setAccessors(header)
  }

  /**
   * Clear all accessor arrays before re-initialization.
   */
  private resetAccessors(): void {
    this.accessors = []
    this.descriptors = []
    this.elementByteLengths = []
    this.columnTypes = []
  }

  /**
   * Derived classes must set up accessor functions for each column.
   */
  protected abstract setAccessors(header: Header): void

  /**
   * Derived classes must implement row parsing from a buffer.
   */
  protected abstract _getRows(buffer: ArrayBuffer, nRows: number): TableRow[] | Float32Array

  /**
   * Check if the specified row range is currently in memory.
   */
  private rowsInMemory(firstRow: number, lastRow: number): boolean {
    if (this.buffer && !this.blob) return true
    if (this.cachedBuffer) {
      if (firstRow < this.firstRowInBuffer) return false
      if (lastRow > this.lastRowInBuffer) return false
      return true
    }
    return false
  }

  /**
   * Get column names from the header.
   */
  private getColumns(header: Header): string[] | null {
    const columns: string[] = []
    for (let i = 1; i <= this.cols; i++) {
      const key = `TTYPE${i}`
      if (!header.contains(key)) return null
      columns.push(header.getString(key))
    }
    return columns
  }

  /**
   * Read a range of rows from the table.
   *
   * @param row - Starting row index (0-based).
   * @param number_ - Number of rows to read.
   */
  async getRows(
    row: number,
    number_: number,
  ): Promise<TableRow[] | Float32Array | ArrayLike<number>> {
    if (this.rowsInMemory(row, row + number_)) {
      let buf: ArrayBuffer
      if (this.cachedBuffer) {
        const offsetInCache = (row - this.firstRowInBuffer) * this.rowByteSize
        buf = this.cachedBuffer.slice(offsetInCache, offsetInCache + number_ * this.rowByteSize)
      } else if (this.buffer) {
        const begin = row * this.rowByteSize
        const end = begin + number_ * this.rowByteSize
        buf = this.buffer.slice(begin, end)
      } else {
        throw new Error('No data source available')
      }
      return this._getRows(buf, number_) as TableRow[] | Float32Array
    }

    // Read from blob
    if (!this.blob) {
      throw new Error('No data source available')
    }

    const begin = row * this.rowByteSize
    const readRows = Math.max(this.nRowsInBuffer, number_)
    const end = begin + readRows * this.rowByteSize
    const blobSlice = this.blob.slice(begin, end)
    const arrayBuffer = await blobSlice.arrayBuffer()

    this.cachedBuffer = arrayBuffer
    this.firstRowInBuffer = row
    this.lastRowInBuffer = row + readRows

    return this._getRows(arrayBuffer, number_) as TableRow[] | Float32Array
  }

  /**
   * Read a table buffer for a range of rows.
   * Used internally for column-based reading from blob.
   */
  private async getTableBuffer(row: number, number_: number): Promise<ArrayBuffer> {
    const actualRows = Math.min(this.rows - row, number_)
    const begin = row * this.rowByteSize
    const end = begin + actualRows * this.rowByteSize

    if (this.buffer) {
      return this.buffer.slice(begin, end)
    }

    if (!this.blob) {
      throw new Error('No data source available')
    }

    const blobSlice = this.blob.slice(begin, end)
    return blobSlice.arrayBuffer()
  }

  /**
   * Read all values from a single column.
   *
   * @param name - Column name.
   * @returns Array of column values.
   */
  async getColumn(name: string): Promise<unknown[]> {
    if (!this.columns) {
      throw new Error('Column names not available')
    }

    const colIndex = this.columns.indexOf(name)
    if (colIndex === -1) {
      throw new Error(`Column "${name}" not found`)
    }

    if (this.buffer && !this.blob) {
      // Table already in memory — use getRows
      const rows = (await this.getRows(0, this.rows)) as TableRow[]
      return rows.map((d) => d[name])
    }

    // Read column from blob in chunks
    const accessor = this.accessors[colIndex]!
    const elementByteOffset = this.elementByteLengths.slice(0, colIndex).reduce((a, b) => a + b, 0)

    const column: unknown[] = new Array(this.rows)

    const rowsPerIteration = Math.min(
      Math.max(1, Math.floor(this.maxMemory / this.rowByteSize)),
      this.rows,
    )

    const factor = this.rows / rowsPerIteration
    let iterations = Math.floor(factor) === factor ? factor : Math.floor(factor) + 1
    let i = 0
    let chunkIndex = 0

    while (iterations > 0) {
      const startRow = chunkIndex * rowsPerIteration
      const buffer = await this.getTableBuffer(startRow, rowsPerIteration)
      const nRows = buffer.byteLength / this.rowByteSize
      const view = new DataView(buffer)
      let offset = elementByteOffset

      for (let r = 0; r < nRows; r++) {
        column[i] = accessor(view, offset)[0]
        i++
        offset += this.rowByteSize
      }

      iterations--
      chunkIndex++
    }

    return column
  }
}
