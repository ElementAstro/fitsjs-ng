# HiPS Guide

`fitsjs-ng` supports end-to-end HiPS processing for Image and HiPS3D datasets:

- FITS -> HiPS directory generation
- HiPS -> FITS export (`tile`, `map`, `cutout`)
- Node and browser write targets (`NodeFSTarget`, `BrowserZipTarget`, `BrowserOPFSTarget`)
- Local processing by default, with optional `hips2fits` remote fallback
- XISF bridge workflows (`XISF -> HiPS -> XISF`)

## FITS to HiPS

```ts
import { NodeFSTarget, convertFitsToHiPS } from 'fitsjs-ng'

await convertFitsToHiPS(fitsArrayBuffer, {
  output: new NodeFSTarget('./out/hips'),
  title: 'Demo HiPS',
  creatorDid: 'ivo://example/demo',
  hipsOrder: 7,
  tileWidth: 512,
  formats: ['fits', 'png'],
  interpolation: 'bilinear',
})
```

Generated outputs:

- `properties`
- tiles under `Norder*/Dir*/Npix*`
- `Moc.fits` (when enabled)
- `Norder3/Allsky.*` (when available)
- `index.html` landing page (when enabled)

## HiPS to FITS

```ts
import { convertHiPSToFITS } from 'fitsjs-ng'

const tileFits = await convertHiPSToFITS('./out/hips', {
  tile: { order: 7, ipix: 12345 },
})

const mapFits = await convertHiPSToFITS('./out/hips', {
  map: { order: 7, ordering: 'NESTED' },
})

const cutoutFits = await convertHiPSToFITS('./out/hips', {
  cutout: { width: 1024, height: 1024, ra: 83.63, dec: 22.01, fov: 1.2 },
  backend: 'local',
})
```

## Local vs Remote Backend

Default recommendation is local/offline processing:

- `backend: 'local'`: local reprojection only
- `backend: 'auto'`: local first, then remote fallback (requires `hipsId`)
- `backend: 'remote'`: remote hips2fits only (requires `hipsId`)

Remote example:

```ts
const cutoutFits = await convertHiPSToFITS('https://alasky.cds.unistra.fr/DSS/DSSColor', {
  cutout: { width: 800, height: 800, ra: 10, dec: 10, fov: 2.5, hipsId: 'CDS/P/DSS2/color' },
  backend: 'auto',
  hipsId: 'CDS/P/DSS2/color',
})
```

## XISF <-> HiPS Bridge

```ts
import { NodeFSTarget, convertHiPSToXisf, convertXisfToHiPS } from 'fitsjs-ng'

await convertXisfToHiPS(xisfBuffer, {
  output: new NodeFSTarget('./out/hips-from-xisf'),
  imageIndex: 0,
  title: 'XISF Survey',
  creatorDid: 'ivo://example/xisf',
  hipsOrder: 6,
  minOrder: 1,
  tileWidth: 256,
  formats: ['fits', 'png'],
})

const xisfCutout = await convertHiPSToXisf('./out/hips-from-xisf', {
  cutout: { width: 512, height: 512, ra: 83.63, dec: 22.01, fov: 1.2 },
})

const xisfMap = await convertHiPSToXisf('./out/hips-from-xisf', {
  map: { order: 5, ordering: 'NESTED' },
})
```

## Demo

Run Node demo:

```bash
pnpm demo:hips
```

Outputs are written to `demo/.out/hips-node`.
