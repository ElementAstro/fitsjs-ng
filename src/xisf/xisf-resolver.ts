import type { XISFResourceResolver } from './xisf-types'
import { XISFResourceError } from './xisf-errors'
import { importNodeModule, isNodeRuntime, runtimeLabel } from '../core/runtime'
import { fetchOkWithNetworkPolicy } from '../core/network'

function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer)
}

async function resolveWithNodeFS(path: string): Promise<Uint8Array> {
  try {
    const fsMod = await importNodeModule<{
      readFile(path: string): Promise<Uint8Array>
    }>(
      'fs/promises',
      'XISF path(...) resource resolution',
      'Provide a custom resourceResolver.resolvePath in browser/React Native.',
    )
    const data = await fsMod.readFile(path)
    return new Uint8Array(data)
  } catch (error) {
    throw new XISFResourceError(`Failed to read path "${path}": ${(error as Error).message}`)
  }
}

export const DefaultXISFResourceResolver: XISFResourceResolver = {
  async resolveURL(url: string, options): Promise<Uint8Array> {
    try {
      const response = await fetchOkWithNetworkPolicy(
        url,
        {
          requestInit: options?.requestInit,
          timeoutMs: options?.timeoutMs,
          retryCount: options?.retryCount,
          retryDelayMs: options?.retryDelayMs,
        },
        { method: 'GET' },
        `Failed to fetch ${url}`,
      )
      return toUint8Array(await response.arrayBuffer())
    } catch (error) {
      throw new XISFResourceError(`Failed to fetch ${url}: ${(error as Error).message}`)
    }
  },

  async resolvePath(path: string): Promise<Uint8Array> {
    if (!isNodeRuntime()) {
      throw new XISFResourceError(
        `Path-based distributed XISF access requires Node.js or a custom resourceResolver.resolvePath (runtime=${runtimeLabel()}): ${path}`,
      )
    }
    return resolveWithNodeFS(path)
  },
}
