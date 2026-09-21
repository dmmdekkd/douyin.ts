import { randomUUID } from 'node:crypto'
import { UA, aidSign, im, normalizePassportPath, noonTs, randomHex, randomTrace, web } from '../sign/index.js'
import { Jar } from './jar.js'
import { parseJson } from './res.js'
import type { Res } from './res.js'
import { createLog } from '../log.js'
import type { Log } from '../log.js'

export interface HttpOpts {
  /** 浏览器复制的 Cookie 或上一轮会话 */
  cookie?: string
  /** 当前账号 uid,发消息/收件箱/上传链路使用 */
  userId?: string
  userAgent?: string
  /** 默认请求超时毫秒;init.signal 显式传入时优先生效 */
  timeout?: number
  log?: Log
}

/** 抖音 HTTP 通道:Cookie/UA/超时封装 + Passport 请求头;签名(sign/qs/a_bogus)由调用方组装进 URL 后直发 */
export class Http {
  readonly jar: Jar
  readonly userId: string
  readonly ua: string
  readonly log: Log
  bizTraceId: string
  /** 服务端注册的桌面设备身份(登录时注入;'0' 表示未注册) */
  deviceId = '0'
  installId = '0'
  guid = randomHex(32)

  private readonly timeout: number
  private readonly portrait = `${randomUUID()}.login`

  constructor (opts: HttpOpts = {}) {
    this.timeout = opts.timeout ?? 30_000
    if (!Number.isSafeInteger(this.timeout) || this.timeout <= 0 || this.timeout > 2_147_483_647) {
      throw new RangeError('timeout 必须是 1..2147483647 的整数')
    }
    this.jar = new Jar(opts.cookie)
    this.userId = opts.userId ?? ''
    this.ua = opts.userAgent ?? UA
    this.log = opts.log ?? createLog({ tag: 'http' })
    // trace-id 首次生成后回写 jar,保证后续请求与 Passport 头一致
    this.bizTraceId = this.jar.get('biz_trace_id') ?? randomTrace()
    this.jar.set('biz_trace_id', this.bizTraceId)
  }

  /** 注入服务端注册的桌面设备身份(device_register 签发) */
  setDevice (device: { deviceId: string; installId: string; guid: string }): void {
    this.deviceId = device.deviceId
    this.installId = device.installId
    this.guid = device.guid
  }

  hasDevice (): boolean {
    return this.deviceId !== '0' && /^\d+$/.test(this.deviceId)
  }

  /** Passport 接口请求头;imdesktop(桌面)与 creator(web)分流 */
  passportHeaders (url?: string): Record<string, string> {
    const desktop = Boolean(url?.startsWith(im.origin))
    const headers: Record<string, string> = {
      Accept: 'application/json, text/javascript',
      Referer: desktop ? im.origin : `${web.origin}/creator-micro/home`,
    }
    const csrf = this.jar.get('passport_csrf_token') ?? this.jar.get('passport_csrf_token_default')
    if (csrf) headers['x-tt-passport-csrf-token'] = csrf
    headers['x-tt-passport-trace-id'] = this.bizTraceId
    headers['x-tt-passport-verify-portrait'] = this.portrait
    const sign = this.aidSignFor(url, desktop ? 'im' : 'web')
    if (sign) headers['x-tt-passport-aid-sign'] = sign
    if (desktop) return headers
    const secsdk = secsdkToken(this.jar.get('x-web-secsdk-uid'))
    if (secsdk) headers['x-secsdk-csrf-token'] = secsdk
    return headers
  }

  private aidSignFor (url: string | undefined, domain: 'im' | 'web'): string | undefined {
    if (!url) return undefined
    try {
      return aidSign({
        aid: domain === 'im' ? im.aid : web.aid,
        appKey: domain === 'im' ? im.appKey : web.appKey,
        path: normalizePassportPath(new URL(url).pathname),
        ts: noonTs(),
      })
    } catch {
      return undefined
    }
  }

  async request (url: string, init: RequestInit = {}): Promise<Res<string>> {
    const res = await this.fetchRes(url, init)
    const text = await res.text()
    return { ok: res.ok, status: res.status, headers: res.headers, data: text, text }
  }

  async json<T> (url: string, init: RequestInit = {}): Promise<Res<T>> {
    const res = await this.request(url, init)
    return { ...res, data: parseJson<T>(res, url) }
  }

  async bytes (url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; headers: Headers; data: Uint8Array }> {
    const res = await this.fetchRes(url, init)
    const data = new Uint8Array(await res.arrayBuffer())
    return { ok: res.ok, status: res.status, headers: res.headers, data }
  }

  get (url: string, init: RequestInit = {}): Promise<Res<string>> {
    return this.request(url, { ...init, method: 'GET' })
  }

  /** Passport form 链路:body 为已编码的 urlencoded 串,默认补 Content-Type */
  post (url: string, body = '', init: RequestInit = {}): Promise<Res<string>> {
    const headers = new Headers(init.headers)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/x-www-form-urlencoded')
    return this.request(url, { ...init, headers, method: 'POST', body })
  }

  /** 媒体上传:body 原样透传,Content-Type 由调用方决定 */
  upload (url: string, body: NonNullable<RequestInit['body']>, init: RequestInit = {}): Promise<Res<string>> {
    return this.request(url, { ...init, method: 'POST', body })
  }

  private async fetchRes (url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    // UA 仅作默认值,调用方传入的 headers 可覆盖
    if (!headers.has('User-Agent')) headers.set('User-Agent', this.ua)
    const cookie = this.jar.header()
    if (cookie) headers.set('Cookie', cookie)
    const res = await fetch(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(this.timeout),
    })
    this.absorb(res.headers)
    return res
  }

  /** 吸收响应下发的 Set-Cookie 与 msToken,会话跨请求自续 */
  private absorb (headers: Headers): void {
    for (const line of headers.getSetCookie()) this.jar.absorb(line)
    const ms = headers.get('x-ms-token')
    if (ms) this.jar.set('msToken', ms)
  }
}

/** 常见形态:`000100000001` + `x-web-secsdk-uid` 去连字符 */
function secsdkToken (uid?: string): string | undefined {
  if (!uid) return undefined
  return `000100000001${uid.replace(/-/g, '')}`
}
