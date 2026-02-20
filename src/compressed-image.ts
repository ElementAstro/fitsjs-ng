import { BinaryTable } from './binary-table'
import { getExtent, getPixel } from './image-utils'
import { riceDecompress, RiceSetup } from './decompress'
import { hDecompressInt32 } from './hcompress-decode'
import { N_RANDOM, NULL_VALUE, ZERO_VALUE } from './constants'
import { DecompressionError } from './errors'
import { TYPED_ARRAY_CONSTRUCTORS } from './types'
import { gunzipSync } from 'fflate'
import type { Header } from './header'
import type { TableRow, TypedArray, AlgorithmParameters } from './types'

export interface CompressedImageDecodeContext {
  algorithm: string
  compressedBytes: Uint8Array
  compressedData: TypedArray
  descriptor: string
  zbitpix: number
  tileSize: number
  ztile: readonly number[]
  algorithmParameters: Readonly<AlgorithmParameters>
}

export interface CompressedImageDecoderProvider {
  decodeTile(context: CompressedImageDecodeContext): ArrayLike<number> | null | undefined
}

export interface CompressedImageOptions {
  decoderProvider?: CompressedImageDecoderProvider
}

let globalCompressedImageDecoderProvider: CompressedImageDecoderProvider | undefined

export function setCompressedImageDecoderProvider(
  decoderProvider: CompressedImageDecoderProvider | undefined,
): void {
  globalCompressedImageDecoderProvider = decoderProvider
}

export function getCompressedImageDecoderProvider(): CompressedImageDecoderProvider | undefined {
  return globalCompressedImageDecoderProvider
}

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

function decodePLIOWordsToPixels(lineList: Int16Array, tileSize: number): Int32Array {
  const word = (index1Based: number): number => lineList[index1Based - 1] ?? 0

  let lineLength: number
  let lineFirst: number
  if (word(3) > 0) {
    lineLength = word(3)
    lineFirst = 4
  } else {
    lineLength = (word(5) << 15) + (word(4) & 0x7fff)
    lineFirst = word(2) + 1
  }

  const pixels = new Int32Array(tileSize)
  if (tileSize <= 0 || lineLength <= 0) {
    return pixels
  }

  const xs = 1
  const xe = xs + tileSize - 1
  let skipNextWord = false
  let outputPosition = 1
  let x1 = 1
  let previousValue = 1

  for (let ip = lineFirst; ip <= lineLength; ip++) {
    if (skipNextWord) {
      skipNextWord = false
      continue
    }

    const instruction = word(ip)
    const opcode = Math.trunc(instruction / 4096)
    const data = instruction & 4095

    if (opcode === 0 || opcode === 4 || opcode === 5) {
      const x2 = x1 + data - 1
      const i1 = Math.max(x1, xs)
      const i2 = Math.min(x2, xe)
      const count = i2 - i1 + 1
      if (count > 0) {
        const outputTop = outputPosition + count - 1
        if (opcode === 4) {
          for (let i = outputPosition; i <= outputTop; i++) {
            pixels[i - 1] = previousValue
          }
        } else {
          for (let i = outputPosition; i <= outputTop; i++) {
            pixels[i - 1] = 0
          }
          if (opcode === 5 && i2 === x2) {
            pixels[outputTop - 1] = previousValue
          }
        }
        outputPosition = outputTop + 1
      }
      x1 = x2 + 1
    } else if (opcode === 1) {
      previousValue = (word(ip + 1) << 12) + data
      skipNextWord = true
    } else if (opcode === 2) {
      previousValue += data
    } else if (opcode === 3) {
      previousValue -= data
    } else if (opcode === 6 || opcode === 7) {
      previousValue += opcode === 6 ? data : -data
      if (x1 >= xs && x1 <= xe) {
        pixels[outputPosition - 1] = previousValue
        outputPosition++
      }
      x1++
    }

    if (x1 > xe) {
      break
    }
  }

  for (let i = outputPosition; i <= tileSize; i++) {
    pixels[i - 1] = 0
  }
  return pixels
}

function decodePLIOData(data: TypedArray): Int16Array {
  if (data instanceof Int16Array) {
    return data
  }
  if (data instanceof Uint8Array) {
    if (data.byteLength % 2 !== 0) {
      throw new DecompressionError('PLIO_1 compressed stream must contain 16-bit words')
    }
    const words = new Int16Array(data.byteLength / 2)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let i = 0; i < words.length; i++) {
      words[i] = view.getInt16(i * 2, false)
    }
    return words
  }

  if (data instanceof Uint16Array) {
    const words = new Int16Array(data.length)
    for (let i = 0; i < data.length; i++) {
      words[i] = (data[i]! << 16) >> 16
    }
    return words
  }

  throw new DecompressionError(
    `PLIO_1 requires Int16Array/Uint16Array/Uint8Array compressed payload, got ${data.constructor.name}`,
  )
}

function toByteView(data: TypedArray): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function decodeBigEndianTileValues(
  compressedBytes: Uint8Array,
  zbitpix: number,
  tileSize: number,
): ArrayLike<number> {
  const view = new DataView(
    compressedBytes.buffer,
    compressedBytes.byteOffset,
    compressedBytes.byteLength,
  )
  if (zbitpix === 8) {
    if (compressedBytes.byteLength < tileSize) {
      throw new DecompressionError('Decoded GZIP tile is smaller than expected for BITPIX=8')
    }
    const out = new Int32Array(tileSize)
    for (let i = 0; i < tileSize; i++) out[i] = compressedBytes[i]!
    return out
  }
  if (zbitpix === 16) {
    if (compressedBytes.byteLength < tileSize * 2) {
      throw new DecompressionError('Decoded GZIP tile is smaller than expected for BITPIX=16')
    }
    const out = new Int32Array(tileSize)
    for (let i = 0; i < tileSize; i++) out[i] = view.getInt16(i * 2, false)
    return out
  }
  if (zbitpix === 32) {
    if (compressedBytes.byteLength < tileSize * 4) {
      throw new DecompressionError('Decoded GZIP tile is smaller than expected for BITPIX=32')
    }
    const out = new Int32Array(tileSize)
    for (let i = 0; i < tileSize; i++) out[i] = view.getInt32(i * 4, false)
    return out
  }
  if (zbitpix === 64) {
    if (compressedBytes.byteLength < tileSize * 8) {
      throw new DecompressionError('Decoded GZIP tile is smaller than expected for BITPIX=64')
    }
    const out = new Float64Array(tileSize)
    for (let i = 0; i < tileSize; i++) out[i] = Number(view.getBigInt64(i * 8, false))
    return out
  }
  if (zbitpix === -32) {
    if (compressedBytes.byteLength < tileSize * 4) {
      throw new DecompressionError('Decoded GZIP tile is smaller than expected for BITPIX=-32')
    }
    const out = new Float32Array(tileSize)
    for (let i = 0; i < tileSize; i++) out[i] = view.getFloat32(i * 4, false)
    return out
  }
  if (zbitpix === -64) {
    if (compressedBytes.byteLength < tileSize * 8) {
      throw new DecompressionError('Decoded GZIP tile is smaller than expected for BITPIX=-64')
    }
    const out = new Float64Array(tileSize)
    for (let i = 0; i < tileSize; i++) out[i] = view.getFloat64(i * 8, false)
    return out
  }
  throw new DecompressionError(`Unsupported ZBITPIX for GZIP_1: ${zbitpix}`)
}

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
  readonly decoderProvider?: CompressedImageDecoderProvider
  private currentTilePixelCount?: number

  constructor(header: Header, data: ArrayBuffer | Blob, options: CompressedImageOptions = {}) {
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
    this.decoderProvider = options.decoderProvider

    // Re-initialize accessors now that CompressedImage fields are set.
    // BinaryTable.constructor already called initAccessors, but CompressedImage
    // overrides setAccessors and needs its own fields (width, algorithmParameters, etc.)
    // to be initialized first.
    this.initAccessors(header)
  }

  private decodeCompressedTile(
    compressedData: TypedArray,
    descriptor: string,
    tileSize: number,
  ): ArrayLike<number> {
    const compressedBytes = toByteView(compressedData)

    if (this.zcmptype === 'RICE_1') {
      const bytepix = this.algorithmParameters['BYTEPIX'] ?? 4
      const blocksize = this.algorithmParameters['BLOCKSIZE'] ?? 32
      const Ctor = TYPED_ARRAY_CONSTRUCTORS[bytepix]
      if (!Ctor) {
        throw new Error(`No typed array for bytepix: ${bytepix}`)
      }
      const pixels = new Ctor(tileSize) as TypedArray
      riceDecompress(compressedBytes as Uint8Array, blocksize, bytepix, pixels, tileSize, RiceSetup)
      return pixels as unknown as ArrayLike<number>
    }

    if (this.zcmptype === 'GZIP_1') {
      const raw = gunzipSync(compressedBytes)
      return decodeBigEndianTileValues(raw, this.zbitpix, tileSize)
    }
    if (this.zcmptype === 'PLIO_1') {
      const words = decodePLIOData(compressedData)
      return decodePLIOWordsToPixels(words, tileSize)
    }
    if (this.zcmptype === 'HCOMPRESS_1') {
      const smooth = (this.algorithmParameters['SMOOTH'] ?? 0) !== 0
      const decoded = hDecompressInt32(compressedBytes, smooth).pixels
      if (decoded.length !== tileSize) {
        throw new DecompressionError(
          `HCOMPRESS_1 tile length mismatch (decoded=${decoded.length}, expected=${tileSize})`,
        )
      }
      return decoded
    }

    const provider = this.decoderProvider ?? globalCompressedImageDecoderProvider
    if (provider) {
      const decoded = provider.decodeTile({
        algorithm: this.zcmptype,
        compressedBytes,
        compressedData,
        descriptor,
        zbitpix: this.zbitpix,
        tileSize,
        ztile: this.ztile,
        algorithmParameters: this.algorithmParameters,
      })
      if (decoded !== undefined && decoded !== null) {
        return decoded
      }
    }

    throw new DecompressionError(`Unsupported compressed image algorithm: ${this.zcmptype}`)
  }

  private getNominalTileWidth(): number {
    return this.ztile?.[0] ?? this.width
  }

  private getNominalTileHeight(): number {
    return this.ztile?.[1] ?? 1
  }

  private getDefaultTilePixelCount(): number {
    return this.getNominalTileWidth() * this.getNominalTileHeight()
  }

  private getTilePlacement(tileIndex1Based: number): {
    x: number
    y: number
    width: number
    height: number
    pixelCount: number
  } {
    const nominalTileWidth = this.getNominalTileWidth()
    const nominalTileHeight = this.getNominalTileHeight()
    const tilesX = Math.max(1, Math.ceil(this.width / nominalTileWidth))

    const tileIndex0 = Math.max(0, tileIndex1Based - 1)
    const tileXIndex = tileIndex0 % tilesX
    const tileYIndex = Math.floor(tileIndex0 / tilesX)

    const x = tileXIndex * nominalTileWidth
    const y = tileYIndex * nominalTileHeight
    const width = Math.max(0, Math.min(nominalTileWidth, this.width - x))
    const height = Math.max(0, Math.min(nominalTileHeight, this.height - y))

    return {
      x,
      y,
      width,
      height,
      pixelCount: width * height,
    }
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
          const tileSize = this.currentTilePixelCount ?? this.getDefaultTilePixelCount()
          return [this.decodeCompressedTile(arr, descriptor, tileSize), newOffset]
        }
      } else if (type === 'GZIP_COMPRESSED_DATA') {
        this.accessors[c] = (view, offset) => {
          const [arr, newOffset] = this.getFromHeap(view, offset, descriptor)
          const compressedBytes =
            arr instanceof Uint8Array
              ? arr
              : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
          const tileSize = this.currentTilePixelCount ?? this.getDefaultTilePixelCount()
          const raw = gunzipSync(compressedBytes)
          return [decodeBigEndianTileValues(raw, this.zbitpix, tileSize), newOffset]
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
      const nTile = tileIndex
      const tilePlacement = this.getTilePlacement(nTile)
      this.currentTilePixelCount = tilePlacement.pixelCount

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
        row['GZIP_COMPRESSED_DATA']) as ArrayLike<number>
      const scale = (row['ZSCALE'] as number) || this.bscale
      const zero = (row['ZZERO'] as number) || this.bzero

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

      const decodeLength = Math.min(data.length, tilePlacement.pixelCount)
      for (let idx = 0; idx < decodeLength; idx++) {
        if (tilePlacement.width <= 0 || tilePlacement.height <= 0) {
          continue
        }

        const localX = idx % tilePlacement.width
        const localY = Math.floor(idx / tilePlacement.width)
        if (localY >= tilePlacement.height) {
          break
        }

        const pixelIndex = (tilePlacement.y + localY) * this.width + tilePlacement.x + localX
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

      this.currentTilePixelCount = undefined
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
