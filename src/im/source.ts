import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/** 媒体输入源：http(s) URL、本地文件路径、base64 串或原始字节 */
export type MediaInput = string | Uint8Array | ArrayBuffer

/** 输入源判别：非字符串三态外的对象即上传资产（ImageResource/ImageAsset 等） */
export const isInput = (v: unknown): v is MediaInput =>
  typeof v === 'string' || v instanceof Uint8Array || v instanceof ArrayBuffer

const BASE64 = /^[A-Za-z0-9+/=\s]{32,}$/

/** 输入分流：URL 下载 / 存在的路径读文件 / base64 解码 / 字节原样返回 */
export async function resolveMedia (input: MediaInput): Promise<Uint8Array> {
  if (typeof input !== 'string') return input instanceof Uint8Array ? input : new Uint8Array(input)
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input)
    if (!res.ok) throw new Error(`媒体下载失败 HTTP ${res.status}: ${input.slice(0, 80)}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  if (existsSync(input)) return readFile(input)
  if (BASE64.test(input)) return Buffer.from(input.replace(/\s/g, ''), 'base64')
  throw new Error(`无法识别的媒体源（URL/存在的路径/base64 之外）: ${input.slice(0, 80)}`)
}

/** 从输入推断文件名：路径/URL 取 basename，字节与 base64 缺省 file */
export function fileNameOf (input: MediaInput): string {
  if (typeof input !== 'string') return 'file'
  const name = decodeURIComponent(input.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '')
  return name || 'file'
}
