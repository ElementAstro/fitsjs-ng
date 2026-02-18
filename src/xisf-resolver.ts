import type { XISFResourceResolver } from './xisf-types'
import { XISFResourceError } from './xisf-errors'

function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer)
}

async function resolveWithNodeFS(path: string): Promise<Uint8Array> {
  try {
    const fsMod = (await import('node:fs/promises')) as {
      readFile(path: string): Promise<Uint8Array>
    }
    const data = await fsMod.readFile(path)
    return new Uint8Array(data)
  } catch (error) {
    throw new XISFResourceError(`Failed to read path "${path}": ${(error as Error).message}`)
  }
}

export const DefaultXISFResourceResolver: XISFResourceResolver = {
  async resolveURL(url: string): Promise<Uint8Array> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new XISFResourceError(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      )
    }
    return toUint8Array(await response.arrayBuffer())
  },

  async resolvePath(path: string): Promise<Uint8Array> {
    if (typeof window !== 'undefined') {
      throw new XISFResourceError(
        `Path-based distributed XISF access requires a custom resourceResolver in browser environments: ${path}`,
      )
    }
    return resolveWithNodeFS(path)
  },
}
