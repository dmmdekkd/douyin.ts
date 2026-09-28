import { randomUUID } from 'node:crypto'
import protobuf from 'protobufjs'
import {
  buildAtAllTextContent,
  buildImageContent,
  buildVideoContent,
  buildFileContent,
  buildDesktopTextContent,
  buildReplyPayload,
  buildShareContent,
  buildUserCardContent,
  buildCardContent,
  buildLocationContent,
  buildGroupCardContent,
  normalizeDesktopTextMessageContent,
} from './content.js'
import { sendCmd411 } from './transport.js'
import type { ProtoTransport } from './transport.js'
import type { Log } from '../log.js'
import type { Http } from '../http/client.js'
import type {
  ConversationAddress,
  SendMessageItem,
  SendMessageReference,
  SendMessageResponse,
  SendBodyOptions,
  ForwardNode,
  ShareItem,
  MsgBody,
} from './types.js'
import type { TextMention } from './content.js'
import { isInput } from './source.js'
import type { UserCard, ImageAsset, FileAsset } from './media.js'

const LONG = protobuf.util.Long as unknown as { fromString (s: string): unknown }

/** 发送上下文：统一 HTTP cookie 通道（native ImOption profile）+ WS cmd411 输入状态通道 */
export interface SendContext {
  transport: ProtoTransport
  deviceId: string
  log: Log
  /** 直连 HTTP 客户端（云端接口：合并转发凭证/视频地址等） */
  http: Http
  /** 账号 uid（cmd411 帧 envelope device_id） */
  userId: string
  /** 浏览器 Cookie 串（cmd411 WS 握手鉴权） */
  cookies: string
}

function encodeReference (reference: SendMessageReference): Record<string, unknown> {
  return {
    referencedMessageId: LONG.fromString(reference.referencedMessageId),
    hint: reference.hint,
    ...(reference.rootMessageId ? { rootMessageId: LONG.fromString(reference.rootMessageId) } : {}),
    ...(reference.rootMessageConvIndex
      ? { rootMessageConvIndex: LONG.fromString(reference.rootMessageConvIndex) }
      : {}),
  }
}

/** cmd=100 /v1/message/send — 统一发送（文本/媒体/引用/编辑/盖楼全走 HTTP）。 */
export async function send (
  ctx: SendContext,
  options: SendMessageItem,
): Promise<SendMessageResponse> {
  const clientMessageId = options.clientMessageId ?? randomUUID()
  const timestamp = Date.now()
  const decoded = await ctx.transport.sendCookieProto(
    100,
    options.inboxType ?? 0,
    '/v1/message/send',
    {
      sendMessage: {
        conversationId: options.conversationId,
        conversationType: options.conversationType ?? 1,
        conversationShortId: LONG.fromString(options.conversationShortId || '0'),
        content: normalizeDesktopTextMessageContent(options.content, options.messageType ?? 7),
        messageType: options.messageType ?? 7,
        clientMessageId,
        ext: {
          // @所有人 值填 "0"（HAR 权威样本：web 客户端 @all 时 ext 含 s:mentioned_users="0"），普通消息留空
          's:mentioned_users': options.atAll ? '0' : '',
          's:client_message_id': clientMessageId,
          's:stime': `${timestamp}.${String(timestamp % 10_000).padStart(4, '0')}`,
        },
        ...(options.reference ? { refMsgInfo: encodeReference(options.reference) } : {}),
        // @所有人 必须显式写 f9 mentioned_users=[0]（HAR 权威样本：真 @all 请求 SendMessageRequest.f9=0；
        // 0 是「全体」约定，缺省则服务端不识别为真 @all，ext 的 s:mentioned_users 只是透传标记）
        ...(options.atAll
          ? { mentionedUsers: [LONG.fromString('0')] }
          : options.mentionedUsers?.length
            ? { mentionedUsers: options.mentionedUsers.map(uid => LONG.fromString(uid)) }
            : {}),
      },
    },
    ctx.deviceId,
  )
  const result = parseSendResponse(decoded, clientMessageId)
  if (result.checkCode === 10502) {
    // 文件/媒体消息常见：已提交、审核放行（raw_check_code=1），异步审核后对方可见
    ctx.log.info('消息已提交，审核中（10502），对方可能延迟可见')
  } else if (result.statusCode !== 0) {
    ctx.log.warn(
      `发送被拒: send={id:${options.conversationId} type:${options.conversationType ?? 1} ` +
      `short:${options.conversationShortId}} ` +
      `statusCode=${result.statusCode} check=${result.checkCode ?? '-'} detail=${result.statusMsg}`,
    )
  }
  return result
}

/** 发送文本（可带 @ 提及：content richTextInfos + mentionedUsers 字段） */
export async function sendText (
  ctx: SendContext,
  address: ConversationAddress,
  text: string,
  mentions?: TextMention[],
): Promise<SendMessageResponse> {
  return send(ctx, {
    ...address,
    content: mentions?.length ? buildDesktopTextContent(text, mentions) : text,
    messageType: 7,
    ...(mentions?.length ? { mentionedUsers: [...new Set(mentions.map(m => m.uid))] } : {}),
  })
}

/** 文本 + @ 提及合成 content：@ 渲染「@昵称 」占位（无昵称退回 uid），位置记录供 richTextInfos 使用 */
function textWithAts (text: string, ats?: Array<{ uid: string; nickname?: string }>, conId?: string): { content: string; mentions: TextMention[] } {
  const list = ats ?? []
  if (!list.length) return { content: text, mentions: [] }
  let content = text
  const mentions: TextMention[] = []
  for (const at of list) {
    const piece = `@${at.nickname ?? at.uid} `
    mentions.push({ uid: at.uid, conId, location: content.length, length: piece.length })
    content += piece
  }
  return { content: buildDesktopTextContent(content, mentions), mentions }
}

/**
 * 统一发送：type 判别各成一条消息（text 合 messageType=7、image 27 / video 30 / file 6 /
 * share 8 / user 25 / forward 136）；媒体字段须为已上传资产，输入源先经 bot.msg.send 自动上传。
 */
export async function sendBody (
  ctx: SendContext,
  address: ConversationAddress,
  body: MsgBody,
  opts?: SendBodyOptions,
): Promise<SendMessageResponse> {
  switch (body.type) {
    case 'text': {
      if (body.atAll) {
        // @所有人：content 前置「@所有人 」占位（infoType=4 mention_label 元数据），
        // ext 写 s:mentioned_users="0"（HAR 权威样本）；与 ats 同给时 atAll 优先。
        return send(ctx, {
          ...address,
          content: buildAtAllTextContent(body.text),
          messageType: 7,
          atAll: true,
          clientMessageId: opts?.clientMessageId,
        })
      }
      const { content, mentions } = textWithAts(body.text, body.ats, address.conversationId)
      return send(ctx, {
        ...address,
        content,
        messageType: 7,
        ...(mentions.length ? { mentionedUsers: [...new Set(mentions.map(m => m.uid))] } : {}),
        clientMessageId: opts?.clientMessageId,
      })
    }
    case 'image': {
      if (isInput(body.image)) throw new Error('图片输入源须先经 bot.msg.send 自动上传（或传预上传资产）')
      return sendImage(ctx, { ...address, image: body.image, clientMessageId: opts?.clientMessageId })
    }
    case 'video': {
      const video = body.video
      if ('source' in video) throw new Error('视频输入源须先经 bot.msg.send 自动上传（或传预上传资产）')
      if ('asset' in video) {
        const { asset, poster, width, height } = video
        return sendVideo(ctx, {
          ...address,
          video: {
            tkey: asset.tkey,
            skey: asset.skey,
            md5: asset.md5,
            ...(poster ? { poster } : {}),
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
          },
          clientMessageId: opts?.clientMessageId,
        })
      }
      return sendVideo(ctx, { ...address, video, clientMessageId: opts?.clientMessageId })
    }
    case 'file': {
      const file = body.file
      if ('source' in file) throw new Error('文件输入源须先经 bot.msg.send 自动上传（或传预上传资产）')
      return sendFile(ctx, { ...address, file: 'asset' in file ? file.asset : file, clientMessageId: opts?.clientMessageId })
    }
    case 'share':
      return sendShare(ctx, { ...address, item: body.share, clientMessageId: opts?.clientMessageId })
    case 'userCard':
      return sendUserCard(ctx, { ...address, user: body.user, clientMessageId: opts?.clientMessageId })
    case 'forward':
      return sendMergeForward(ctx, { ...address, nodes: body.nodes, selfUid: ctx.userId, clientMessageId: opts?.clientMessageId })
    case 'card':
      // 互动卡原样回传：patch 复用收侧载荷（含官方签名），description/push_detail 取展示文本
      return send(ctx, {
        ...address,
        content: buildCardContent(body.card, body.text ?? body.card.title ?? ''),
        messageType: 110,
        clientMessageId: opts?.clientMessageId,
      })
    case 'location':
      return send(ctx, {
        ...address,
        content: buildLocationContent(body.location),
        messageType: 502,
        clientMessageId: opts?.clientMessageId,
      })
    case 'groupCard':
      // 群聊邀请卡原样回传：from_uid 缺省以发送者身份填充，title/desc 自动构造
      return send(ctx, {
        ...address,
        content: buildGroupCardContent(body.groupCard, ctx.userId),
        messageType: 58,
        clientMessageId: opts?.clientMessageId,
      })
    default:
      ctx.log.warn(`不支持发送的消息类型 ${body.type}，已跳过`)
      throw new Error(`不支持发送的消息类型 ${body.type}`)
  }
}

/**
 * 上报输入状态（让对方显示「正在输入…」）。
 * 走 Android Frontier WS cmd=411（接收侧是 WS 504 推送）；
 * 无确认回执（fire-and-forget），返回 true 仅表示帧已发出。
 */
export async function sendTyping (
  ctx: SendContext,
  address: ConversationAddress,
  typing: boolean,
): Promise<boolean> {
  return sendCmd411({
    userId: ctx.userId,
    cookies: ctx.cookies,
    conversationId: address.conversationId,
    conversationShortId: address.conversationShortId || '0',
    conversationType: address.conversationType ?? 1,
    typing,
  })
}

export interface VoiceCallResult {
  /** call 阶段 VoipInfo.channel_id / create 失败的 channel_id */
  channelId?: string
  /** VoipStatus */
  status?: number
  /** CallVoipResponseBody.check_code */
  checkCode?: string
  /** CallVoipResponseBody.check_message */
  checkMessage?: string
  /** create 阶段 VoipStatusCode（非 0 表示创建失败） */
  statusCode?: number
}

/**
 * 发起语音通话——未支持。
 * 实测证伪（保留签名便于收敛）：cmd2011/2012 走 Android WS 服务端仅回框架 ACK 无业务响应；
 * imapi3 HTTP 通道路由表（StatusCodeRouteNotFound 全量列举）无任何 voip/voice 命令；
 * 官方桌面端 VOIP 走独立未公开端点（需 App 专属签名）。不再发起任何网络请求。
 */
export async function startVoiceCall (
  ctx: SendContext,
  address: ConversationAddress,
  calleeUid: string,
): Promise<VoiceCallResult> {
  ctx.log.warn(`语音通话未支持: 被叫=${calleeUid} 会话=${address.conversationShortId || '-'}`)
  return { statusCode: -1, checkMessage: '服务端无 VOIP 通道' }
}

export interface SendForwardOptions extends ConversationAddress {
  nodes: ForwardNode[]
  /** 发送者 uid（bot 自身） */
  selfUid: string
  /** 发送者 secUid（bot 自身） */
  selfSecUid?: string
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string
}

/** 节点文本摘要：文字原样，媒体占位（list_content.text） */
function nodeSummaryText (message: Array<{ type: string; text?: string }>): string {
  return message.map((el) => {
    if (el.type === 'text') return el.text ?? ''
    if (el.type === 'image') return '[图片]'
    if (el.type === 'video') return '[视频]'
    if (el.type === 'record') return '[语音]'
    return `[${el.type}]`
  }).join('')
}

/** 节点消息类型：文本 7/700，图片 27/2702，其余按文本处理 */
function nodeMessageType (message: Array<{ type: string }>): { msgType: number; aweType: number } {
  const first = message[0]?.type
  if (first === 'image') return { msgType: 27, aweType: 2702 }
  return { msgType: 7, aweType: 700 }
}

/** JSON 序列化：BigInt 输出为裸数字（uid/msg_id 等 19 位大整数超出 Number 精度，服务端按数字解析） */
function rawJson (value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `\u0000${v}\u0000` : v))
    .replace(/"\u0000(-?\d+)\u0000"/g, '$1')
}

/**
 * 合并转发（messageType=136）：list_content 为节点预览摘要，msg_ids 引用会话真实消息
 * （msg_id 须为原消息 serverMessageId）。协议限制：新版 App 点开按 upload_key 从云端拉取
 * 记录渲染，而云端注册接口 merge_msg_card/prepare 仅部署在 App 域（需 App 签名与登录态，
 * web/桌面域 status 4），故 SDK 只能发摘要卡片，接收端点开无内容。
 */
export async function sendMergeForward (
  ctx: SendContext,
  options: SendForwardOptions,
): Promise<SendMessageResponse> {
  if (!options.nodes.length) throw new Error('合并转发节点为空')
  const timestamp = Date.now()
  const listContent = options.nodes.map(node => ({
    msgid: BigInt(node.msgId),
    nick_name: node.nickname,
    text: node.text,
  }))
  const msgIds = options.nodes.map(node => ({
    msg_id: BigInt(node.msgId),
    msg_type: node.msgType,
    awe_type: node.aweType,
    show_flag: true,
    uid: BigInt(node.uid),
    ...(node.secUid ? { sec_uid: node.secUid } : {}),
    create_time: node.createTime ?? timestamp,
    ref_msg_invisible: 0,
  }))
  const generatedJson = rawJson({
    list_content: listContent,
    msg_ids: msgIds,
    origin_conv_id: BigInt(options.conversationShortId),
    title: `${options.nodes[0]?.nickname ?? ''} 的聊天记录`,
  })
  const content = generatedJson
  return send(ctx, { ...options, content, messageType: 136 })
}

/** 节点数组 → ForwardNode（客户端生成 19 位数字 msg_id） */
export function buildForwardNodes (
  nodes: Array<{ userId: string; nickname: string; message: Array<{ type: string; text?: string }> }>,
  selfUid: string,
  selfSecUid: string | undefined,
): ForwardNode[] {
  const timestamp = Date.now()
  return nodes.map((node, index) => {
    const { msgType, aweType } = nodeMessageType(node.message)
    return {
      uid: /^\d+$/.test(node.userId) ? node.userId : selfUid,
      nickname: node.nickname || '',
      text: nodeSummaryText(node.message),
      msgType,
      aweType,
      msgId: String(BigInt(timestamp) * 1000n + BigInt(index)),
      ...(node.userId === selfUid && selfSecUid ? { secUid: selfSecUid } : {}),
      createTime: timestamp,
    }
  })
}

export interface SendMediaOptions extends ConversationAddress {
  /** uploadImage 返回的图片资产 */
  image: ImageAsset
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string
}

/** 发送图片（gif → aweType 2703，其余 2702；messageType=27） */
export async function sendImage (
  ctx: SendContext,
  options: SendMediaOptions,
): Promise<SendMessageResponse> {
  return send(ctx, { ...options, content: buildImageContent(options.image), messageType: 27 })
}

export interface SendVideoOptions extends ConversationAddress {
  video: {
    tkey: string
    skey: string
    md5: string
    poster?: ImageAsset
    width?: number
    height?: number
    checkPics?: string[]
  }
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string
}

/** 发送视频（messageType=30，content 无 aweType） */
export async function sendVideo (
  ctx: SendContext,
  options: SendVideoOptions,
): Promise<SendMessageResponse> {
  return send(ctx, { ...options, content: buildVideoContent(options.video), messageType: 30 })
}

export interface SendFileOptions extends ConversationAddress {
  /** uploadFile 返回的文件资产 */
  file: FileAsset
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string
}

/** 发送文件（messageType=6、aweType=15001；9 会被客户端判「请升级最新版」，6 可发出但部分客户端渲染异常） */
export async function sendFile (
  ctx: SendContext,
  options: SendFileOptions,
): Promise<SendMessageResponse> {
  return send(ctx, { ...options, content: buildFileContent(options.file), messageType: 6 })
}

export interface SendShareOptions extends ConversationAddress {
  item: ShareItem
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string
}

/** 发送作品分享卡片（messageType=8 / aweType=800） */
export async function sendShare (
  ctx: SendContext,
  options: SendShareOptions,
): Promise<SendMessageResponse> {
  return send(ctx, { ...options, content: buildShareContent(options.item, ctx.userId), messageType: 8 })
}

export interface SendUserCardOptions extends ConversationAddress {
  user: UserCard
  /** 复用原 cmid（同会话幂等去重兜底，编辑不支持）；缺省随机 */
  clientMessageId?: string
}

/** 发送用户名片卡片（messageType=25 / aweType=0） */
export async function sendUserCard (
  ctx: SendContext,
  options: SendUserCardOptions,
): Promise<SendMessageResponse> {
  return send(ctx, { ...options, content: buildUserCardContent(options.user), messageType: 25 })
}

export interface ReplyOptions extends ConversationAddress {
  text: string
  referencedMessageId: string
  referencedMessageType: number
  referencedUid: string
  referencedSecUid?: string
  nickname?: string
  referencedText?: string
  rootMessageId?: string
  rootMessageConvIndex?: string
  /** @所有人 引用回复：正文前置「@所有人 」占位，f9 mentioned_users=[0]（与 sendBody 同形态） */
  atAll?: boolean
  /** @ 提及（正文 richTextInfos + f9 mentionedUsers）；缺省纯文本 */
  ats?: Array<{ uid: string; nickname?: string }>
}

/** 引用回复：正文 desktop 文本模板 + refMsgInfo（cmd100 field 11）；atAll/ats 时正文换 @ 模板并透传 f9 */
export async function reply (ctx: SendContext, options: ReplyOptions): Promise<SendMessageResponse> {
  const payload = buildReplyPayload({
    text: options.text,
    referencedMessageId: options.referencedMessageId,
    referencedMessageType: options.referencedMessageType,
    referencedUid: options.referencedUid,
    ...(options.referencedSecUid ? { referencedSecUid: options.referencedSecUid } : {}),
    ...(options.nickname ? { nickname: options.nickname } : {}),
    ...(options.referencedText ? { referencedText: options.referencedText } : {}),
    ...(options.rootMessageId ? { rootMessageId: options.rootMessageId } : {}),
    ...(options.rootMessageConvIndex ? { rootMessageConvIndex: options.rootMessageConvIndex } : {}),
  })
  // @所有人/@提及 的引用回复正文走对应模板（atAll 优先）；纯文本引用保持 buildReplyPayload 默认
  const content = options.atAll
    ? buildAtAllTextContent(options.text)
    : options.ats?.length
      ? textWithAts(options.text, options.ats, options.conversationId).content
      : payload.content
  const { ats, ...sendOptions } = options
  return send(ctx, {
    ...sendOptions,
    content,
    messageType: 7,
    reference: payload.reference,
    ...(ats?.length ? { mentionedUsers: [...new Set(ats.map(m => m.uid))] } : {}),
  })
}

/** body.sendMessageBody 解析：serverMessageId/status/checkCode/checkMessage */
function parseSendResponse (decoded: Record<string, unknown>, clientMessageId: string): SendMessageResponse {
  const statusCode = Number(decoded['statusCode'] ?? 0)
  const body = decoded['body'] as Record<string, unknown> | undefined
  const sendBody = body?.['sendMessage'] as {
    status?: number
    serverMessageId?: string | number
    clientMessageId?: string
    checkCode?: string | number
    checkMessage?: string
  } | undefined

  const rawCheckCode = Number(sendBody?.checkCode ?? 0)
  let checkCode = rawCheckCode > 0 ? rawCheckCode : undefined
  let checkTips = ''
  if (sendBody?.checkMessage) {
    try {
      const check = JSON.parse(sendBody.checkMessage) as { status_code?: number; tips?: string }
      if (Number(check.status_code) > 0) checkCode = Number(check.status_code)
      checkTips = String(check.tips ?? '')
    } catch { /* 非 JSON 保持原值 */ }
  }

  const sendStatus = Number(sendBody?.status ?? 0)
  const serverMessageId = sendBody?.serverMessageId != null ? String(sendBody.serverMessageId) : undefined
  const envelopeMsg = String(decoded['errorDesc'] ?? '')
  const delivered = statusCode === 0 && sendStatus === 0 && !!serverMessageId && serverMessageId !== '0'
  if (!delivered) {
    return {
      statusCode: statusCode || sendStatus || -1,
      statusMsg: checkTips || envelopeMsg || 'send rejected',
      clientMessageId,
      ...(checkCode !== undefined ? { checkCode } : {}),
    }
  }
  return {
    statusCode: 0,
    statusMsg: envelopeMsg,
    serverMessageId,
    clientMessageId: sendBody?.clientMessageId ?? clientMessageId,
    ...(checkCode !== undefined ? { checkCode } : {}),
  }
}
