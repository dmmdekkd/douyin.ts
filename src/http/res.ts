/** 统一响应形态:data 与 text 并存,JSON/HTML/protobuf 调用方按需取用 */
export interface Res<T = unknown> {
  ok: boolean
  status: number
  headers: Headers
  data: T
  text: string
}

export type FailKind = 'captcha' | 'passport-verification' | 'challenge' | 'empty' | 'invalid-json' | 'http'

/** Passport 二级验证决策响应头:值即传给安全验证 SDK 的决策 JSON 字符串 */
const VERIFY_DECISION_HEADER = 'x-tt-verify-passport-decision'

/**
 * 读取 Passport 二级验证决策响应头。与客户端一致:只要该头存在,
 * 就要先完成安全验证(滑块/短信/扫码等)再重放原请求。
 */
export function verifyDecision (headers: Headers): string | undefined {
  return headers.get(VERIFY_DECISION_HEADER) || undefined
}

/** 只携带诊断元数据,不含请求 query、凭据与响应体 */
export class ResError extends Error {
  override readonly name = 'ResError'
  readonly endpoint: string
  readonly logId: string | undefined

  constructor (
    readonly kind: FailKind,
    readonly status: number,
    url: string,
    headers: Headers,
  ) {
    const endpoint = new URL(url).pathname
    const logId = headers.get('x-tt-logid') ?? undefined
    super(`${kind}: HTTP ${status} ${endpoint}${logId ? ` (logid=${logId})` : ''}`)
    this.endpoint = endpoint
    this.logId = logId
  }
}

/** 仅用于 JSON 接口;HTML/protobuf 响应由调用方自行解码 */
export function parseJson<T> (res: Res<string>, url: string): T {
  const { status, headers, text, ok } = res
  const fail = (kind: FailKind): never => {
    throw new ResError(kind, status, url, headers)
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    if (headers.get('x-vc-bdturing-parameters')) return fail('captcha')
    if (headers.get(VERIFY_DECISION_HEADER)) return fail('passport-verification')
    if (/__ac_nonce|_\$jsvmprt/.test(text)) return fail('challenge')
    if (!ok) return fail('http')
    return fail(text.trim() ? 'invalid-json' : 'empty')
  }
  if (!ok) return fail('http')
  if (decoded === null || typeof decoded !== 'object') return fail('invalid-json')
  return decoded as T
}
