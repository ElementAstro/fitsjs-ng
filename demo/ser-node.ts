import './_setup'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SER } from '../src/ser'
import { convertSerToFits, convertSerToXisf, convertFitsToSer } from '../src/ser/ser-convert'
import { writeSER } from '../src/ser/ser-writer'

const OUT_DIR = resolve(process.cwd(), 'demo', 'out')

function makeDemoSER(): ArrayBuffer {
  const width = 4
  const height = 3
  const frameCount = 3
  const frames: Uint8Array[] = []
  for (let f = 0; f < frameCount; f++) {
    const frame = new Uint8Array(width * height)
    for (let i = 0; i < frame.length; i++) {
      frame[i] = (f * 40 + i * 9) & 0xff
    }
    frames.push(frame)
  }
  const timestamps = Array.from(
    { length: frameCount },
    (_, i) => 638000000000000000n + BigInt(i) * 100000n,
  )

  return writeSER({
    header: {
      colorId: 0,
      width,
      height,
      pixelDepth: 8,
      luId: 1001,
      observer: 'fitsjs-ng demo',
      instrument: 'virtual camera',
      telescope: 'virtual telescope',
      startTime: timestamps[0],
      startTimeUtc: timestamps[0],
    },
    frames,
    timestamps,
  })
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const serBuffer = makeDemoSER()
  await writeFile(resolve(OUT_DIR, 'demo.ser'), new Uint8Array(serBuffer))
  console.log('Wrote demo.ser')

  const ser = SER.fromArrayBuffer(serBuffer)
  console.log(
    `SER parsed: ${ser.getHeader().width}x${ser.getHeader().height}, frames=${ser.getHeader().frameCount}`,
  )
  console.log(`Estimated FPS from timestamps: ${ser.getEstimatedFPS()?.toFixed(2) ?? 'n/a'}`)

  const fitsBuffer = await convertSerToFits(serBuffer)
  await writeFile(resolve(OUT_DIR, 'demo-from-ser.fits'), new Uint8Array(fitsBuffer))
  console.log('Wrote demo-from-ser.fits')

  const fitsMultiBuffer = await convertSerToFits(serBuffer, { layout: 'multi-hdu' })
  await writeFile(resolve(OUT_DIR, 'demo-from-ser-multi-hdu.fits'), new Uint8Array(fitsMultiBuffer))
  console.log('Wrote demo-from-ser-multi-hdu.fits')

  const xisfBuffer = await convertSerToXisf(serBuffer)
  await writeFile(resolve(OUT_DIR, 'demo-from-ser.xisf'), new Uint8Array(xisfBuffer as ArrayBuffer))
  console.log('Wrote demo-from-ser.xisf')

  const backToSer = await convertFitsToSer(fitsMultiBuffer, { sourceLayout: 'auto' })
  await writeFile(resolve(OUT_DIR, 'demo-roundtrip.ser'), new Uint8Array(backToSer))
  console.log('Wrote demo-roundtrip.ser')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
