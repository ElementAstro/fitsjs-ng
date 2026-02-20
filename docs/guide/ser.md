# SER Guide

`fitsjs-ng` provides full SER v3 support for:

- SER reading (`ArrayBuffer`, `Blob`, URL, Node buffer-like input)
- SER writing
- `SER ↔ FITS`
- `SER ↔ XISF`

## Quick Start

```ts
import {
  SER,
  parseSERBuffer,
  parseSERBlob,
  convertSerToFits,
  convertFitsToSer,
  convertSerToXisf,
  convertXisfToSer,
} from 'fitsjs-ng'

const ser = SER.fromArrayBuffer(buffer)
const parsed = parseSERBuffer(buffer)
const parsedBlob = await parseSERBlob(new Blob([buffer]))

const firstFrame = ser.getFrame(0)
const firstRGB = ser.getFrameRGB(0)

const fits = await convertSerToFits(buffer)
const serBack = await convertFitsToSer(fits, { sourceLayout: 'auto' })
const xisf = await convertSerToXisf(buffer)
const serFromXisf = await convertXisfToSer(xisf as ArrayBuffer)
```

## Parser Entry APIs

Use parser helpers when you need structured metadata/offset information directly:

```ts
const parsed = parseSERBuffer(buffer, {
  strictValidation: true,
  endiannessPolicy: 'compat',
})

const parsedFromBlob = await parseSERBlob(blob, {
  strictValidation: false,
  endiannessPolicy: 'auto',
})
```

## Sequence Metrics

`SER` exposes convenience metrics from trailer timestamps:

```ts
const frameCount = ser.getFrameCount()
const durationTicks = ser.getDurationTicks()
const durationSeconds = ser.getDurationSeconds()
const fps = ser.getEstimatedFPS()
const firstTimestampDate = ser.getTimestampDate(0)
```

## Endianness Policy

SER uses a historical endianness flag with ecosystem ambiguity for 16-bit data.

- `compat` (default): compatible with mainstream astronomy tools
- `spec`: strict interpretation of the specification bit meaning
- `auto`: heuristic fallback based on frame statistics

```ts
const compat = SER.fromArrayBuffer(buffer, { endiannessPolicy: 'compat' })
const spec = SER.fromArrayBuffer(buffer, { endiannessPolicy: 'spec' })
const auto = SER.fromArrayBuffer(buffer, { endiannessPolicy: 'auto' })
```

## FITS Layout Strategies

`convertSerToFits` supports two output layouts:

- `layout: 'cube'` (default): one image HDU storing full sequence depth
- `layout: 'multi-hdu'`: one image HDU per SER frame (`SERFRAME` markers)

`convertFitsToSer` supports:

- `sourceLayout: 'auto'` (default): infer from HDU structure and SER markers
- `sourceLayout: 'cube'`: force single-cube decode
- `sourceLayout: 'multi-hdu'`: force frame-per-HDU decode

```ts
const fitsCube = await convertSerToFits(buffer, { layout: 'cube' })
const fitsMulti = await convertSerToFits(buffer, { layout: 'multi-hdu' })

const serFromCube = await convertFitsToSer(fitsCube, { sourceLayout: 'cube' })
const serFromAuto = await convertFitsToSer(fitsMulti, { sourceLayout: 'auto' })
const serFromMulti = await convertFitsToSer(fitsMulti, { sourceLayout: 'multi-hdu' })
```

## XISF Image Selection

For XISF files with multiple images:

```ts
const serFromSecondImage = await convertXisfToSer(xisfBytes, { imageIndex: 1 })
```

## Timestamp Preservation

SER trailer frame timestamps (100 ns ticks since year 0001-01-01) are preserved by conversion APIs:

- `SER -> FITS`: timestamps stored in `SER_TSTP` BINTABLE extension
- `SER -> XISF`: timestamps stored in `SER:FrameTimestamps` metadata vector

## Demo

Run Node demo:

```bash
pnpm demo:ser
```

Outputs are written to `demo/.out/ser-node`.
