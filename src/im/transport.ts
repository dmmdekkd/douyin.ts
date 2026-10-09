import os from 'node:os'
import { createHash } from 'node:crypto'
import {
  AndroidFrontierWs, encodeRequest, decodeResponseRaw,
  ANDROID_SDK_VERSION, ANDROID_UA, fieldBytes, fieldStringValue, fieldVarint, kv,
} from './protocol/index.js'
import { frontierSign, WS_SIGN_CMDS } from '../sign/index.js'
import type { Http } from '../http/client.js'
import type { Log } from '../log.js'

/** 官方 PC 客户端 UA（媒体上传与 Cookie 通道共用） */
export const PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) douyin/8.5.302 Chrome/136.0.7103.59 Electron/36.4.0-rs.31.release.pgo.7 TTElectron/36.4.0-rs.31.release.pgo.7 Safari/537.36 awemePcClient/8.5.302 buildId/469548567 osName/Windows'

/** Desktop Cookie 通道 profile（对照官方 native ImOption；设备身份走 URL query 而非 envelope headers） */
const desktop = {
  appId: 339757,
  appName: 'aweme_im_desktop',
  version: '1.1.34',
  buildNumber: 'eb11b84dd0eb26ae22321b53426d3f976b920862',
  apiUrl: 'https://imapi3-normal.zijieapi.com',
  access: 'cpp_sdk',
  biz: 'douyin_im_pc',
} as const

/** 官方桌面 IM 客户端 UA（HAR 实测 Windows douyinim/1.1.34） */
const IM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) douyinim/1.1.34 Chrome/136.0.7103.59 Electron/36.4.0-rs.28.release.main.0 TTElectron/36.4.0-rs.28.release.main.0 Safari/537.36'

/** 原生通道 profile（对照 HAR：无 URL query、无 x-ss-stub；设备身份走 envelope f15 headers map） */
const native = {
  apiUrl: 'https://imapi.douyin.com',
  sdkVersion: '0.1.8',
  buildNumber: '0d50935:feat/pc-im-group',
  versionCode: '360000',
  devicePlatform: 'douyin_pc',
  biz: 'douyin_im_pc',
  access: 'web_sdk',
} as const

/** 原生通道 f15 headers map（设备身份载体） */
function nativeHeaders (deviceId: string): Record<string, string> {
  return {
    session_aid: String(desktop.appId),
    session_did: deviceId,
    app_name: 'douyin_pc',
    priority_region: 'cn',
    user_agent: IM_UA,
    cookie_enabled: 'true',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version: IM_UA.replace(/^Mozilla\//, ''),
    browser_online: 'true',
    screen_width: '1707',
    screen_height: '960',
    referer: '',
    timezone_name: 'Asia/Shanghai',
    'is-retry': '0',
  }
}

/** config/v2 与 batch_play_info 共用的 desktop 指纹 query（媒体上传用）。 */
export function fingerprintParams (deviceId: string, guid: string): URLSearchParams {
  return new URLSearchParams({
    aid: String(desktop.appId),
    version_name: '1.1.34',
    version_code: '1.1.34',
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
      throw new Error(`IM proto HTTP ${res.status} ${endpoint}: ${Buffer.from(res.data).toString('utf8', 0, 200)}`)
    }
    return this.decodeProto(cmd, endpoint, res.data)
  }

  /** 原生通道（imapi.douyin.com：无 URL query、无 x-ss-stub，设备身份在 envelope f15 headers map）。 */
  async sendNativeProto (
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
      sdkVersion: native.sdkVersion,
      buildNumber: native.buildNumber,
      versionCode: native.versionCode,
      devicePlatform: native.devicePlatform,
      biz: native.biz,
      access: native.access,
      headers: nativeHeaders(deviceId),
    })
    const res = await this.http.bytes(`${native.apiUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: 'application/x-protobuf',
        'Content-Type': 'application/x-protobuf',
        'User-Agent': IM_UA,
        Referer: 'https://imdesktop.douyin.com',
      },
      body: Buffer.from(payload),
    })
    if (!res.ok) {
      throw new Error(`IM proto HTTP ${res.status} ${endpoint}: ${Buffer.from(res.data).toString('utf8', 0, 200)}`)
    }
    return this.decodeProto(cmd, endpoint, res.data)
  }

  /** 两条通道共用的响应解码与失败诊断 */
  private decodeProto (cmd: number, endpoint: string, data: Uint8Array): Record<string, unknown> {
    let decoded: Record<string, unknown>
    try {
      decoded = decodeResponseRaw(data)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`IM proto response decode failed cmd=${cmd} ${endpoint}: ${detail}`)
    }
    const statusCode = Number(decoded['statusCode'] ?? 0)
    if (statusCode !== 0) {
      this.log.warn(`cmd=${cmd} ${endpoint} 失败: statusCode=${statusCode} errorDesc=${String(decoded['errorDesc'] ?? '')}`)
    }
    return decoded
  }
}

/** 安卓端常量（WS 通道 cmd411 envelope 用；握手常量见 protocol/ws.ts） */
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

/** cmd411 内层 envelope f15 headers KV（设备身份载体） */
function androidHeaders (uid: string): [string, string][] {
  return [
    ['app_name', android.appName], ['iid', uid], ['version_code', android.versionCode],
    ['net_mcc_mnc', '46000'], ['aid', android.aid], ['flow-tag', 'new'], ['user-agent', ANDROID_UA],
  ]
}

let sendSeq = 0

export interface Cmd411FrameOptions {
  /** 账号 uid（作 envelope device_id） */
  userId: string
  conversationId: string
  conversationShortId: string
  conversationType: number
  /** true=正在输入(3)，false=清除输入(4) */
  typing: boolean
}

/** 组一条 WS cmd=411 输入状态帧：f1=411、f8=SendInputStatusRequest（三层结构与 Android Frontier WS 帧一致） */
export function buildCmd411Frame (options: Cmd411FrameOptions): Uint8Array {
  const seq = ++sendSeq
  const ms = Date.now()

  const body = Buffer.concat([
    fieldStringValue(1, options.conversationId),
    fieldVarint(2, options.conversationType),
    fieldVarint(3, BigInt(options.conversationShortId || '0')),
    // InputStatus 枚举：3 正在输入 / 4 清除输入（与接收侧 input_status=1/0 不同）
    fieldVarint(4, options.typing ? 3 : 4),
  ])

  let inner = Buffer.concat([
    fieldVarint(1, 411),
    fieldVarint(2, seq),
    fieldStringValue(3, ANDROID_SDK_VERSION),
    fieldVarint(5, 1),
    fieldVarint(6, 0),
    fieldStringValue(7, android.buildNumber),
    fieldBytes(8, body),
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
    ['msg_type', 'cmd411'], ['seq_id', String(seq)], ['cmd', '411'], ['is-retry', '0'], ['flow-tag', 'new'],
  ]
  if (WS_SIGN_CMDS.has(411)) {
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
  return frame
}

export interface Cmd411SendOptions extends Cmd411FrameOptions {
  /** 浏览器 Cookie 串（WS 握手鉴权） */
  cookies: string
}

/** 一次性连接发送 cmd=411 输入状态帧（无确认回执，发完即关）；true=已发出 */
export async function sendCmd411 (options: Cmd411SendOptions): Promise<boolean> {
  const frame = buildCmd411Frame(options)
  const ws = new AndroidFrontierWs({ userId: options.userId, cookies: options.cookies })
  const ok = await ws.sendFireOnce(frame)
  ws.close()
  return ok
}


