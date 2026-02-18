import { BinaryTable } from './binary-table'
import { getExtent, getPixel } from './image-utils'
import { riceDecompress, RiceSetup } from './decompress'
import { N_RANDOM, NULL_VALUE, ZERO_VALUE } from './constants'
import { DecompressionError } from './errors'
import { TYPED_ARRAY_CONSTRUCTORS } from './types'
import type { Header } from './header'
import type { TableRow, TypedArray, AlgorithmParameters } from './types'

/**
 * Predefined random number generator from the FITS tiled image compression standard.
 * This is the same method used by fpack when dithering images during compression.
 * See: http://arxiv.org/pdf/1201.1336v1.pdf
 */
function generateRandomSequence(): Float32Array {
  const a = 16807
  const m = 2147483647
  let seed = 1

  const random = new Float32Array(N_RANDOM)
  for (let i = 0; i < N_RANDOM; i++) {
    const temp = a * seed
    seed = temp - m * Math.floor(temp / m)
    random[i] = seed / m
  }
  return random
}

/** Pre-computed random dithering sequence. */
const RANDOM_SEQUENCE = generateRandomSequence()

/**
 * Reads Rice-compressed FITS images stored as binary tables.
 *
 * Compressed images are stored in BINTABLE extensions with ZIMAGE=T.
 * Each row in the table represents one tile of the image.
 * This class decompresses tiles and reconstructs the full image,
 * applying subtractive dithering when appropriate.
 */
export class CompressedImage extends BinaryTable {
  readonly zcmptype: string
  readonly zbitpix: number
  readonly znaxis: number
  readonly zblank: number | null
  readonly blank: number | null
  readonly zdither: number
  readonly ztile: number[]
  readonly width: number
  readonly height: number
  readonly bzero: number
  readonly bscale: number
  readonly algorithmParameters: AlgorithmParameters
  readonly zquantiz: string

  constructor(header: Header, data: ArrayBuffer | Blob) {
    super(header, data)

    this.zcmptype = header.getString('ZCMPTYPE')
    this.zbitpix = header.getNumber('ZBITPIX')
    this.znaxis = header.getNumber('ZNAXIS')
    this.zblank = header.contains('ZBLANK') ? header.getNumber('ZBLANK') : null
    this.blank = header.contains('BLANK') ? header.getNumber('BLANK') : null
    this.zdither = header.getNumber('ZDITHER0')

    this.ztile = []
    for (let i = 1; i <= this.znaxis; i++) {
      const ztile = header.contains(`ZTILE${i}`)
        ? header.getNumber(`ZTILE${i}`)
        : i === 1
          ? header.getNumber('ZNAXIS1')
          : 1
      this.ztile.push(ztile)
    }

    this.width = header.getNumber('ZNAXIS1')
    this.height = header.getNumber('ZNAXIS2', 1)

    // Set default compression parameters
    this.algorithmParameters = {}
    if (this.zcmptype === 'RICE_1') {
      this.algorithmParameters['BLOCKSIZE'] = 32
      this.algorithmParameters['BYTEPIX'] = 4
    }

    // Override with header-specified parameters
    let paramIdx = 1
    while (header.contains(`ZNAME${paramIdx}`)) {
      const name = header.getString(`ZNAME${paramIdx}`)
      const value = header.getNumber(`ZVAL${paramIdx}`)
      this.algorithmParameters[name] = value
      paramIdx++
    }

    this.zquantiz = header.getString('ZQUANTIZ', 'LINEAR_SCALING')
    this.bzero = header.getNumber('BZERO')
    this.bscale = header.getNumber('BSCALE', 1)

    // Re-initialize accessors now that CompressedImage fields are set.
    // BinaryTable.constructor already called initAccessors, but CompressedImage
    // overrides setAccessors and needs its own fields (width, algorithmParameters, etc.)
    // to be initialized first.
    this.initAccessors(header)
  }

  /**
   * Override setAccessors to replace compressed data column accessors
   * with decompression-aware versions. Delegates base TFORM parsing to BinaryTable.
   */
  protected override setAccessors(header: Header): void {
    // Let BinaryTable handle all the TFORM parsing and standard accessor setup
    super.setAccessors(header)

    // Now replace accessors for compressed columns
    for (let c = 0; c < this.columnTypes.length; c++) {
      const type = this.columnTypes[c]
      const descriptor = this.descriptors[c]!

      if (type === 'COMPRESSED_DATA') {
        this.accessors[c] = (view, offset) => {
          const [arr, newOffset] = this.getFromHeap(view, offset, descriptor)

          // Rice decompression
          const bytepix = this.algorithmParameters['BYTEPIX'] ?? 4
          const blocksize = this.algorithmParameters['BLOCKSIZE'] ?? 32
          const Ctor = TYPED_ARRAY_CONSTRUCTORS[bytepix]
          if (!Ctor) {
            throw new Error(`No typed array for bytepix: ${bytepix}`)
          }
          const tileSize = this.ztile[0] ?? this.width
          const pixels = new Ctor(tileSize) as TypedArray
          riceDecompress(arr as Uint8Array, blocksize, bytepix, pixels, tileSize, RiceSetup)
          return [pixels, newOffset]
        }
      } else if (type === 'GZIP_COMPRESSED_DATA') {
        this.accessors[c] = (_view, _offset) => {
          throw new DecompressionError('GZIP decompression is not yet implemented')
        }
      }
    }
  }

  /**
   * Override _getRows to handle compressed image tile decompression
   * and subtractive dithering.
   */
  protected override _getRows(buffer: ArrayBuffer, nRows: number): Float32Array {
    const view = new DataView(buffer)
    let offset = 0
    const arr = new Float32Array(this.width * this.height)

    let tileIndex = 0
    let rowsRemaining = nRows
    while (rowsRemaining--) {
      tileIndex++
      const row: TableRow = {}
      for (let c = 0; c < this.accessors.length; c++) {
        const [value, newOffset] = this.accessors[c]!(view, offset)
        offset = newOffset
        if (this.columns) {
          row[this.columns[c]!] = value
        }
      }

      // Get compressed data and scaling parameters
      const data = (row['COMPRESSED_DATA'] ||
        row['UNCOMPRESSED_DATA'] ||
        row['GZIP_COMPRESSED_DATA']) as Int32Array | Float32Array
      const scale = (row['ZSCALE'] as number) || this.bscale
      const zero = (row['ZZERO'] as number) || this.bzero

      // Tile number (1-based)
      const nTile = tileIndex

      // Dequantize each pixel in the tile
      const useDither =
        this.zquantiz === 'SUBTRACTIVE_DITHER_1' || this.zquantiz === 'SUBTRACTIVE_DITHER_2'

      // Subtractive dithering setup (only when dithering is enabled)
      let rIndex = 0
      let seed1 = 0
      if (useDither) {
        const seed0 = nTile + this.zdither - 1
        const seed1Initial = (seed0 - 1) % N_RANDOM
        seed1 = seed1Initial < 0 ? seed1Initial + N_RANDOM : seed1Initial
        rIndex = Math.floor(RANDOM_SEQUENCE[seed1]! * 500)
      }

      for (let idx = 0; idx < data.length; idx++) {
        const pixelIndex = (nTile - 1) * this.width + idx
        const value = data[idx]!

        if (value === NULL_VALUE) {
          arr[pixelIndex] = NaN
        } else if (value === ZERO_VALUE) {
          arr[pixelIndex] = 0
        } else if (useDither) {
          const r = RANDOM_SEQUENCE[rIndex]!
          arr[pixelIndex] = (value - r + 0.5) * scale + zero
        } else {
          arr[pixelIndex] = value * scale + zero
        }

        // Update random index (only when dithering)
        if (useDither) {
          rIndex++
          if (rIndex === N_RANDOM) {
            seed1 = (seed1 + 1) % N_RANDOM
            rIndex = Math.floor(RANDOM_SEQUENCE[seed1]! * 500)
          }
        }
      }
    }

    return arr
  }

  /**
   * Read a frame from the compressed image.
   * Exposes the same API as Image.getFrame() for consistency.
   */
  async getFrame(_nFrame: number = 0): Promise<Float32Array> {
    if (this.heap) {
      const result = await this.getRows(0, this.rows)
      return result as Float32Array
    }

    // Need to read heap from blob first
    if (!this.blob) {
      throw new Error('No data source available')
    }

    const heapBlob = this.blob.slice(this.length, this.length + this.heapLength)
    this.heap = await heapBlob.arrayBuffer()

    return this.getFrame(_nFrame)
  }

  /** Compute min/max pixel values, ignoring NaN. */
  getExtent(arr: Float32Array): [number, number] {
    const [min, max] = getExtent(arr)
    return [Number(min), Number(max)]
  }

  /** Get a single pixel value at (x, y). */
  getPixel(arr: Float32Array, x: number, y: number): number {
    return Number(getPixel(arr, x, y, this.width))
  }
}
