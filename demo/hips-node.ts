/**
 * HiPS Node Demo
 *
 * Run with:
 *   pnpm demo:hips
 */

import './_setup'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HiPS,
  NodeFSTarget,
  convertFitsToHiPS,
  convertHiPSToFITS,
  createImageBytesFromArray,
  createImageHDU,
  lintHiPS,
  writeFITS,
} from '../src/index'

function makeSampleFits(width: number, height: number): ArrayBuffer {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2
      const dy = y - height / 2
      values[y * width + x] = Math.exp(-(dx * dx + dy * dy) / 500) * 1000 + x * 0.2 + y * 0.1
    }
  }

  const hdu = createImageHDU({
    primary: true,
    width,
    height,
    bitpix: -32,
    data: createImageBytesFromArray(values, -32),
    additionalCards: [
      { key: 'CTYPE1', value: 'RA---TAN' },
      { key: 'CTYPE2', value: 'DEC--TAN' },
      { key: 'CRVAL1', value: 83.6331 },
      { key: 'CRVAL2', value: 22.0145 },
      { key: 'CRPIX1', value: width / 2 + 0.5 },
      { key: 'CRPIX2', value: height / 2 + 0.5 },
      { key: 'CDELT1', value: -0.01 },
      { key: 'CDELT2', value: 0.01 },
    ],
  })
  return writeFITS([hdu])
}

async function findFirstTile(root: string): Promise<{ order: number; ipix: number } | null> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      const match = /Norder(\d+)[\\/]+Dir\d+[\\/]+Npix(\d+)\.(fits|png|jpg)$/iu.exec(full)
      if (match) {
        return { order: Number(match[1]), ipix: Number(match[2]) }
      }
    }
  }
  return null
}

async function main() {
  const outRoot = join(process.cwd(), 'demo', '.out', 'hips-node')
  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })

  console.log('== HiPS Node Demo ==')
  console.log('Output directory:', outRoot)

  const fits = makeSampleFits(256, 128)
  const target = new NodeFSTarget(outRoot)

  console.log('\n1) FITS -> HiPS')
  const build = await convertFitsToHiPS(fits, {
    output: target,
    title: 'fitsjs-ng HiPS Demo',
    creatorDid: 'ivo://fitsjs-ng/demo',
    hipsOrder: 3,
    minOrder: 1,
    tileWidth: 64,
    formats: ['fits', 'png', 'jpeg'],
    includeMoc: true,
    includeAllsky: true,
    includeIndexHtml: true,
  })
  console.log('Generated tiles:', build.generatedTiles)
  console.log('Orders:', `${build.minOrder}..${build.maxOrder}`)

  console.log('\n2) Lint HiPS')
  const lint = await lintHiPS(outRoot)
  console.log('Lint ok:', lint.ok)
  for (const issue of lint.issues) {
    console.log(`- [${issue.level}] ${issue.code}: ${issue.message}`)
  }

  console.log('\n3) HiPS -> FITS (tile/map/cutout)')
  const firstTile = await findFirstTile(outRoot)
  if (!firstTile) throw new Error('No tile generated')

  const tileFits = await convertHiPSToFITS(outRoot, {
    tile: { order: firstTile.order, ipix: firstTile.ipix },
  })
  const mapFits = await convertHiPSToFITS(outRoot, {
    map: { order: 1, ordering: 'NESTED' },
  })
  const cutoutFits = await convertHiPSToFITS(outRoot, {
    cutout: {
      width: 512,
      height: 256,
      ra: 83.6331,
      dec: 22.0145,
      fov: 2.0,
      interpolation: 'bilinear',
    },
  })

  await writeFile(join(outRoot, 'demo-tile.fits'), new Uint8Array(tileFits))
  await writeFile(join(outRoot, 'demo-map.fits'), new Uint8Array(mapFits))
  await writeFile(join(outRoot, 'demo-cutout.fits'), new Uint8Array(cutoutFits))
  console.log('Wrote demo-tile.fits / demo-map.fits / demo-cutout.fits')

  console.log('\n4) HiPS class usage')
  const hips = await HiPS.open(outRoot)
  const props = await hips.getProperties()
  console.log('HiPS title:', props.get('obs_title'))
  console.log('HiPS formats:', (await hips.tileFormats()).join(', '))

  console.log('\nDone.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
