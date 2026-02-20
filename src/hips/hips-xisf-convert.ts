import { convertFitsToXisf, convertXisfToFits } from '../xisf/convert'
import { convertFitsToHiPS, type HiPSBuildResult } from './hips-build'
import { convertHiPSToFITS } from './hips-export'
import { XISF } from '../xisf'
import { XISFConversionError } from '../xisf/xisf-errors'
import { XISFWriter } from '../xisf/xisf-writer'
import type { ConvertHiPSToXisfOptions, ConvertXisfToHiPSOptions, HiPSInput } from './hips-types'
import type { XISFImage, XISFUnit } from '../xisf/xisf-types'

function cloneImage(image: XISFImage): XISFImage {
  return {
    ...image,
    geometry: [...image.geometry],
    bounds: image.bounds ? [image.bounds[0], image.bounds[1]] : undefined,
    properties: image.properties.map((property) => ({ ...property })),
    tables: image.tables.map((table) => ({
      ...table,
      structure: table.structure.map((field) => ({ ...field })),
      dataRows: table.dataRows.map((row) => ({
        cells: row.cells.map((cell) => ({ ...cell })),
      })),
    })),
    fitsKeywords: image.fitsKeywords.map((keyword) => ({ ...keyword })),
    dataBlock: {
      ...image.dataBlock,
      location: { ...image.dataBlock.location },
    },
    data: image.data ? new Uint8Array(image.data) : undefined,
  }
}

async function normalizeXisfInput(
  input: ArrayBuffer | Blob | XISF,
  options?: ConvertXisfToHiPSOptions['xisfReadOptions'],
): Promise<XISF> {
  if (input instanceof XISF) {
    return input
  }
  const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer()
  return XISF.fromArrayBuffer(buffer, { ...options, decodeImageData: true })
}

export async function convertXisfToHiPS(
  input: ArrayBuffer | Blob | XISF,
  options: ConvertXisfToHiPSOptions,
): Promise<HiPSBuildResult> {
  const { imageIndex = 0, xisfReadOptions, ...hipsOptions } = options
  const xisf = await normalizeXisfInput(input, xisfReadOptions)

  const selected = xisf.unit.images[imageIndex]
  if (!selected) {
    throw new XISFConversionError(
      `XISF imageIndex ${imageIndex} is out of range (images=${xisf.unit.images.length})`,
    )
  }
  if (selected.sampleFormat === 'Complex32' || selected.sampleFormat === 'Complex64') {
    throw new XISFConversionError('Complex XISF images cannot be converted to HiPS image/cube')
  }
  if (!selected.data) {
    throw new XISFConversionError('Selected XISF image has no decoded data')
  }

  const unit: XISFUnit = {
    metadata: xisf.unit.metadata.map((property) => ({ ...property })),
    images: [cloneImage(selected)],
    standaloneProperties: xisf.unit.standaloneProperties.map((property) => ({ ...property })),
    standaloneTables: xisf.unit.standaloneTables.map((table) => ({
      ...table,
      structure: table.structure.map((field) => ({ ...field })),
      dataRows: table.dataRows.map((row) => ({
        cells: row.cells.map((cell) => ({ ...cell })),
      })),
    })),
    version: xisf.unit.version,
    signature: { ...xisf.unit.signature },
  }

  const selectedXisf = await XISFWriter.toMonolithic(unit)
  const fits = await convertXisfToFits(selectedXisf, {
    strictValidation: xisfReadOptions?.strictValidation,
    includeXisfMetaExtension: false,
  })
  return convertFitsToHiPS(fits, hipsOptions)
}

export async function convertHiPSToXisf(
  input: HiPSInput,
  options: ConvertHiPSToXisfOptions = {},
): Promise<ArrayBuffer | { header: Uint8Array; blocks: Record<string, Uint8Array> }> {
  const { distributed, writeOptions, conversionOptions, ...hipsOptions } = options
  const fits = await convertHiPSToFITS(input, hipsOptions)
  return convertFitsToXisf(fits, {
    ...(conversionOptions ?? {}),
    distributed,
    writeOptions,
  })
}
