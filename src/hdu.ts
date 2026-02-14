import type { Header } from './header'
import type { DataUnit } from './data-unit'

/**
 * Header Data Unit — the fundamental building block of a FITS file.
 *
 * Each HDU contains a header and an optional data unit. The header
 * describes the structure and metadata of the data unit.
 */
export class HDU {
  readonly header: Header
  readonly data?: DataUnit

  constructor(header: Header, data?: DataUnit) {
    this.header = header
    this.data = data
  }

  /**
   * Check if this HDU has an associated data unit.
   */
  hasData(): boolean {
    return this.data !== undefined
  }
}
