# HiPS Guide

`fitsjs-ng` supports end-to-end HiPS processing for Image and HiPS3D datasets:

- FITS -> HiPS directory generation
- HiPS -> FITS export (`tile`, `map`, `cutout`)
- Node and browser write targets (`NodeFSTarget`, `BrowserZipTarget`, `BrowserOPFSTarget`)
- Local processing with optional `hips2fits` remote fallback

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

Allsky behavior:

- image datasets generate `Norder3/Allsky.fits/png/jpg` according to requested `formats`
- cube datasets emit Allsky in FITS only (non-FITS Allsky is intentionally restricted and marked in `properties`)

## HiPS to FITS

```ts
import { convertHiPSToFITS } from 'fitsjs-ng'

// Tile export
const tileFits = await convertHiPSToFITS('./out/hips', {
  tile: { order: 7, ipix: 12345 },
})

// HEALPix map export
const mapFits = await convertHiPSToFITS('./out/hips', {
  map: { order: 7, ordering: 'NESTED' },
})

// WCS cutout export
const cutoutFits = await convertHiPSToFITS('./out/hips', {
  cutout: { width: 1024, height: 1024, ra: 83.63, dec: 22.01, fov: 1.2 },
  backend: 'local',
})
```

## Remote Fallback (`hips2fits`)

```ts
const cutoutFits = await convertHiPSToFITS('https://alasky.cds.unistra.fr/DSS/DSSColor', {
  cutout: { width: 800, height: 800, ra: 10, dec: 10, fov: 2.5, hipsId: 'CDS/P/DSS2/color' },
  backend: 'auto',
  hipsId: 'CDS/P/DSS2/color',
})
```

- `local`: local reprojection only
- `remote`: hips2fits only (requires `hipsId`)
- `auto`: local first, then remote fallback

## XISF <-> HiPS

```ts
import { NodeFSTarget, convertXisfToHiPS, convertHiPSToXisf } from 'fitsjs-ng'

await convertXisfToHiPS(await fetch('/image.xisf').then((r) => r.arrayBuffer()), {
  output: new NodeFSTarget('./out/hips-from-xisf'),
  imageIndex: 0,
  title: 'XISF Survey',
  creatorDid: 'ivo://example/xisf',
  hipsOrder: 6,
})

const xisfCutout = await convertHiPSToXisf('./out/hips-from-xisf', {
  cutout: { width: 512, height: 512, ra: 83.63, dec: 22.01, fov: 1.2 },
})
```
