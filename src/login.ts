/** 扫码登录编排:设备注册 → 取码 → 轮询 → 本地安全验证 / MFA → 会话。不落盘任何东西。 */
import { browserInfo, encodeBrowserInfo } from './sign/browser.js'
import { mixEncode } from './sign/mix.js'
import { desktopBaseQuery, desktopUrl, encodeForm, signQuery, type SignExtras } from './sign/qs.js'
import { im } from './sign/const.js'
import { Http, verifyDecision } from './http/index.js'
import { form, type MfaRes } from './lite.js'
import { createDevice } from './device.js'
import { self } from './user.js'
import { parseDecision, stringifyFields, verify } from './verify.js'
import type { Log } from './log.js'

/** check_qrconnect 轮询间隔与总超时(协议节奏,勿随意改) */
const POLL_MS = 1100
const TIMEOUT_MS = 120_000
/** 上行短信确认轮询:3s 间隔 / 180s 上限 */
const UP_SMS_POLL_MS = 3000
const UP_SMS_TIMEOUT_MS = 180_000

const QR_BODY = {
  need_logo: 'false',
  need_short_url: 'false',
  is_frontier: 'true',
  is_new_login: '1',
  next: 'https://www.douyin.com',
} as const

export type QrStatus = 'new' | 'scanned' | 'confirmed' | 'expired' | (string & {})

export interface QrUserData {
  app_id?: number
  user_id?: number
  user_id_str?: string
  sec_user_id?: string
  screen_name?: string
  name?: string
  avatar_url?: string
  mobile?: string
  has_password?: number
  country_code?: number
  [key: string]: unknown
}

/** 服务端可选的二次验证方式(assist_ 前缀 = 安全手机) */
export interface VerifyWay {
  verify_way?: string
  mobile?: string
  sms_content?: string
  channel_mobile?: string
  [key: string]: unknown
}

export interface CheckData {
  status?: QrStatus
  error_code: number
  account_flow?: string
  encrypt_uid?: string
  biz_params?: Record<string, unknown>
  common_params?: Record<string, unknown>
  verify_ways?: VerifyWay[]
  /** 验证中心决策 conf(JSON 串或对象):需在本地验证页完成官方安全验证后重试 */
  verify_center_decision_conf?: string | Record<string, unknown>
  /** 验证中心二次决策 conf:一次验证通过后服务端可能再次下发 */
  verify_center_secondary_decision_conf?: string | Record<string, unknown>
  verify_ticket?: string
  captcha?: string
  description?: string
  desc_url?: string
  extra?: string
  redirect_url?: string
  scan_app_id?: number
  user_data?: QrUserData
  scan_user_info?: Record<string, unknown>
  scan_device_info?: Record<string, unknown>
}

interface Envelope<T> {
  message: string
  data: T
}

interface GetQrData {
  token: string
  qrcode: string
  expire_time: number
  error_code: number
  qrcode_index_url?: string
}

/** MFA 挑战参数 */
interface Challenge {
  encrypt_uid?: string
  biz_params?: Record<string, unknown>
  common_params?: Record<string, unknown>
}

/** 二次验证输入描述:kind=sms 附 maskedMobile,kind=password 需返回账号密码 */
export interface MfaInfo {
  kind?: 'sms' | 'password'
  maskedMobile?: string
}

export interface LoginOpts {
  /** 取码后回调:QR 串(扫码页 URL,兜底 token)与 base64 图,渲染权交给调用方 */
  onQr?: (qr: { url: string; base64?: string }) => void | Promise<void>
  /** 扫码状态:new/scanned/verifying/confirmed…(含中文提示文案) */
  onStatus?: (s: string) => void | Promise<void>
  /** 需本地安全验证时回调:验证页地址(浏览器打开) */
  onVerifyUrl?: (url: string) => void
  /** 触发二次验证时回调:返回短信验证码或密码;未提供则登录失败 */
  onMfa?: (info: MfaInfo) => string | Promise<string>
  userAgent?: string
  log?: Log
}

/** 登录会话:userId 为数字 uid(frontier 握手/消息过滤需要),存储由调用方自理 */
export interface Session {
  userId: string
  cookie: string
  userData?: QrUserData
}

/** 扫码登录全流程;调用链形态对齐 douyin-im beginLogin 桌面流程 */
export async function login (opts: LoginOpts = {}): Promise<Session> {
  const http = new Http({ userAgent: opts.userAgent, log: opts.log })
  // 服务端签发的设备身份是登录不触发短信二次验证的根因
  http.setDevice(await createDevice(opts.log))
  await ttwid(http).catch(() => undefined)

  const qr = await getQr(http)
  await opts.onQr?.({ url: qr.indexUrl ?? qr.token, base64: qr.base64 })
  const session = await poll(http, qr.token, opts)

  // passport 的 screen_name 是"用户xxx"默认昵称、avatar_url 是 mosaic 占位,用真实资料覆盖(失败不阻断)
  await self(http)
    .then(profile => {
      session.userData = {
        ...session.userData,
        ...(profile.nickname ? { screen_name: profile.nickname } : {}),
        ...(profile.avatar ? { avatar_url: profile.avatar } : {}),
      }
    })
    .catch(() => undefined)
  return session
}

/** 桌面端 ttwid 预热(失败不阻断登录) */
async function ttwid (http: Http): Promise<void> {
  await http.request(`${im.origin}/ttwid/check/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aid: Number(im.aid),
      service: 'imdesktop.douyin.com',
      unionHost: 'https://ttwid.bytedance.com',
      host: 'https://imdesktop.douyin.com',
      union: false,
      needFid: false,
      fid: '',
      migrate_priority: 0,
    }),
  })
}

/** account_sdk_source_info:优先 Cookie,缺失时以 browserInfo 模板编码并回写 */
function sdkSourceInfo (http: Http): string {
  const stored = http.jar.get('sdk_source_info')
  if (stored) return stored
  const info = encodeBrowserInfo(browserInfo())
  http.jar.set('sdk_source_info', info)
  return info
}

function signExtras (http: Http, bodyWire = ''): SignExtras {
  const extras: SignExtras = {
    userAgent: http.ua,
    appKey: im.appKey,
    aBogusVariant: 'jumpbyte-desktop',
    bodyWire,
  }
  const msToken = http.jar.get('msToken')
  if (msToken) extras.msToken = msToken
  return extras
}

/** GET /passport/web/get_qrcode/,返回二维码 token 与 base64 图片 */
async function getQr (http: Http): Promise<{ token: string; base64: string; indexUrl?: string }> {
  const query = desktopBaseQuery({
    deviceId: http.deviceId,
    installId: http.installId,
    accountSdkSourceInfo: sdkSourceInfo(http),
    bizTraceId: http.bizTraceId,
    next: QR_BODY.next,
    extra: { need_logo: 'false', need_short_url: 'true' },
  })
  const { search } = signQuery(query, {}, signExtras(http))
  const url = desktopUrl('/passport/web/get_qrcode/', search)
  const res = await http.json<Envelope<GetQrData>>(url, { headers: http.passportHeaders(url) })
  if (!res.ok) {
    throw new Error(`get_qrcode failed: HTTP ${res.status} ${res.text.slice(0, 200)}`)
  }
  const d = res.data.data
  if (d.error_code !== 0 || !d.qrcode) {
    throw new Error(`get_qrcode error_code=${d.error_code}`)
  }
  return { token: d.token, base64: d.qrcode, indexUrl: d.qrcode_index_url }
}

/** POST /passport/web/check_qrconnect/,返回当前扫码状态;fp 用于安全验证后回填 */
async function checkQr (
  http: Http,
  token: string,
  bodyOverrides?: Record<string, string>,
  fp?: string,
): Promise<{ data: CheckData; decision: string | undefined }> {
  const body: Record<string, string> = { ...QR_BODY, token, ...bodyOverrides }
  const query = desktopBaseQuery({
    deviceId: http.deviceId,
    installId: http.installId,
    accountSdkSourceInfo: sdkSourceInfo(http),
    bizTraceId: http.bizTraceId,
    extra: fp ? { fp } : undefined,
  })
  const bodyWire = encodeForm(body)
  const { search } = signQuery(query, body, signExtras(http, bodyWire))
  const url = desktopUrl('/passport/web/check_qrconnect/', search)
  const res = await http.json<Envelope<CheckData>>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...http.passportHeaders(url) },
    body: bodyWire,
  })
  if (!res.ok) {
    throw new Error(`check_qrconnect failed: HTTP ${res.status} ${res.text.slice(0, 200)}`)
  }
  return { data: res.data.data, decision: verifyDecision(res.headers) }
}

/** 轮询直至 confirmed / expired / 超时 */
async function poll (http: Http, token: string, opts: LoginOpts): Promise<Session> {
  let deadline = Date.now() + TIMEOUT_MS
  let last: CheckData | undefined
  let mfaDone = false
  let notified: string | undefined
  let extra: Record<string, string> = {}
  let verifyCount = 0
  let fp: string | undefined

  while (Date.now() < deadline) {
    let decision: string | undefined
    try {
      const res = await checkQr(http, token, extra, fp)
      last = res.data
      decision = res.decision
    } catch {
      await sleep(POLL_MS)
      continue
    }

    // 验证中心决策:需在本地验证页完成官方安全验证(滑块/短信/扫码等)后携带结果重试;
    // 登录态可信度不足是发送消息被会话级降权(7523)的根因,最多重试 3 次
    const center = verifyCount < 3 ? parseDecision(last, decision) : undefined
    if (center) {
      verifyCount += 1
      await opts.onStatus?.('verifying')
      const outcome = await verify(http, center, { onUrl: opts.onVerifyUrl })
      extra = { ...extra, ...stringifyFields(outcome.fields) }
      fp = outcome.fp ?? fp
      await opts.onStatus?.('verified')
      deadline = Date.now() + TIMEOUT_MS
      continue
    }

    // 短信/密码二次验证:验证通过后携带 biz_params 继续轮询
    if (!mfaDone && (last.account_flow === 'verify' || last.biz_params != null)) {
      await opts.onStatus?.('verifying')
      extra = { ...extra, ...await mfa(http, last, opts) }
      mfaDone = true
      continue
    }

    // 同一状态只回调一次(轮询期间 scanned 会重复出现)
    if (last.status && last.status !== notified) {
      notified = last.status
      await opts.onStatus?.(last.status)
    }
    if (last.status === 'confirmed') return sessionOf(http, last.user_data)
    if (last.status === 'expired') throw new Error('QR code expired')
    await sleep(POLL_MS)
  }

  throw new Error(`QR login timeout after ${TIMEOUT_MS}ms; last=${last?.status ?? 'none'}`)
}

/** 验证方式优先级:安全手机短信 > 绑定手机短信 > 上行短信(用安全手机发短信)> 登录密码 */
const WAY_PRIORITY = ['assist_mobile_sms_verify', 'mobile_sms_verify', 'assist_mobile_up_sms_verify', 'pwd_verify'] as const

function selectWay (data: CheckData): VerifyWay | undefined {
  const ways = data.verify_ways ?? []
  return WAY_PRIORITY
    .map(name => ways.find(way => way.verify_way === name))
    .find(Boolean)
}

/** 短信/密码二次验证:按优先级选择方式,通过后返回轮询需携带的 biz 参数 */
async function mfa (http: Http, data: CheckData, opts: LoginOpts): Promise<Record<string, string>> {
  const challenge: Challenge = {
    encrypt_uid: data.encrypt_uid,
    biz_params: data.biz_params,
    common_params: data.common_params,
  }
  const way = selectWay(data)
  if (!way?.verify_way) {
    const list = (data.verify_ways ?? []).map(w => w.verify_way).filter(Boolean).join(', ')
    throw new Error(`无可支持的验证方式(服务端可选:${list || '无'});请在抖音 App 完成该次身份验证后重试`)
  }
  if (way.verify_way === 'assist_mobile_up_sms_verify') {
    // 上行短信:用安全手机发指定短信,无需输入验证码
    await upSms(http, challenge, way, opts.onStatus)
  } else if (way.verify_way === 'pwd_verify') {
    // 登录密码验证:无需发码,直接提交密码
    if (!opts.onMfa) throw new Error('登录触发密码二次验证,但未提供 onMfa 回调')
    const password = await opts.onMfa({ kind: 'password' })
    if (!password) throw new Error('密码二次验证未收到输入')
    const validated = await validatePassword(http, challenge, password)
    if (!validated.data.ticket) {
      throw new Error(`扫码密码验证失败: ${validated.data.error_code ?? '-'} ${validated.data.description ?? validated.message ?? ''}`)
    }
    await opts.onStatus?.('密码验证通过')
  } else {
    await sms(http, data, challenge, way.verify_way, way, opts)
  }
  return pickBiz(data.biz_params)
}

/** 短信验证码流程:依次尝试发码(选中的方式 → 辅助手机兜底),被拒时回退上行短信 */
async function sms (
  http: Http,
  data: CheckData,
  challenge: Challenge,
  wayName: string,
  way: VerifyWay,
  opts: LoginOpts,
): Promise<void> {
  if (!opts.onMfa) throw new Error('登录触发短信二次验证,但未提供 onMfa 回调')
  const tryWays = wayName === 'mobile_sms_verify'
    ? [wayName, 'assist_mobile_sms_verify']
    : [wayName]
  let sent: MfaRes | undefined
  let used: string | undefined
  for (const candidate of tryWays) {
    const res = await sendCode(http, challenge, candidate)
    if (res.message === 'success') {
      sent = res
      used = candidate
      break
    }
    sent = res
  }
  if (!sent?.message || sent.message !== 'success' || !used) {
    // 发码被拒:优先回退上行短信验证
    const up = (data.verify_ways ?? []).find(w => w.verify_way === 'assist_mobile_up_sms_verify')
    if (up?.verify_way) {
      await opts.onStatus?.(`发码被拒(${sent?.message ?? 'unknown'}${sent?.data.description ? `: ${sent.data.description}` : ''}),改用上行短信验证`)
      await upSms(http, challenge, up, opts.onStatus)
      return
    }
    throw new Error(`发送短信验证码失败: ${sent?.message ?? 'unknown'}${sent?.data.description ? ` - ${sent.data.description}` : ''}`)
  }
  if (used !== wayName) await opts.onStatus?.('已改用辅助手机接收验证码')
  const maskedMobile = sent.data.mobile ?? way.mobile
  const code = await opts.onMfa({ kind: 'sms', maskedMobile: maskedMobile != null ? String(maskedMobile) : undefined })
  const validated = await validateCode(http, challenge, used, code)
  if (!validated.data.ticket) {
    throw new Error(`扫码短信验证失败: ${validated.data.error_code ?? '-'} ${validated.data.description ?? validated.message ?? ''}`)
  }
  await opts.onStatus?.('verified')
}

/** 上行短信验证:用安全手机编辑指定短信发送到服务端号码,轮询 validate_code 等确认 */
async function upSms (
  http: Http,
  challenge: Challenge,
  way: VerifyWay,
  onStatus?: (s: string) => void | Promise<void>,
): Promise<void> {
  const content = way.sms_content || 'YZ'
  await onStatus?.(`请用安全手机(${way.mobile ?? ''})编辑短信"${content}"发送到 ${way.channel_mobile ?? ''}`)
  const deadline = Date.now() + UP_SMS_TIMEOUT_MS
  let last: MfaRes | undefined
  while (Date.now() < deadline) {
    await sleep(UP_SMS_POLL_MS)
    try {
      last = await validateCode(http, challenge, way.verify_way ?? 'assist_mobile_up_sms_verify')
    } catch {
      continue
    }
    if (last.data.ticket) {
      await onStatus?.('短信验证通过')
      return
    }
  }
  throw new Error(`上行短信验证超时: ${last?.data.error_code ?? '-'} ${last?.data.description ?? ''}`)
}

function sendCode (http: Http, challenge: Challenge, verifyWay: string): Promise<MfaRes> {
  return form(http, '/passport/web/send_code/', mfaBody(challenge, verifyWay, { is6Digits: '1' }))
}

function validateCode (http: Http, challenge: Challenge, verifyWay: string, code?: string): Promise<MfaRes> {
  // 3737 桌面场景用 mixEncode,363c web 场景用 xorHex
  const encoded = code == null
    ? undefined
    : verifyWay === 'mobile_sms_verify' ? mixEncode(code) : xorHex(code)
  return form(http, '/passport/web/validate_code/', mfaBody(challenge, verifyWay, encoded != null ? { code: encoded } : {}))
}

/**
 * 登录密码二次验证(pwd_verify,逆向自 second-verification-web.js):
 * POST /passport/web/account/verify/,password 字段 xorHex(Xor5+hex)编码 + mix_mode=1,
 * 无 type/send_code 步骤,成功返回 data.ticket。
 */
function validatePassword (http: Http, challenge: Challenge, password: string): Promise<MfaRes> {
  return form(http, '/passport/web/account/verify/', mfaBody(challenge, 'pwd_verify', { password: xorHex(password) }))
}

/** code_encrypt:UTF-8 每字节 ^5 后的两位 hex(363c 场景配套) */
function xorHex (s: string): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const bytes = c <= 0x7f ? [c]
      : c <= 0x7ff ? [0xc0 | ((c >> 6) & 0x1f), 0x80 | (c & 0x3f)]
        : c <= 0xffff ? [0xe0 | ((c >> 12) & 0x0f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)]
          : []
    for (const b of bytes) out += hex[(b ^ 5) >> 4] + hex[(b ^ 5) & 15]
  }
  return out
}

function mfaBody (challenge: Challenge, verifyWay: string, extra: Record<string, string>): Record<string, string> {
  const biz = challenge.biz_params ?? {}
  const common = challenge.common_params ?? {}
  const value = (source: Record<string, unknown>, key: string, fallback = ''): string => {
    const candidate = source[key]
    return candidate == null || candidate === '' ? fallback : String(candidate)
  }
  return {
    mix_mode: '1',
    // 绑定手机短信走桌面场景 3737;辅助手机/上行短信走 web 场景 363c;密码验证无 type 字段
    ...(verifyWay === 'pwd_verify' ? {} : { type: verifyWay === 'mobile_sms_verify' ? '3737' : '363c' }),
    encrypt_uid: challenge.encrypt_uid ?? '',
    verify_ticket: '',
    copywriting_key: value(common, 'copywriting_key', 'qr_connect'),
    ies_safety_diversion_tag: value(common, 'ies_safety_diversion_tag', 'mfa'),
    new_verify_flow: value(common, 'new_verify_flow'),
    std_verify_flow_id: value(biz, 'std_verify_flow_id', value(common, 'std_verify_flow_id')),
    std_verify_scene: value(biz, 'std_verify_scene', 'account_login'),
    std_verify_template: value(biz, 'std_verify_template', 'ato'),
    std_verify_token: value(biz, 'std_verify_token', value(common, 'std_verify_token')),
    std_verify_type: value(biz, 'std_verify_type', 'MFA'),
    std_verify_way: verifyWay,
    ...extra,
    aid: im.aid,
    new_authn_sdk_version: '1.0.0.421-web',
  }
}

const BIZ_KEYS = [
  'passport_mfa_retry_tag',
  'std_verify_flow_id',
  'std_verify_scene',
  'std_verify_template',
  'std_verify_token',
  'std_verify_type',
  'std_verify_way',
] as const

/** MFA 校验通过后,轮询 check_qrconnect 需要携带的 biz 参数 */
function pickBiz (params?: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  if (!params) return result
  for (const key of BIZ_KEYS) {
    const value = params[key]
    if (value != null) result[key] = String(value)
  }
  return result
}

function sessionOf (http: Http, userData?: QrUserData): Session {
  // 新版 uid_tt cookie 已是 hash 形态;frontier device_id / 消息过滤需要数字 uid
  const userId = userData?.user_id_str
    ?? (userData?.user_id != null ? String(userData.user_id) : undefined)
    ?? http.jar.get('uid_tt')
  if (!userId) throw new Error('confirmed but no userId (uid_tt cookie or user_data.user_id_str)')
  const session: Session = { userId, cookie: http.jar.header() }
  if (userData) session.userData = userData
  return session
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
