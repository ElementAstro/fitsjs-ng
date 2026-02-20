import { DecompressionError } from '../core/errors'

const HCOMPRESS_MAGIC0 = 0xdd
const HCOMPRESS_MAGIC1 = 0x99

class BitReader {
  private nextChar = 0
  private bitBuffer = 0
  private bitsToGo = 0

  constructor(private readonly bytes: Uint8Array) {}

  readInt32BE(): number {
    const b0 = this.readByte()
    const b1 = this.readByte()
    const b2 = this.readByte()
    const b3 = this.readByte()
    return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3 | 0
  }

  readInt64BE(): bigint {
    let value = 0n
    for (let i = 0; i < 8; i++) {
      value = (value << 8n) + BigInt(this.readByte())
    }
    if ((value & (1n << 63n)) !== 0n) {
      value -= 1n << 64n
    }
    return value
  }

  readByte(): number {
    if (this.nextChar >= this.bytes.byteLength) {
      throw new DecompressionError('Unexpected end of HCOMPRESS stream')
    }
    const value = this.bytes[this.nextChar]
    this.nextChar += 1
    return value!
  }

  startBitInput(): void {
    this.bitsToGo = 0
  }

  inputBit(): number {
    if (this.bitsToGo === 0) {
      this.bitBuffer = this.readByte()
      this.bitsToGo = 8
    }
    this.bitsToGo -= 1
    return (this.bitBuffer >> this.bitsToGo) & 1
  }

  inputNBits(n: number): number {
    if (this.bitsToGo < n) {
      this.bitBuffer = (this.bitBuffer << 8) | this.readByte()
      this.bitsToGo += 8
    }
    this.bitsToGo -= n
    return (this.bitBuffer >> this.bitsToGo) & ((1 << n) - 1)
  }

  inputNybble(): number {
    if (this.bitsToGo < 4) {
      this.bitBuffer = (this.bitBuffer << 8) | this.readByte()
      this.bitsToGo += 8
    }
    this.bitsToGo -= 4
    return (this.bitBuffer >> this.bitsToGo) & 0x0f
  }

  inputNNybble(n: number, out: Uint8Array): void {
    for (let i = 0; i < n; i++) {
      out[i] = this.inputNybble()
    }
  }
}

function inputHuffman(reader: BitReader): number {
  let code = reader.inputNBits(3)
  if (code < 4) {
    return 1 << code
  }

  code = reader.inputBit() | (code << 1)
  if (code < 13) {
    switch (code) {
      case 8:
        return 3
      case 9:
        return 5
      case 10:
        return 10
      case 11:
        return 12
      case 12:
        return 15
    }
  }

  code = reader.inputBit() | (code << 1)
  if (code < 31) {
    switch (code) {
      case 26:
        return 6
      case 27:
        return 7
      case 28:
        return 9
      case 29:
        return 11
      case 30:
        return 13
    }
  }

  code = reader.inputBit() | (code << 1)
  return code === 62 ? 0 : 14
}

function qtreeBitins(
  source: Uint8Array,
  nx: number,
  ny: number,
  target: Int32Array,
  rowStride: number,
  bit: number,
): void {
  const planeValue = 1 << bit
  let k = 0
  let i = 0
  for (; i < nx - 1; i += 2) {
    let s00 = rowStride * i
    let j = 0
    for (; j < ny - 1; j += 2) {
      const value = source[k]!
      if ((value & 1) !== 0) target[s00 + rowStride + 1] = target[s00 + rowStride + 1]! | planeValue
      if ((value & 2) !== 0) target[s00 + rowStride] = target[s00 + rowStride]! | planeValue
      if ((value & 4) !== 0) target[s00 + 1] = target[s00 + 1]! | planeValue
      if ((value & 8) !== 0) target[s00] = target[s00]! | planeValue
      s00 += 2
      k += 1
    }
    if (j < ny) {
      const value = source[k]!
      if ((value & 2) !== 0) target[s00 + rowStride] = target[s00 + rowStride]! | planeValue
      if ((value & 8) !== 0) target[s00] = target[s00]! | planeValue
      k += 1
    }
  }
  if (i < nx) {
    let s00 = rowStride * i
    let j = 0
    for (; j < ny - 1; j += 2) {
      const value = source[k]!
      if ((value & 4) !== 0) target[s00 + 1] = target[s00 + 1]! | planeValue
      if ((value & 8) !== 0) target[s00] = target[s00]! | planeValue
      s00 += 2
      k += 1
    }
    if (j < ny) {
      const value = source[k]!
      if ((value & 8) !== 0) target[s00] = target[s00]! | planeValue
      k += 1
    }
  }
}

function qtreeCopy(
  source: Uint8Array,
  nx: number,
  ny: number,
  target: Uint8Array,
  rowStride: number,
): void {
  const nx2 = (nx + 1) >> 1
  const ny2 = (ny + 1) >> 1

  let k = ny2 * (nx2 - 1) + ny2 - 1
  for (let i = nx2 - 1; i >= 0; i--) {
    let s00 = 2 * (rowStride * i + ny2 - 1)
    for (let j = ny2 - 1; j >= 0; j--) {
      target[s00] = source[k]!
      k -= 1
      s00 -= 2
    }
  }

  let i = 0
  for (; i < nx - 1; i += 2) {
    let s00 = rowStride * i
    let s10 = s00 + rowStride
    let j = 0
    for (; j < ny - 1; j += 2) {
      const value = target[s00]!
      target[s10 + 1] = value & 1
      target[s10] = (value >> 1) & 1
      target[s00 + 1] = (value >> 2) & 1
      target[s00] = (value >> 3) & 1
      s00 += 2
      s10 += 2
    }
    if (j < ny) {
      const value = target[s00]!
      target[s10] = (value >> 1) & 1
      target[s00] = (value >> 3) & 1
    }
  }

  if (i < nx) {
    let s00 = rowStride * i
    let j = 0
    for (; j < ny - 1; j += 2) {
      const value = target[s00]!
      target[s00 + 1] = (value >> 2) & 1
      target[s00] = (value >> 3) & 1
      s00 += 2
    }
    if (j < ny) {
      target[s00] = (target[s00]! >> 3) & 1
    }
  }
}

function qtreeExpand(
  reader: BitReader,
  source: Uint8Array,
  nx: number,
  ny: number,
  target: Uint8Array,
): void {
  qtreeCopy(source, nx, ny, target, ny)
  for (let i = nx * ny - 1; i >= 0; i--) {
    if (target[i] !== 0) {
      target[i] = inputHuffman(reader)
    }
  }
}

function readBdirect(
  reader: BitReader,
  target: Int32Array,
  rowStride: number,
  nqx: number,
  nqy: number,
  scratch: Uint8Array,
  bit: number,
): void {
  const count = ((nqx + 1) >> 1) * ((nqy + 1) >> 1)
  reader.inputNNybble(count, scratch)
  qtreeBitins(scratch, nqx, nqy, target, rowStride, bit)
}

function qtreeDecode(
  reader: BitReader,
  target: Int32Array,
  rowStride: number,
  nqx: number,
  nqy: number,
  nBitplanes: number,
): void {
  if (nBitplanes <= 0 || nqx <= 0 || nqy <= 0) {
    return
  }

  const nqmax = nqx > nqy ? nqx : nqy
  let log2n = Math.floor(Math.log(nqmax) / Math.log(2) + 0.5)
  if (nqmax > 1 << log2n) {
    log2n += 1
  }

  const nqx2 = (nqx + 1) >> 1
  const nqy2 = (nqy + 1) >> 1
  const scratch = new Uint8Array(nqx2 * nqy2)

  for (let bit = nBitplanes - 1; bit >= 0; bit--) {
    const formatCode = reader.inputNybble()
    if (formatCode === 0) {
      readBdirect(reader, target, rowStride, nqx, nqy, scratch, bit)
      continue
    }
    if (formatCode !== 0x0f) {
      throw new DecompressionError('Invalid HCOMPRESS bitplane format code')
    }

    scratch[0] = inputHuffman(reader)
    let nx = 1
    let ny = 1
    let nfx = nqx
    let nfy = nqy
    let c = 1 << log2n
    for (let k = 1; k < log2n; k++) {
      c >>= 1
      nx <<= 1
      ny <<= 1
      if (nfx <= c) {
        nx -= 1
      } else {
        nfx -= c
      }
      if (nfy <= c) {
        ny -= 1
      } else {
        nfy -= c
      }
      qtreeExpand(reader, scratch, nx, ny, scratch)
    }
    qtreeBitins(scratch, nqx, nqy, target, rowStride, bit)
  }
}

function unshuffle(
  values: Int32Array,
  start: number,
  n: number,
  n2: number,
  tmp: Int32Array,
): void {
  const nhalf = (n + 1) >> 1
  let pt = 0
  let p1 = start + n2 * nhalf
  for (let i = nhalf; i < n; i++) {
    tmp[pt++] = values[p1]!
    p1 += n2
  }

  let p2 = start + n2 * (nhalf - 1)
  p1 = start + ((n2 * (nhalf - 1)) << 1)
  for (let i = nhalf - 1; i >= 0; i--) {
    values[p1] = values[p2]!
    p2 -= n2
    p1 -= n2 + n2
  }

  pt = 0
  p1 = start + n2
  for (let i = 1; i < n; i += 2) {
    values[p1] = tmp[pt++]!
    p1 += n2 + n2
  }
}

function hsmooth(
  values: Int32Array,
  nxTop: number,
  nyTop: number,
  ny: number,
  scale: number,
): void {
  const smax = scale >> 1
  if (smax <= 0) return
  const ny2 = ny << 1

  for (let i = 2; i < nxTop - 2; i += 2) {
    let s00 = ny * i
    let s10 = s00 + ny
    for (let j = 0; j < nyTop; j += 2) {
      const hm = values[s00 - ny2]!
      const h0 = values[s00]!
      const hp = values[s00 + ny2]!
      let diff = hp - hm
      const dmax = Math.max(Math.min(hp - h0, h0 - hm), 0) << 2
      const dmin = Math.min(Math.max(hp - h0, h0 - hm), 0) << 2
      if (dmin < dmax) {
        diff = Math.max(Math.min(diff, dmax), dmin)
        let s = diff - (values[s10]! << 3)
        s = s >= 0 ? s >> 3 : (s + 7) >> 3
        s = Math.max(Math.min(s, smax), -smax)
        values[s10] = (values[s10]! + s) | 0
      }
      s00 += 2
      s10 += 2
    }
  }

  for (let i = 0; i < nxTop; i += 2) {
    let s00 = ny * i + 2
    for (let j = 2; j < nyTop - 2; j += 2) {
      const hm = values[s00 - 2]!
      const h0 = values[s00]!
      const hp = values[s00 + 2]!
      let diff = hp - hm
      const dmax = Math.max(Math.min(hp - h0, h0 - hm), 0) << 2
      const dmin = Math.min(Math.max(hp - h0, h0 - hm), 0) << 2
      if (dmin < dmax) {
        diff = Math.max(Math.min(diff, dmax), dmin)
        let s = diff - (values[s00 + 1]! << 3)
        s = s >= 0 ? s >> 3 : (s + 7) >> 3
        s = Math.max(Math.min(s, smax), -smax)
        values[s00 + 1] = (values[s00 + 1]! + s) | 0
      }
      s00 += 2
    }
  }

  for (let i = 2; i < nxTop - 2; i += 2) {
    let s00 = ny * i + 2
    let s10 = s00 + ny
    for (let j = 2; j < nyTop - 2; j += 2) {
      const hmm = values[s00 - ny2 - 2]!
      const hpm = values[s00 + ny2 - 2]!
      const hmp = values[s00 - ny2 + 2]!
      const hpp = values[s00 + ny2 + 2]!
      const h0 = values[s00]!
      let diff = hpp + hmm - hmp - hpm
      const hx2 = values[s10]! << 1
      const hy2 = values[s00 + 1]! << 1
      let m1 = Math.min(Math.max(hpp - h0, 0) - hx2 - hy2, Math.max(h0 - hpm, 0) + hx2 - hy2)
      let m2 = Math.min(Math.max(h0 - hmp, 0) - hx2 + hy2, Math.max(hmm - h0, 0) + hx2 + hy2)
      const dmax = Math.min(m1, m2) << 4
      m1 = Math.max(Math.min(hpp - h0, 0) - hx2 - hy2, Math.min(h0 - hpm, 0) + hx2 - hy2)
      m2 = Math.max(Math.min(h0 - hmp, 0) - hx2 + hy2, Math.min(hmm - h0, 0) + hx2 + hy2)
      const dmin = Math.max(m1, m2) << 4
      if (dmin < dmax) {
        diff = Math.max(Math.min(diff, dmax), dmin)
        let s = diff - (values[s10 + 1]! << 6)
        s = s >= 0 ? s >> 6 : (s + 63) >> 6
        s = Math.max(Math.min(s, smax), -smax)
        values[s10 + 1] = (values[s10 + 1]! + s) | 0
      }
      s00 += 2
      s10 += 2
    }
  }
}

function undigitize(values: Int32Array, scale: number): void {
  if (scale <= 1) return
  for (let i = 0; i < values.length; i++) {
    values[i] = Math.imul(values[i]!, scale)
  }
}

function hinv(values: Int32Array, nx: number, ny: number, smooth: boolean, scale: number): void {
  const nmax = nx > ny ? nx : ny
  let log2n = Math.floor(Math.log(nmax) / Math.log(2) + 0.5)
  if (nmax > 1 << log2n) {
    log2n += 1
  }

  const tmp = new Int32Array((nmax + 1) >> 1)

  let shift = 1
  let bit0 = 1 << (log2n - 1)
  let bit1 = bit0 << 1
  let bit2 = bit0 << 2
  let mask0 = -bit0
  let mask1 = mask0 << 1
  const mask2 = mask0 << 2
  let prnd0 = bit0 >> 1
  let prnd1 = bit1 >> 1
  const prnd2 = bit2 >> 1
  let nrnd0 = prnd0 - 1
  let nrnd1 = prnd1 - 1
  const nrnd2 = prnd2 - 1

  values[0] = (values[0]! + (values[0]! >= 0 ? prnd2 : nrnd2)) & mask2

  let nxTop = 1
  let nyTop = 1
  let nxf = nx
  let nyf = ny
  let c = 1 << log2n

  for (let k = log2n - 1; k >= 0; k--) {
    c >>= 1
    nxTop <<= 1
    nyTop <<= 1
    if (nxf <= c) {
      nxTop -= 1
    } else {
      nxf -= c
    }
    if (nyf <= c) {
      nyTop -= 1
    } else {
      nyf -= c
    }

    if (k === 0) {
      nrnd0 = 0
      shift = 2
    }

    for (let i = 0; i < nxTop; i++) {
      unshuffle(values, ny * i, nyTop, 1, tmp)
    }
    for (let j = 0; j < nyTop; j++) {
      unshuffle(values, j, nxTop, ny, tmp)
    }

    if (smooth) {
      hsmooth(values, nxTop, nyTop, ny, scale)
    }

    const oddx = nxTop % 2
    const oddy = nyTop % 2
    let i = 0
    for (; i < nxTop - oddx; i += 2) {
      let s00 = ny * i
      let s10 = s00 + ny
      let j = 0
      for (; j < nyTop - oddy; j += 2) {
        let h0 = values[s00]!
        let hx = values[s10]!
        let hy = values[s00 + 1]!
        let hc = values[s10 + 1]!
        hx = (hx + (hx >= 0 ? prnd1 : nrnd1)) & mask1
        hy = (hy + (hy >= 0 ? prnd1 : nrnd1)) & mask1
        hc = (hc + (hc >= 0 ? prnd0 : nrnd0)) & mask0
        const lowbit0 = hc & bit0
        hx = hx >= 0 ? hx - lowbit0 : hx + lowbit0
        hy = hy >= 0 ? hy - lowbit0 : hy + lowbit0
        const lowbit1 = (hc ^ hx ^ hy) & bit1
        h0 = h0 >= 0 ? h0 + lowbit0 - lowbit1 : h0 + (lowbit0 === 0 ? lowbit1 : lowbit0 - lowbit1)

        values[s10 + 1] = (h0 + hx + hy + hc) >> shift
        values[s10] = (h0 + hx - hy - hc) >> shift
        values[s00 + 1] = (h0 - hx + hy - hc) >> shift
        values[s00] = (h0 - hx - hy + hc) >> shift
        s00 += 2
        s10 += 2
      }
      if (oddy) {
        let h0 = values[s00]!
        let hx = values[s10]!
        hx = (hx + (hx >= 0 ? prnd1 : nrnd1)) & mask1
        const lowbit1 = hx & bit1
        h0 = h0 >= 0 ? h0 - lowbit1 : h0 + lowbit1
        values[s10] = (h0 + hx) >> shift
        values[s00] = (h0 - hx) >> shift
      }
    }

    if (oddx) {
      let s00 = ny * i
      let j = 0
      for (; j < nyTop - oddy; j += 2) {
        let h0 = values[s00]!
        let hy = values[s00 + 1]!
        hy = (hy + (hy >= 0 ? prnd1 : nrnd1)) & mask1
        const lowbit1 = hy & bit1
        h0 = h0 >= 0 ? h0 - lowbit1 : h0 + lowbit1
        values[s00 + 1] = (h0 + hy) >> shift
        values[s00] = (h0 - hy) >> shift
        s00 += 2
      }
      if (oddy) {
        values[s00] = values[s00]! >> shift
      }
    }

    bit2 = bit1
    bit1 = bit0
    bit0 >>= 1
    mask1 = mask0
    mask0 >>= 1
    prnd1 = prnd0
    prnd0 >>= 1
    nrnd1 = nrnd0
    nrnd0 = prnd0 - 1
  }
}

interface DecodeResult {
  pixels: Int32Array
  nx: number
  ny: number
}

function decodeCore(reader: BitReader, smooth: boolean): DecodeResult {
  const magic0 = reader.readByte()
  const magic1 = reader.readByte()
  if (magic0 !== HCOMPRESS_MAGIC0 || magic1 !== HCOMPRESS_MAGIC1) {
    throw new DecompressionError('Invalid HCOMPRESS stream magic')
  }

  const nx = reader.readInt32BE()
  const ny = reader.readInt32BE()
  const scale = reader.readInt32BE()
  const sumAll = Number(reader.readInt64BE())
  const nBitplanes = Uint8Array.from([reader.readByte(), reader.readByte(), reader.readByte()])

  const values = new Int32Array(nx * ny)
  const nx2 = (nx + 1) >> 1
  const ny2 = (ny + 1) >> 1

  reader.startBitInput()
  qtreeDecode(reader, values.subarray(0), ny, nx2, ny2, nBitplanes[0]!)
  qtreeDecode(reader, values.subarray(ny2), ny, nx2, Math.floor(ny / 2), nBitplanes[1]!)
  qtreeDecode(reader, values.subarray(ny * nx2), ny, Math.floor(nx / 2), ny2, nBitplanes[1]!)
  qtreeDecode(
    reader,
    values.subarray(ny * nx2 + ny2),
    ny,
    Math.floor(nx / 2),
    Math.floor(ny / 2),
    nBitplanes[2]!,
  )

  if (reader.inputNybble() !== 0) {
    throw new DecompressionError('Invalid HCOMPRESS bit-plane termination marker')
  }

  reader.startBitInput()
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== 0 && reader.inputBit() !== 0) {
      values[i] = -values[i]!
    }
  }

  values[0] = sumAll | 0
  undigitize(values, scale)
  hinv(values, nx, ny, smooth, scale)
  return { pixels: values, nx, ny }
}

export function hDecompressInt32(input: Uint8Array, smooth: boolean = false): DecodeResult {
  const reader = new BitReader(input)
  return decodeCore(reader, smooth)
}
