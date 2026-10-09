import { aBogus } from '../sign/bogus.js'
import { randomMsToken } from '../sign/qs.js'
import type { Http } from '../http/client.js'
import type { Res } from '../http/res.js'

/** 抖音 PC 客户端 UA（webapp 批 HAR 实证；a_bogus 计算用的 UA 必须与请求头一致，否则签名失效） */
export const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) douyin/8.7.0 Chrome/136.0.7103.59 Electron/36.4.0-rs.33.release.pgo.0 TTElectron/36.4.0-rs.33.release.pgo.0 Safari/537.36 awemePcClient/8.7.0 buildId/495279540 osName/Windows'

/** 与 WEB_UA 匹配的屏参；不随请求传输，仅参与本地 a_bogus 计算（固定常量即可） */
const SCREEN = '1707|960|1707|1019|1707|960|1707|982|Windows'

export const WEB_ORIGIN = 'https://www.douyin.com'
export const EDGE_ORIGIN = 'https://www-hj.douyin.com'

/** webapp 批环境参数（HAR 实证；服务端不校验字段顺序） */
function envParams (): Record<string, string> {
  return {
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    app_name: 'aweme',
    format: 'json',
    pc_client_type: '2',
    pc_libra_divert: 'Windows',
    update_version_code: '807000',
    support_h265: '1',
    support_dash: '1',
    version_code: '170400',
    version_name: '17.4.0',
    cookie_enabled: 'true',
    screen_width: '1707',
    screen_height: '960',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '136.0.7103.59',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '136.0.7103.59',
    os_name: 'Windows',
    os_version: '10',
    cpu_core_num: '16',
    device_memory: '8',
    platform: 'PC',
    downlink: '7.15',
    effective_type: '4g',
    round_trip_time: '50',
  }
}

/** webid 不在 Cookie：web_sign_token（JWT）payload.id 即 webid（HAR 实证） */
function webidOf (http: Http): string {
  const jwt = http.jar.get('web_sign_token')
  const payload = jwt?.split('.')[1]
  if (payload) {
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { id?: unknown }
      if (data.id) return String(data.id)
    } catch { /* 非标准 JWT：退回空值，服务端按未登录处理 */ }
  }
  return ''
}

/** 组装环境参数 + 指纹（verifyFp/fp 同源 s_v_web_id；uifid 用 UIFID） */
function fpParams (http: Http, extra: Record<string, string>): Record<string, string> {
  const verifyFp = http.jar.get('s_v_web_id')
  const params: Record<string, string> = { ...envParams(), ...extra }
  const webid = webidOf(http)
  const uifid = http.jar.get('UIFID')
  if (webid) params.webid = webid
  if (uifid) params.uifid = uifid
  if (verifyFp) {
    params.verifyFp = verifyFp
    params.fp = verifyFp
  }
  params.msToken = http.jar.get('msToken') ?? randomMsToken()
  return params
}

export interface WebOpts {
  params?: Record<string, string>
  origin?: string
}

/** webapp 批 URL 组装：环境+指纹 query 串直接作为 a_bogus 的签名输入，再追加 a_bogus */
function webSigned (
  http: Http,
  path: string,
  opts: WebOpts,
  body: string,
): { url: string; headers: Record<string, string> } {
  const query = new URLSearchParams(fpParams(http, opts.params ?? {})).toString()
  const aBogusValue = aBogus({ userAgent: WEB_UA, query, body, screenFingerprint: SCREEN })
  const origin = opts.origin ?? WEB_ORIGIN
  return {
    url: `${origin}${path}?${query}&a_bogus=${encodeURIComponent(aBogusValue)}`,
    headers: { 'User-Agent': WEB_UA, Referer: WEB_ORIGIN },
  }
}

/** webapp 批 GET（a_bogus 随 query 计算） */
export function webGet<T> (http: Http, path: string, opts: WebOpts = {}): Promise<Res<T>> {
  const { url, headers } = webSigned(http, path, opts, '')
  return http.json<T>(url, { headers })
}

/** webapp 批 POST：form body 参与 a_bogus 计算（缺失时算空 body） */
export function webPost<T> (
  http: Http,
  path: string,
  opts: WebOpts & { body?: Record<string, string> } = {},
): Promise<Res<T>> {
  const wire = new URLSearchParams(opts.body ?? {}).toString()
  const { url, headers } = webSigned(http, path, opts, wire)
  return http.json<T>(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: wire,
  })
}
