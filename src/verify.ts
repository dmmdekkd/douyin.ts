/**
 * 登录安全验证(验证中心决策)本地验证页。
 *
 * 逆向自 douyin-im e767ef72(修复发送限速):Passport 登录响应(check_qrconnect 等)
 * 可能下发 verify_center_decision_conf / verify_center_secondary_decision_conf,
 * 要求先完成官方安全验证(滑块/短信/扫码等)才能获得可信登录态 ——
 * 登录态可信度不足是发送消息被会话级降权(7523)的根因。
 *
 * 本模块启动本地 HTTP 验证页承载官方验证组件(Second Verify 1.0.29 / captcha SDK),
 * 验证完成后把结果字段回填原请求重试。静态资源随包发布在 assets/。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomHex } from './sign/qs.js'
import { im } from './sign/const.js'
import { form } from './lite.js'
import type { Http } from './http/index.js'
import type { CheckData } from './login.js'

/** 官方验证码 SDK(验证中心)及备用地址 */
const VERIFY_CENTER_SDK =
  'https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/@latest/index.js'
const VERIFY_CENTER_SDK_BACKUPS = [
  'https://lf-rc2.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/@latest/index.js',
  'https://lf-cdn-tos.bytescm.com/obj/rc-verifycenter/verifycenter/@latest/index.js',
] as const

/** 验证页代理允许访问的主机 */
const HOSTS = new Set([
  'imdesktop.douyin.com',
  'login.douyin.com',
  'verify.zijieapi.com',
  'vcs.zijieapi.com',
  'www.douyin.com',
])

/** 一次验证中心决策(原始 conf + 解析结果 + 是否二次决策) */
export interface Decision {
  raw: string
  decision: Record<string, unknown>
  secondary: boolean
}

/** 验证完成结果:fp 回填 query,fields 回填 body */
export interface Outcome {
  fp?: string
  fields: Record<string, unknown>
}

export interface Hooks {
  /** 验证页就绪后回调(把链接推给用户在浏览器打开) */
  onUrl?: (url: string) => void
  /** SecondVerify SDK aid(桌面 IM 339757 / 网页登录 6383);缺省时用决策 aid,再缺省桌面 */
  aid?: number
  /** 验证请求 host(SDK 相对路径解析基准与 Referer);缺省按 aid 推断 */
  host?: string
  /** 默认 5 分钟 */
  timeoutMs?: number
}

/**
 * 从登录响应中解析验证中心决策;无决策返回 undefined。
 * 决策来源有两个,按真实客户端优先级排列:
 *  1. 响应头 x-tt-verify-passport-decision(值即 SecondVerify SDK 决策 JSON,头存在即需二次验证);
 *  2. 响应体 verify_center_decision_conf / verify_center_secondary_decision_conf
 *     (主决策 > 二次决策;无 conf 时按 error_code=1105 或 captcha 字段兜底为滑块验证)。
 */
export function parseDecision (data: CheckData, headerDecision?: string): Decision | undefined {
  // 响应头决策:客户端将 JSON 原样传给内置 SecondVerify SDK 的 verify()
  if (typeof headerDecision === 'string' && headerDecision.length > 0) {
    const record = asRecord(tryParseJson(headerDecision))
    if (record) {
      return {
        raw: JSON.stringify(record),
        decision: { ...record, verification_level: 'secondary' },
        secondary: true,
      }
    }
    return {
      raw: headerDecision,
      decision: { verify_data: headerDecision, verification_level: 'secondary' },
      secondary: true,
    }
  }
  const source = data as unknown as Record<string, unknown>
  const nested = asRecord(source['data'])
  const candidates: ReadonlyArray<readonly [unknown, boolean]> = [
    [nested?.['verify_center_decision_conf'], false],
    [nested?.['verify_center_secondary_decision_conf'], true],
    [source['verify_center_decision_conf'], false],
    [source['verify_center_secondary_decision_conf'], true],
  ]
  const selected = candidates.find(([value]) => value != null && value !== '')
  const rawValue = selected?.[0]
  const secondary = selected?.[1] === true
  const record = asRecord(rawValue)
  if (record) {
    return {
      raw: JSON.stringify(record),
      decision: { ...record, ...(secondary ? { verification_level: 'secondary' } : {}) },
      secondary,
    }
  }
  if (typeof rawValue === 'string' && rawValue.length > 0) {
    return {
      raw: rawValue,
      decision: { ...parseDecisionConf(rawValue), ...(secondary ? { verification_level: 'secondary' } : {}) },
      secondary,
    }
  }
  // captcha 兜底(error_code=1105 或响应带非空 captcha 字段)
  const errorCode = Number(source['error_code'] ?? 0)
  const captchaValue = source['captcha']
  const hasCaptcha = captchaValue != null && captchaValue !== ''
  if (errorCode !== 1105 && !hasCaptcha) return undefined
  const fallback: Record<string, unknown> = {
    verify_from: 'captcha',
    ...(hasCaptcha ? { captcha: captchaValue } : {}),
    ...(source['verify_ticket'] != null ? { verify_ticket: source['verify_ticket'] } : {}),
  }
  return { raw: JSON.stringify(fallback), decision: fallback, secondary: false }
}

/** 打开本地验证页并等待用户完成官方安全验证 */
export async function verify (http: Http, descriptor: Decision, hooks: Hooks = {}): Promise<Outcome> {
  const timeoutMs = hooks.timeoutMs ?? 300_000
  const [react, reactDom] = await Promise.all([
    loadAsset('react.production.min.js'),
    loadAsset('react-dom.production.min.js'),
  ])
  const prepared = await prepare(http, descriptor, hooks)

  return new Promise<Outcome>((resolve, reject) => {
    let finished = false
    const sessionToken = randomUUID()
    const finish = (error?: Error, outcome?: Outcome): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      server.close(() => (error ? reject(error) : resolve(outcome ?? { fields: {} })))
    }
    const server = createServer((request, response) => {
      void route(request, response, { http, prepared, react, reactDom, sessionToken, finish })
        .catch((error: unknown) => {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        })
    })
    server.once('error', error => finish(error))
    const timer = setTimeout(() => finish(new Error('登录验证超时')), timeoutMs)
    timer.unref()
    server.listen(0, '0.0.0.0', () => {
      const address = server.address()
      if (typeof address !== 'object' || address === null) {
        finish(new Error('无法取得登录验证页地址'))
        return
      }
      const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(sessionToken)}`
      http.log.info(`登录安全验证页: ${url}`)
      hooks.onUrl?.(url)
    })
  })
}

/** 验证结果字段回填 check_qrconnect body 时统一转为字符串 */
export function stringifyFields (fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, encodeField(value)]),
  )
}

function loadAsset (file: string): Promise<Buffer> {
  return readFile(fileURLToPath(new URL(`../assets/${file}`, import.meta.url)))
}

/** 本地内置官方 SecondVerify SDK(决策未带 url 时的兜底加载源);缓存避免重复读盘 */
let sdkCache: Promise<Buffer> | undefined
function loadSdk (): Promise<Buffer> {
  sdkCache ??= loadAsset('second-verification-web.js')
  return sdkCache
}

interface Prepared {
  mode: 'verify-center' | 'second-verify'
  config: Record<string, unknown>
  fp: string
  deviceId: string
  /** SecondVerify SDK aid:与登录场景一致(桌面 IM 339757 / 网页登录 6383) */
  aid: number
  /** SDK 相对路径解析基准与 Referer/请求 host */
  host: string
  appName: string
  captchaScriptUrls?: string[]
  scriptUrl?: string
  /** VerifyCenter SDK 初始化 captchaOptions:对齐官方成功链路必填业务参数(repoId/h5_check_version 缺失时 captcha/get 返回 501) */
  captchaOptions?: Record<string, unknown>
}

/** 网页登录(aid 6383)与桌面 IM(aid 339757)的验证服务 host,与真实客户端 init 对齐 */
function resolvePlatform (aid: number): { host: string; appName: string } {
  return aid === 6383
    ? { host: 'https://www.douyin.com', appName: '抖音 Web 站' }
    : { host: 'https://imdesktop.douyin.com', appName: '抖音聊天' }
}

/** 组装验证组件启动配置:verify_center 决策需先换取动态验证脚本配置 */
async function prepare (http: Http, descriptor: Decision, platform: Hooks): Promise<Prepared> {
  // 决策 JSON 原样携带 aid 时优先采用(网页 6383 / 桌面 339757),显式传入的 aid 优先级最高
  const decisionAid = Number(asRecord(descriptor.decision)?.['aid'] ?? 0)
  const aid = platform.aid ?? (decisionAid > 0 ? decisionAid : Number(im.aid))
  const resolved = resolvePlatform(aid)
  const host = platform.host ?? resolved.host
  // 对齐 douyin-im:验证组件使用连接的注册设备身份;无注册设备时回退随机 hex
  const deviceId = http.hasDevice() ? http.deviceId : randomHex(16)
  let config = { ...descriptor.decision }
  const verifyFrom = String(config['verify_from'] ?? '')
  // VerifyCenter 按 code(10000/20000/30000/40000)分发,而非嵌套 MFA 决策里的描述串
  const verifyCenter = [10000, 20000, 30000, 40000].includes(Number(config['code']))
  if (!verifyCenter && verifyFrom === 'verify_center') {
    config = { ...config, ...(await packVerifyWays(http, config, deviceId, aid)) }
  }
  const fp = `verify_${deviceId}`
  const rawUrl = typeof config['url'] === 'string' ? config['url'] : undefined
  if (verifyCenter) {
    const setting = await loadSetting(http, deviceId, aid)
    const configuredPrimary = asRecord(setting?.['js_v2'])?.['cn']
    const configuredBackups = asRecord(setting?.['back_up_js_v2'])?.['cn']
    const urls = [
      ...(typeof configuredPrimary === 'string' ? [configuredPrimary] : []),
      ...(Array.isArray(configuredBackups)
        ? configuredBackups.filter((value): value is string => typeof value === 'string')
        : []),
      VERIFY_CENTER_SDK,
      ...VERIFY_CENTER_SDK_BACKUPS,
    ]
    // 官方 iframe 的 scene_level 由其业务初始化传入(p0),不走 vc/setting 返回的 p2
    const sceneLevel = config['scene_level'] == null || config['scene_level'] === ''
      ? 'p0'
      : String(config['scene_level'])
    config['scene_level'] = sceneLevel
    // 官方成功链路(HAR verify.zijieapi.com/captcha/get 200)必带这些业务参数;
    // SDK 把它们透传进 iframe URL → captcha/get query,缺失即 501 参数错误。
    const captchaOptions = {
      repoId: '579047',
      h5_check_version: '4.0.26',
      extraConfig: { scene: 'normal' },
      scene_level: sceneLevel,
    }
    return { mode: 'verify-center', config, fp, deviceId, aid, host, appName: resolved.appName, captchaScriptUrls: [...new Set(urls)], captchaOptions }
  }
  if (!rawUrl) {
    // 真实客户端不依赖决策 url:SecondVerify SDK 内置在客户端(webjs chunk 76861),
    // 决策仅携带 verify_ways / event_params 等字段。此处回退本地内置官方 SDK。
    return { mode: 'second-verify', config, fp, deviceId, aid, host, appName: resolved.appName }
  }
  const script = new URL(rawUrl)
  if (script.protocol !== 'https:') {
    throw new Error(`平台下发了不安全的登录验证脚本: ${script.protocol}`)
  }
  script.searchParams.set('aid', String(aid))
  const eventParams = asRecord(config['event_params'])
  script.searchParams.set('verify_reason', String(eventParams?.['verify_reason'] ?? ''))
  script.searchParams.set('verify_scene', String(eventParams?.['verify_scene'] ?? ''))
  return { mode: 'second-verify', config, fp, deviceId, aid, host, appName: resolved.appName, scriptUrl: script.toString() }
}

/**
 * Desktop Second Verify 1.0.29:将 verify-center 决策换成动态验证脚本配置。
 * POST /passport/safe/pack_verify_ways_data/,字段 encodeField 编码,跳过 is_login / null。
 */
async function packVerifyWays (
  http: Http,
  decision: Record<string, unknown>,
  deviceId: string,
  aid: number,
): Promise<Record<string, unknown>> {
  const body: Record<string, string> = {}
  const requestData: Record<string, unknown> = {
    aid,
    ...decision,
    device_id: deviceId,
    iid: '0',
    version_code: im.version,
    device_platform: 'PC',
  }
  for (const [key, value] of Object.entries(requestData)) {
    if (key === 'is_login' || value == null) continue
    body[key] = encodeField(value)
  }
  const res = await form(http, '/passport/safe/pack_verify_ways_data/', body)
  if (res.data.error_code != null && res.data.error_code !== 0) {
    throw new Error(`pack_verify_ways_data failed: code=${res.data.error_code} ${String(res.data.description ?? '')}`)
  }
  return res.data
}

/** 验证码 SDK 配置(含 scene_level 与 js_v2 脚本地址);失败不阻断,走内置 SDK 地址 */
async function loadSetting (http: Http, deviceId: string, aid: number): Promise<Record<string, unknown> | undefined> {
  try {
    const query = new URLSearchParams({ aid: String(aid), did: deviceId || '0', iid: '0' })
    const res = await requestRaw(
      http,
      `https://vcs.zijieapi.com/vc/setting?${query}`,
      // 与官方验证码 SDK 一致:/vc/setting 为 POST JSON,query 携带 aid/did/iid,头 x-setting-flag
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Setting-Flag': '1' },
        body: '{}',
      },
    )
    if (!res.ok) return undefined
    const parsed = asRecord(tryParseJson(res.rawText))
    const data = asRecord(parsed?.['data']) ?? parsed
    return asRecord(data?.['verify'])
  } catch {
    return undefined
  }
}

/**
 * 验证组件专用请求:imdesktop/web 登录域带账号 Cookie + Passport 头;
 * 验证中心域(zijieapi)不带 Cookie,避免混入登录态。
 */
async function requestRaw (http: Http, url: string, init: RequestInit): Promise<{ ok: boolean; status: number; headers: Headers; rawText: string }> {
  const origin = new URL(url).origin
  if (origin === 'https://imdesktop.douyin.com' || origin === 'https://www.douyin.com' || origin === 'https://login.douyin.com') {
    const res = await http.request(url, {
      ...init,
      headers: { ...http.passportHeaders(url), ...(init.headers as Record<string, string> | undefined) },
    })
    // 验证服务报参数/状态异常时输出请求轨迹,便于定位 aid/决策不匹配等问题
    const text = res.text.slice(0, 300)
    if (!res.ok || /:5001|=5001|"5001"|\[5001\]|error_code[\"']?\s*[:=]\s*20(46|40)/.test(text)) {
      http.log.warn(`verify ${String(init.method ?? 'GET')} ${url} -> ${res.status} ${text}`)
    }
    return { ok: res.ok, status: res.status, headers: res.headers, rawText: res.text }
  }
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': http.ua, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(30_000),
  })
  const rawText = await res.text()
  // 验证中心/vcs 滑块等接口同样输出异常轨迹(滑块提交的参数错误常见于此分支)
  const text = rawText.slice(0, 300)
  if (!res.ok || /:5001|=5001|"5001"|\[5001\]|error_code[\"']?\s*[:=]\s*20(46|40)/.test(text)) {
    http.log.warn(`verify ${String(init.method ?? 'GET')} ${url} -> ${res.status} ${text}`)
  }
  return { ok: res.ok, status: res.status, headers: res.headers, rawText }
}

interface State {
  http: Http
  prepared: Prepared
  react: Buffer
  reactDom: Buffer
  sessionToken: string
  finish: (error?: Error, outcome?: Outcome) => void
}

/** 页面轨迹上报节流:按内容去重,防止日志风暴导致 IDE/终端卡顿(曾出现 /api/log 自激循环) */
const pageLogThrottle = new Map<string, number>()

async function route (request: IncomingMessage, response: ServerResponse, state: State): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.searchParams.get('token') !== state.sessionToken) {
    sendJson(response, 403, { error: '登录验证会话无效' })
    return
  }
  if (request.method === 'GET' && url.pathname === '/') {
    sendHtml(response, page(state.prepared, state.sessionToken))
    return
  }
  if (request.method === 'GET' && url.pathname === '/react.js') {
    sendScript(response, state.react)
    return
  }
  if (request.method === 'GET' && url.pathname === '/react-dom.js') {
    sendScript(response, state.reactDom)
    return
  }
  if (request.method === 'GET' && url.pathname === '/second-verify-sdk.js') {
    sendScript(response, await loadSdk())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/request') {
    const payload = await readJsonBody(request)
    // SDK 相对路径以登录场景 host 为基准(web 6383 → www.douyin.com / 桌面 → imdesktop)
    const target = resolveUrl(payload['url'], payload['baseURL'] ?? state.prepared.host)
    assertHost(target)
    const method = String(payload['method'] ?? 'GET').toUpperCase()
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
      throw new Error(`登录验证不支持请求方法: ${method}`)
    }
    const headers = sanitizeHeaders(asStringRecord(payload['headers']))
    const body = typeof payload['body'] === 'string' ? payload['body'] : undefined
    const result = await requestRaw(state.http, target.toString(), {
      method,
      headers,
      ...(body !== undefined && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
    })
    sendJson(response, 200, {
      data: tryParseJson(result.rawText),
      rawText: result.rawText,
      status: result.status,
      statusText: result.ok ? 'OK' : 'ERROR',
      headers: Object.fromEntries(
        [...result.headers.entries()].filter(([key]) => key.toLowerCase() !== 'set-cookie'),
      ),
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/complete') {
    const payload = await readJsonBody(request)
    const resultValue = asRecord(payload['result'])
    const fields = asRecord(resultValue?.['fields'] ?? resultValue) ?? {}
    const fp = String(resultValue?.['fp'] ?? '') || state.prepared.fp
    sendJson(response, 200, { ok: true })
    state.finish(undefined, { fp, fields })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/log') {
    const payload = await readJsonBody(request)
    const line = String(payload['line'] ?? '').slice(0, 500)
    const now = Date.now()
    const last = pageLogThrottle.get(line)
    if (last === undefined || now - last > 600) {
      pageLogThrottle.set(line, now)
      if (pageLogThrottle.size > 2000) pageLogThrottle.clear()
      state.http.log.info(`verify:page ${line}`)
    }
    sendJson(response, 200, { ok: true })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/cancel') {
    sendJson(response, 200, { ok: true })
    state.finish(new Error('用户关闭了登录验证'))
    return
  }
  response.writeHead(404)
  response.end('Not Found')
}

function page (prepared: Prepared, sessionToken: string): string {
  const boot = safeJson({
    mode: prepared.mode,
    config: prepared.config,
    fp: prepared.fp,
    scriptUrl: prepared.scriptUrl,
    sessionToken,
    deviceId: prepared.deviceId,
    aid: prepared.aid,
    host: prepared.host,
    appName: prepared.appName,
    captchaScriptUrls: prepared.captchaScriptUrls,
    captchaOptions: prepared.captchaOptions,
  })
  return shell(
    '抖音登录安全验证',
    `
    <div id="app"><div class="loading">正在加载抖音安全验证…</div></div>
    <script src="/react.js?token=${encodeURIComponent(sessionToken)}"></script>
    <script src="/react-dom.js?token=${encodeURIComponent(sessionToken)}"></script>
    <script>window.__LOGIN_VERIFY__=${boot};</script>
    <script>${bridge(im.version)}</script>
    <script>window.startDouyinVerification();</script>
  `,
  )
}

/** 页面与官方验证组件之间的桥接脚本:代理请求 + 注入环境 + 启动验证 */
function bridge (appVersion: string): string {
  return String.raw`
    (() => {
      const boot = window.__LOGIN_VERIFY__;
      localStorage.setItem('s_v_web_id', boot.fp);
      document.cookie = 's_v_web_id=' + encodeURIComponent(boot.fp) + '; path=/';
      // 页面侧请求/异常轨迹上报,用于定位滑块等服务端 5001 等错误的请求来源。
      // pageLog 必须走未经包装的原始 fetch 并对同内容去重,否则上报动作本身会再触发 fetch 包装,形成日志风暴。
      const rawFetch = window.fetch.bind(window);
      const pageLogCache = {};
      const pageLog = (line) => {
        try {
          const key = String(line).slice(0, 200);
          const now = Date.now();
          if (pageLogCache[key] && now - pageLogCache[key] < 800) return;
          pageLogCache[key] = now;
          rawFetch('/api/log?token=' + encodeURIComponent(boot.sessionToken), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line})});
        } catch (e) {}
      };
      window.addEventListener('error', (e) => pageLog('window.error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '')), true);
      window.addEventListener('unhandledrejection', (e) => pageLog('unhandledrejection: ' + ((e.reason && (e.reason.message || e.reason)) || String(e.reason))));
      const origFetch = window.fetch;
      window.fetch = (...args) => {
        const target = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        const method = ((args[1] && args[1].method) || 'GET');
        const isLog = String(target).includes('/api/log');
        if (!isLog) pageLog('fetch ' + method + ' ' + target);
        return origFetch.apply(window, args).then((res) => {
          if (!res.ok && !isLog) pageLog('fetch ERR ' + method + ' ' + target + ' -> ' + res.status);
          return res;
        }).catch((e) => { if (!isLog) pageLog('fetch FAIL ' + method + ' ' + target + ' ' + (e.message || e)); throw e; });
      };
      // 官方验证码 SDK 走原生 XHR(非 fetch):同样截获轨迹(vc/setting、滑块提交等)
      const xhrOpen = XMLHttpRequest.prototype.open;
      const xhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__pxMethod = String(method || 'GET');
        this.__pxUrl = String(url || '');
        pageLog('xhr ' + this.__pxMethod + ' ' + this.__pxUrl);
        return xhrOpen.apply(this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.send = function (...rest) {
        const self = this;
        this.addEventListener('loadend', () => {
          if (!self.__pxUrl) return;
          const text = String(self.responseText || '').slice(0, 160).replace(/\s+/g, ' ');
          pageLog('xhr END ' + self.__pxMethod + ' ' + self.__pxUrl + ' -> ' + self.status + ' ' + text);
        });
        return xhrSend.apply(this, rest);
      };
      const complete = async (result = {}) => {
        const response = await fetch('/api/complete?token=' + encodeURIComponent(boot.sessionToken), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({result})});
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || '恢复登录失败');
        document.getElementById('app').innerHTML = '<main class="card"><h1>验证通过</h1><p>正在继续登录,可以关闭此页。</p></main>';
      };
      const proxy = async (config = {}) => {
        const encode = (value) => value instanceof Date ? value.toISOString() : value && typeof value === 'object' ? JSON.stringify(value) : String(value);
        const params = new URLSearchParams();
        Object.entries(config.params || {}).forEach(([key, value]) => {
          if (value == null) return;
          if (Array.isArray(value)) value.forEach(item => params.append(key + '[]', encode(item)));
          else params.append(key, encode(value));
        });
        let url = config.url || '';
        if (params.size) url += (url.includes('?') ? '&' : '?') + params;
        let body = config.data;
        const headers = {...(config.headers || {})};
        const contentTypeKey = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
        const contentType = contentTypeKey ? String(headers[contentTypeKey]).toLowerCase() : '';
        if (body instanceof FormData) {
          const form = new URLSearchParams();
          for (const [key, value] of body.entries()) form.append(key, encode(value));
          body = form.toString();
          headers[contentTypeKey || 'Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (body && typeof body === 'object') {
          if (contentType.includes('application/json')) body = JSON.stringify(body);
          else {
            const form = new URLSearchParams();
            Object.entries(body).forEach(([key, value]) => {
              if (value == null) return;
              if (Array.isArray(value)) value.forEach(item => form.append(key + '[]', encode(item)));
              else form.append(key, encode(value));
            });
            body = form.toString();
            headers[contentTypeKey || 'Content-Type'] = 'application/x-www-form-urlencoded';
          }
        }
        const response = await fetch('/api/request?token=' + encodeURIComponent(boot.sessionToken), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,baseURL:config.baseURL,method:config.method || 'GET',headers,body})});
        const result = await response.json();
        if (!response.ok || result.error) throw result;
        const axiosResponse = {data: result.data, status: result.status, statusText: result.statusText, headers: result.headers, config};
        if (result.status < 200 || result.status >= 300) {
          const error = new Error('Request failed with status code ' + result.status);
          error.response = axiosResponse;
          error.config = config;
          throw error;
        }
        return axiosResponse;
      };
      window.$$UCALL_APIMAP = window.$$UCALL_APIMAP || {};
      window.$$UCALL_APIMAP['Request.fetch'] = proxy;
      window.$$UCALL_APIMAP['Request.fetchSec'] = proxy;
      window.$$UCALL_APIMAP.Request = proxy;
      window.$$UC_CORE_ENV = {env:'online',container:'web',region:'CN'};
      window.$$UC_ENV_PROMISE = Promise.resolve(window.$$UC_CORE_ENV);
      window.$$UCALL_APIMAP.getEnv = () => window.$$UC_ENV_PROMISE;
      window.$$UCALL_APIMAP.getQuery = () => Object.fromEntries(new URLSearchParams(location.search));
      window.$$UCALL_APIMAP.getSettings = (params) => proxy({url:'/service/settings/v3/',params});
      window.ucSecondVerifyReact = window.React;
      window.ucSecondVerifyReactDom = window.ReactDOM;
      const loadScript = (urls) => new Promise((resolve, reject) => {
        const remaining = [...urls];
        const next = () => {
          const url = remaining.shift();
          if (!url) return reject(new Error('抖音验证 SDK 加载失败'));
          const script = document.createElement('script');
          script.crossOrigin = 'anonymous';
          script.src = url;
          script.onload = resolve;
          script.onerror = next;
          document.head.appendChild(script);
        };
        next();
      });
      // 探针1:hook iframe.src,抓取 SDK 构造的滑块 iframe URL(外层 XHR 拦截看不到 iframe 内/captcha/get,
      // 但从 iframe URL 能确认 repoId/h5_check_version 等是否真正透传)
      const frameDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      if (frameDesc && frameDesc.set) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
          get () { return frameDesc.get.call(this); },
          set (v) {
            try {
              const s = String(v);
              if (s.includes('rmc.bytedance.com') || s.includes('verifycenter')) {
                pageLog('iframe src ' + s.slice(0, 700));
              }
            } catch (e) {}
            return frameDesc.set.call(this, v);
          },
          configurable: true,
        });
      }
      window.startDouyinVerification = async () => {
        // 官方 captcha/get 请求不带 did(带随机 hex did 会被服务端判参数错误 501),故 commonOptions 不再传 did
        const common = {aid:boot.aid,iid:String(boot.config.iid || '0'),...(boot.config.scene_level ? {scene_level:boot.config.scene_level} : {})};
        if (boot.mode === 'verify-center') {
          await loadScript(boot.captchaScriptUrls || []);
          const sdk = window.verifySDK;
          if (!sdk) throw new Error('抖音验证码 SDK 加载失败');
          // repoId / h5_check_version / extraConfig / scene_level 与官方成功链路一致(缺失导致 captcha/get 501)
          const captchaOptions = {fp:boot.fp,app_name:boot.appName,lang:'zh',showMode:'mask',region:'cn',baseEM:70,...(boot.captchaOptions || {})};
          // 探针2:SDK 实际收到的初始化参数
          const origInit = sdk.initVerifyOptions.bind(sdk);
          sdk.initVerifyOptions = (opt) => { pageLog('initVerifyOptions ' + JSON.stringify(opt).slice(0, 600)); return origInit(opt); };
          sdk.initVerifyOptions({commonOptions:common,captchaOptions});
          const success = () => {
            // getCaptchaWebId 可能返回对象(如 {web_id}),服务端 fp 只接受 verify_* 字符串;
            // 非法值会污染下一次登录请求的 fp → 5014/502,回退到本页 fp
            const webId = sdk.getCaptchaWebId && sdk.getCaptchaWebId();
            const fp = typeof webId === 'string' && webId.startsWith('verify_') ? webId : boot.fp;
            complete({fp});
          };
          const close = () => fetch('/api/cancel?token=' + encodeURIComponent(boot.sessionToken),{method:'POST'});
          // 决策 JSON 里可能有 did,官方 iframe URL(HAR #14/#263)完全不带 did;
          // SDK 合并 commonOptions/captchaOptions/verify_data 时会把它透传 → captcha/get 501,故先删
          const verifyData = {...boot.config};
          delete verifyData.did;
          sdk.autoRender({verify_data:verifyData,captchaOptions:{successCb:success,closeCb:close,errorCb:()=>{}},secondVerifyWebOptions:{callBack:success,closeCallBack:close}});
          return;
        }
        // 决策带 url 用平台下发的 SDK,否则用本地内置官方 SDK(同客户端 chunk 76861 产物)
        await loadScript(boot.scriptUrl ? [boot.scriptUrl] : ['/second-verify-sdk.js?token=' + encodeURIComponent(boot.sessionToken)]);
        if (typeof window.ucWebSecondVerify !== 'function') throw new Error('抖音二次验证 SDK 加载失败');
        const callback = () => complete({});
        const generalParams = {is_new_login:'1',is_from_iesaccountsaas:1};
        const getGeneralParams = async () => ({device_id:boot.deviceId,iid:common.iid,version_code:${JSON.stringify(appVersion)},device_platform:'PC'});
        const monitorTime = {startTime:Date.now(),fetchEndTime:Date.now(),scriptLoadStartTime:0,scriptLoadEndTime:Date.now(),renderStartTime:Date.now()};
        window.$$account_verify_portrait_id = boot.config.verify_portrait_id || '';
        const verifyData = {...boot.config};
        delete verifyData.did; // 决策 JSON 若带 did,也会被 SDK 合并进 iframe URL → captcha/get 501,同 common 一起清洗
        window.ucWebSecondVerify({...verifyData,aid:boot.aid,appName:boot.appName,did:boot.deviceId,iid:common.iid,host:boot.host,newSecondVerifyRequestHost:boot.host,newSecondVerificationCall:{reportAppLog:()=>{}},region:'cn',hcSwitch:false,isOversea:false,ztsdk:false,ztsdkOptions:{agid:1,enableCookieOptions:false},ssoZtsdkOptions:{enable:false},captchaOptions:{fp:boot.fp,baseEM:70},commonOptions:common,generalParams,getGeneralParams,monitorTime,uc_account_verify_version:'1.0.29',fun:boot.config.verify_from === 'verify_center' ? 'verify_center' : 'verify',Request:proxy,request:proxy,verifyFinishCallback:callback,callBack:callback,closeCallBack:()=>fetch('/api/cancel?token=' + encodeURIComponent(boot.sessionToken),{method:'POST'})});
      };
    })();
  `
}

function shell (title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f5f5f5;color:#161823;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center}.card{width:min(420px,calc(100vw - 32px));background:white;border-radius:16px;padding:28px;box-shadow:0 12px 48px #0001}.card h1{font-size:22px;margin:0 0 12px}.card p,.loading{color:#666}#app{min-width:min(420px,calc(100vw - 32px))}
  </style></head><body>${body}</body></html>`
}

function resolveUrl (urlValue: unknown, baseValue: unknown): URL {
  const url = String(urlValue ?? '')
  const base = String(baseValue ?? 'https://imdesktop.douyin.com')
  return new URL(url, base)
}

function assertHost (url: URL): void {
  const host = url.hostname.toLowerCase()
  if (HOSTS.has(host)) return
  throw new Error(`登录验证拒绝访问未知主机: ${host}`)
}

function sanitizeHeaders (headers: Record<string, string>): Record<string, string> {
  const blocked = new Set([
    'connection',
    'content-length',
    'cookie',
    'host',
    'origin',
    'proxy-authorization',
    'referer',
    'set-cookie',
    'transfer-encoding',
  ])
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())),
  )
}

async function readJsonBody (request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > 1_048_576) throw new Error('登录验证请求过大')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('登录验证请求格式错误')
  }
  return parsed as Record<string, unknown>
}

function sendJson (response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(data))
}

function sendHtml (response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  response.end(html)
}

function sendScript (response: ServerResponse, script: Buffer): void {
  response.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  })
  response.end(script)
}

function safeJson (value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

function escapeHtml (value: string): string {
  return value.replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  )
}

/** Passport 字段编码:字符串原样,数字/布尔转字符串,对象 JSON 序列化 */
function encodeField (value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function parseDecisionConf (value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return asRecord(parsed) ?? { verify_data: parsed }
  } catch {
    return { verify_data: value }
  }
}

function asRecord (value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asStringRecord (value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, item]) => item != null)
      .map(([key, item]) => [key, String(item)]),
  )
}

function tryParseJson (value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
