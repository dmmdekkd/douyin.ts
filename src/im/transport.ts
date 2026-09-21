import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import {
  AndroidFrontierWs, decodeWire, encodeRequest, decodeResponseRaw,
  ANDROID_SDK_VERSION, ANDROID_UA, fieldBytes, fieldStringValue, fieldVarint, kv,
} from './protocol/index.js'
import { collectKeyValues, messageChildren } from './notice.js'
import { frontierSign, WS_SIGN_CMDS } from '../sign/index.js'
import type { Http } from '../http/client.js'
import type { Log } from '../log.js'
import type { WireField } from './protocol/index.js'

/** 官方 PC 客户端 UA（媒体上传与 Cookie 通道共用） */
export const PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) douyin/8.5.302 Chrome/136.0.7103.59 Electron/36.4.0-rs.31.release.pgo.7 TTElectron/36.4.0-rs.31.release.pgo.7 Safari/537.36 awemePcClient/8.5.302 buildId/469548567 osName/Windows'

/** Desktop Cookie 通道 profile（对照官方 native ImOption；设备身份走 URL query 而非 envelope headers） */
const desktop = {
  appId: 339757,
  appName: 'aweme_im_desktop',
  version: '1.2.1',
  buildNumber: 'eb11b84dd0eb26ae22321b53426d3f976b920862',
  apiUrl: 'https://imapi3-normal.zijieapi.com',
  access: 'cpp_sdk',
  biz: 'douyin_im_pc',
} as const

/** 官方桌面 IM 客户端 UA */
const IM_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) douyinim/1.2.1 Chrome/130.0.6723.58 Electron/33.2.0 Safari/537.36'

/** config/v2 与 batch_play_info 共用的 desktop 指纹 query（媒体上传用）。 */
export function fingerprintParams (deviceId: string, guid: string): URLSearchParams {
  return new URLSearchParams({
    aid: String(desktop.appId),
    version_name: '1.1.33',
    version_code: '1.1.33',
    device_platform: 'win32',
    os_version: '10.0.26200',
    screen_width: '1707',
    screen_height: '1067',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version: PC_UA.replace(/^Mozilla\//, ''),
    browser_online: 'true',
    cookie_enabled: 'true',
    device_id: deviceId,
    did: deviceId,
    iid: '0',
    awemeim_guid: guid,
    channel: '0',
  })
}

/** 官方桌面客户端 queryMap（设备身份载体；native ImOption.headersMap 为空） */
function imQuery (deviceId: string): Record<string, string> {
  return {
    aid: String(desktop.appId),
    app_name: desktop.appName,
    did: deviceId,
    device_id: deviceId,
    iid: '0',
    channel: '0',
    os_version: os.release(),
    version_code: desktop.version,
    version_name: desktop.version,
    device_platform: 'windows',
    device_type: process.arch,
    device_brand: '',
  }
}

/** HTTP protobuf 通道：Desktop cookie 通道（发送/收件箱查询/动作/撤回/陌生人消息） */
export class ProtoTransport {
  constructor (
    private readonly http: Http,
    private readonly log: Log,
  ) { }

  /** Desktop Cookie 通道（native ImOption profile：设备身份在 URL query，envelope headers 为空）。 */
  async sendCookieProto (
    cmd: number,
    inboxType: number,
    endpoint: string,
    body: Record<string, unknown>,
    deviceId: string,
  ): Promise<Record<string, unknown>> {
    const payload = encodeRequest({
      token: '',
      cmd,
      inboxType,
      body,
      authType: 1,
      deviceId,
      sdkVersion: desktop.version,
      buildNumber: desktop.buildNumber,
      versionCode: desktop.version,
      devicePlatform: 'windows',
      biz: desktop.biz,
      access: desktop.access,
      headers: {},
    })
    const url = new URL(endpoint, desktop.apiUrl)
    for (const [key, value] of Object.entries(imQuery(deviceId))) {
      url.searchParams.set(key, value)
    }
    const requestBody = Buffer.from(payload)
    const res = await this.http.bytes(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'x-protobuf',
        'Content-Type': 'application/x-protobuf',
        // Native Cronet SetMD5Header：请求体 MD5 hex（非签名，但缺失会被网关拒绝）
        'x-ss-stub': createHash('md5').update(requestBody).digest('hex'),
        'User-Agent': IM_UA,
        Referer: 'https://imdesktop.douyin.com',
      },
      body: requestBody,
    })
    if (!res.ok) {
      throw new Error(`IM Cookie HTTP ${res.status} ${endpoint}: ${Buffer.from(res.data).toString('utf8', 0, 200)}`)
    }
    try {
      const decoded = decodeResponseRaw(res.data)
      const statusCode = Number(decoded['statusCode'] ?? 0)
      if (statusCode !== 0) {
        this.log.warn(`cmd=${cmd} ${endpoint} 失败: statusCode=${statusCode} errorDesc=${String(decoded['errorDesc'] ?? '')}`)
      }
      return decoded
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`IM Cookie response decode failed cmd=${cmd} ${endpoint}: ${detail}`)
    }
  }
}

/* ---------------------------------------------------------------------------
 * Android Frontier WS cmd=100 直发（绕 HTTP imapi 群聊 7523 风控；帧结构逆自安卓端）
 * 三层：外层 frontier f1 seq f2 ts f3 5 f4 1 f5 KV f6/f7 "pb" f8=inner
 *      内层 cmd100 f1 100 f2 seq f3 sdkver f7 build f8=msgWrapper f9 uid f11 "android" f15 KV f21/f22 biz/access
 *      msgWrapper f100 = field100{ f1 conv_id f2 conv_type f3 short f4 content f5 ext f6 msg_type f8 cmid f12 ext12 }
 * ------------------------------------------------------------------------- */

/** 安卓端常量（WS 通道 cmd100 envelope 用；握手常量见 protocol/ws.ts） */
const android = {
  aid: '1128',
  versionCode: '280400',
  channel: 'douyinweb1_64',
  deviceType: '24031PN0DC',
  osVersion: '14',
  appName: 'aweme',
  buildNumber: '5030',
  biz: 'douyin',
  access: 'douyin_main',
} as const

/** ch1(douyin_main) 的 msgWrapper f5 ext KV（含时间戳，逆自安卓端 buildSendMessage case 1） */
function sendExt (ms: number): [string, string][] {
  return [
    ['s:ticket_mode', '0'],
    ['im_client_send_msg_time', String(ms - 500)],
    ['a:plv', '1'],
    ['a:access', android.access],
    ['s:biz_aid', android.aid],
    ['chat_scene', 'normal'],
    ['a:msg_scene', '1'],
    ['im_sdk_client_send_msg_time', String(ms - 375)],
    ['a:relation_type', '0:0'],
    ['a:smp_token_fetch', '11'],
    ['a:ntp_ready', '2'],
    ['s:sync_2_newdx', '1'],
    ['old_client_message_id', String(ms)],
    ['s:mode', '0'],
    ['a:enter_method', 'click_message'],
    ['a:biz', android.biz],
    ['s:is_stranger', 'false'],
    ['source_aid', android.aid],
    ['s:saas_sdk', 'false'],
    ['a:sync2dx', '1'],
    ['s:refer', '3'],
  ]
}

/** msgWrapper f12 ext KV（s:send_ignore_ticket=true 免会话 ticket；proto schema 无 field 12，必须裸编码） */
const sendExt12: [string, string][] = [
  ['s:reverse_creator_im_ex', '0'],
  ['a:from_role_ids', ''],
  ['s:im_creator_chat_opt_exp', '0'],
  ['s:send_ignore_ticket', 'true'],
  ['s:im_chat_priv_opt_exp', '1'],
  ['a:to_role_ids', '[]'],
]

/** cmd100 内层 envelope f15 headers KV（设备身份载体） */
function androidHeaders (uid: string): [string, string][] {
  return [
    ['app_name', android.appName], ['iid', uid], ['version_code', android.versionCode],
    ['net_mcc_mnc', '46000'], ['aid', android.aid], ['flow-tag', 'new'], ['user-agent', ANDROID_UA],
  ]
}

let sendSeq = 0

export interface Cmd100FrameOptions {
  /** 账号 uid（envelope device_id 与 WS 握手共用） */
  userId: string
  conversationId: string
  conversationShortId: string
  /** 已按安卓 ch1 形状包装好的消息 content JSON */
  content: string
  conversationType: number
  messageType: number
}

/** 组一条 WS cmd=100 发送帧，返回帧字节与 clientMessageId（回执匹配键） */
export function buildCmd100Frame (options: Cmd100FrameOptions): { frame: Uint8Array; clientMessageId: string } {
  const seq = ++sendSeq
  const ms = Date.now()
  const clientMessageId = randomUUID()

  let field100 = Buffer.concat([
    fieldStringValue(1, options.conversationId),
    fieldVarint(2, options.conversationType),
    fieldVarint(3, BigInt(options.conversationShortId || '0')),
    fieldStringValue(4, options.content),
  ])
  for (const [key, value] of sendExt(ms)) field100 = Buffer.concat([field100, kv(5, key, value)])
  field100 = Buffer.concat([field100, fieldVarint(6, options.messageType)])
  // f7 ticket 服务端按会话下发；多数会话不需要，首发不携带
  field100 = Buffer.concat([field100, fieldStringValue(8, clientMessageId)])
  for (const [key, value] of sendExt12) field100 = Buffer.concat([field100, kv(12, key, value)])

  let inner = Buffer.concat([
    fieldVarint(1, 100),
    fieldVarint(2, seq),
    fieldStringValue(3, ANDROID_SDK_VERSION),
    fieldVarint(5, 1),
    fieldVarint(6, 0),
    fieldStringValue(7, android.buildNumber),
    fieldBytes(8, field100),
    fieldStringValue(9, options.userId),
    fieldStringValue(10, android.channel),
    fieldStringValue(11, 'android'),
    fieldStringValue(12, android.deviceType),
    fieldStringValue(13, android.osVersion),
    fieldStringValue(14, android.versionCode),
  ])
  for (const [key, value] of androidHeaders(options.userId)) inner = Buffer.concat([inner, kv(15, key, value)])
  inner = Buffer.concat([
    inner,
    fieldVarint(18, 0),
    fieldStringValue(21, android.biz),
    fieldStringValue(22, android.access),
  ])

  let frame = Buffer.concat([
    fieldVarint(1, seq),
    fieldVarint(2, ms),
    fieldVarint(3, 5),
    fieldVarint(4, 1),
  ])
  const headers: [string, string][] = [
    ['msg_type', 'cmd100'], ['seq_id', String(seq)], ['cmd', '100'], ['is-retry', '0'], ['flow-tag', 'new'],
  ]
  // 需签名命令把 frontierSign 结果追加进外层 f5 头
  if (WS_SIGN_CMDS.has(100)) {
    for (const sign of frontierSign(inner, { userAgent: ANDROID_UA })) {
      headers.push([sign.key, sign.value])
    }
  }
  for (const [key, value] of headers) frame = Buffer.concat([frame, kv(5, key, value)])
  frame = Buffer.concat([
    frame,
    fieldStringValue(6, 'pb'),
    fieldStringValue(7, 'pb'),
    fieldBytes(8, inner),
  ])
  return { frame, clientMessageId }
}

export interface SendAck {
  serverMessageId?: string
  blocked?: boolean
  reason?: string
}

/** 回执命中状态码（8101/8610/10502 均视为风控拦截） */
const BLOCKED_CALLBACK = new Set(['8101', '8610', '10502'])

function varint (fields: WireField[], field: number): string | undefined {
  const hit = fields.find(item => item.type === 'varint' && item.field === field)?.value
  return hit !== undefined ? hit.toString() : undefined
}

/** 回执匹配：.8.6.500.5[*] f9 KV[s:client_message_id] 命中 → f3=server_msg_id；风控看 shark/callback */
export function matchSendAck (payload: Uint8Array, wantCmid: string): SendAck | undefined {
  for (const f8 of messageChildren(decodeWire(payload), 8)) {
    for (const f6 of messageChildren(f8, 6)) {
      for (const f500 of messageChildren(f6, 500)) {
        for (const msg of messageChildren(f500, 5)) {
          const values = collectKeyValues(msg, 9)
          if (values.get('s:client_message_id') !== wantCmid) continue
          const sid = varint(msg, 3)
          const shark = values.get('s:vcd_shark_decision')
          const callback = values.get('im_callback_status_code')
          const blocked = shark === 'BLOCK' || (callback != null && BLOCKED_CALLBACK.has(callback))
          return {
            ...(sid && sid !== '0' ? { serverMessageId: sid } : {}),
            ...(blocked ? { blocked: true, reason: shark === 'BLOCK' ? 'shark=BLOCK' : `callback=${callback ?? ''}` } : {}),
          }
        }
      }
    }
  }
  return undefined
}

export interface Cmd100SendOptions extends Cmd100FrameOptions {
  /** 浏览器 Cookie 串（WS 握手鉴权） */
  cookies: string
}

/** 一次性连接发送 cmd=100 帧并等回执；undefined 表示超时/连接失败/被静默拦截 */
export async function sendCmd100 (options: Cmd100SendOptions): Promise<SendAck | undefined> {
  const { frame, clientMessageId } = buildCmd100Frame(options)
  const ws = new AndroidFrontierWs({ userId: options.userId, cookies: options.cookies })
  const ack = await ws.sendOnce(frame, payload => matchSendAck(payload, clientMessageId))
  ws.close()
  return ack
}
