import { Tabular } from './tabular'
import type { Header } from './header'
import type { TableRow } from '../core/types'
import { uint8ArrayToString } from '../core/utils'

/**
 * ASCII table accessor functions keyed by format code.
 */
const ASCII_ACCESSORS: Record<string, (value: string) => string | number> = {
  A: (value: string) => value.trim(),
  I: (value: string) => parseInt(value, 10),
  F: (value: string) => parseFloat(value),
  E: (value: string) => parseFloat(value),
  D: (value: string) => parseFloat(value),
}

/**
 * Reads ASCII tables from FITS files (XTENSION = 'TABLE').
 *
 * ASCII tables store data as fixed-width text fields where each row
 * is a sequence of ASCII characters.
 */
export class Table extends Tabular {
  private asciiAccessors: ((value: string) => string | number)[] = []
  /** 0-based start positions for each column within a row. */
  private colStarts: number[] = []
  /** Character widths for each column. */
  private colWidths: number[] = []
  /** Whether TBCOL keywords were found in the header. */
  private hasTBCOL = false

  constructor(header: Header, data: ArrayBuffer | Blob) {
    super(header, data)
    this.initAccessors(header)
  }

  protected setAccessors(header: Header): void {
    this.asciiAccessors = []
    this.colStarts = []
    this.colWidths = []
    this.hasTBCOL = false
    const pattern = /([AIFED])(\d+)\.*(\d+)*/

    // First pass: check if any TBCOL keywords exist
    for (let i = 1; i <= this.cols; i++) {
      if (header.contains(`TBCOL${i}`)) {
        this.hasTBCOL = true
        break
      }
    }

    for (let i = 1; i <= this.cols; i++) {
      const form = header.getString(`TFORM${i}`)
      const match = pattern.exec(form)
      if (!match) {
        this.asciiAccessors.push((v: string) => v.trim())
        this.colStarts.push(0)
        this.colWidths.push(0)
        continue
      }

      const descriptor = match[1]!
      const width = parseInt(match[2]!, 10)
      const fn = ASCII_ACCESSORS[descriptor] ?? ((v: string) => v.trim())
      this.asciiAccessors.push(fn)

      // TBCOL is 1-based per FITS standard
      const tbcol = header.contains(`TBCOL${i}`) ? header.getNumber(`TBCOL${i}`) - 1 : 0
      this.colStarts.push(tbcol)
      this.colWidths.push(width)
    }
  }

  protected override _getRows(buffer: ArrayBuffer, _nRows?: number): TableRow[] {
    const nRows = buffer.byteLength / this.rowByteSize
    const arr = new Uint8Array(buffer)
    const rows: TableRow[] = []
    const accessors = this.asciiAccessors ?? []

    for (let i = 0; i < nRows; i++) {
      const begin = i * this.rowByteSize
      const end = begin + this.rowByteSize
      const subarray = arr.subarray(begin, end)
      const line = uint8ArrayToString(subarray)

      const row: TableRow = {}
      if (this.hasTBCOL) {
        // Fixed-width extraction using TBCOL positions
        for (let j = 0; j < accessors.length; j++) {
          const start = this.colStarts[j]!
          const width = this.colWidths[j]!
          const value = line.substring(start, start + width).trim()
          if (this.columns) {
            row[this.columns[j]!] = accessors[j]!(value)
          }
        }
      } else {
        // Fallback: whitespace splitting (when TBCOL is not available)
        const fields = line.trim().split(/\s+/)
        for (let j = 0; j < accessors.length; j++) {
          const value = fields[j] ?? ''
          if (this.columns) {
            row[this.columns[j]!] = accessors[j]!(value)
          }
        }
      }
      rows.push(row)
    }

    return rows
  }
}
