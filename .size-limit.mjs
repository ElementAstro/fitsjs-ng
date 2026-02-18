import { builtinModules } from 'node:module'

const nodeBuiltins = Array.from(
  new Set([...builtinModules, ...builtinModules.map(mod => `node:${mod}`)])
)

function withNodeAndWasmSupport(config) {
  return {
    ...config,
    external: Array.from(new Set([...(config.external ?? []), ...nodeBuiltins])),
    loader: {
      ...(config.loader ?? {}),
      '.wasm': 'binary'
    }
  }
}

export default [
  {
    path: 'dist/index.js',
    limit: '500 kB',
    modifyEsbuildConfig: withNodeAndWasmSupport
  },
  {
    path: 'dist/index.cjs',
    limit: '500 kB',
    modifyEsbuildConfig: withNodeAndWasmSupport
  }
]
