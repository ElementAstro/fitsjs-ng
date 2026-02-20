function dynamicImport(specifier: string): Promise<unknown> {
  return import(/* @vite-ignore */ specifier)
}

function hasProcessObject(): boolean {
  return typeof process !== 'undefined' && typeof process === 'object'
}

export function isReactNativeRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
}

export function isNodeRuntime(): boolean {
  if (!hasProcessObject() || isReactNativeRuntime()) {
    return false
  }
  const versions = (process as { versions?: { node?: string } }).versions
  return typeof versions?.node === 'string' && versions.node.length > 0
}

export function runtimeLabel(): 'node' | 'react-native' | 'browser' | 'unknown' {
  if (isNodeRuntime()) return 'node'
  if (isReactNativeRuntime()) return 'react-native'
  if (typeof window !== 'undefined') return 'browser'
  return 'unknown'
}

export async function importNodeModule<T>(
  moduleName: string,
  context: string,
  hint?: string,
): Promise<T> {
  if (!isNodeRuntime()) {
    const suffix = hint ? ` ${hint}` : ''
    throw new Error(
      `${context} requires Node.js runtime. Current runtime: ${runtimeLabel()}.${suffix}`,
    )
  }

  const specifier = moduleName.startsWith('node:') ? moduleName : `node:${moduleName}`
  try {
    return (await dynamicImport(specifier)) as T
  } catch (error) {
    throw new Error(`${context} failed to load ${specifier}: ${(error as Error).message}`)
  }
}
