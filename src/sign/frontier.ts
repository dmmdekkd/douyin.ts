import { createHash } from 'node:crypto'
import { aBogus } from './bogus.js'
import { UA } from './const.js'

/** cmd=100 等需 WS 帧签名的命令 */
export const WS_SIGN_CMDS = new Set([100, 609, 610, 611])

export interface FrontierOpts {
  userAgent?: string
}

/**
 * 417.js SecurityPlugin.frontierSign：
 * 1. X-MS-STUB = MD5(serialize(request))
 * 2. byted_acrawler.frontierSign({ X-MS-STUB }) → { X-Bogus }
 */
export function frontierSign (
  payload: Uint8Array,
  opts: FrontierOpts = {},
): { key: string; value: string }[] {
  const stub = createHash('md5').update(payload).digest('hex')
  const headers: { key: string; value: string }[] = [
    { key: 'X-MS-STUB', value: stub },
  ]

  try {
    const xBogus = aBogus({
      userAgent: opts.userAgent ?? UA,
      query: stub,
      body: '',
      bdmsPreset: '1.0.1.16',
    })
    if (xBogus) {
      headers.push({ key: 'X-Bogus', value: xBogus })
    }
  } catch {
    // acrawler 不可用时仅 X-MS-STUB（417.js 同样 fallback）
  }

  return headers
}
