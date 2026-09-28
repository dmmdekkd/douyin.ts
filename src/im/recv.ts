import { decodeWire, decodeWireTree, type WireField } from './protocol/index.js'
import { fieldString, collectKeyValues } from './notice.js'
import { parseBody } from './content.js'
import type { GroupMemberChange, GroupMemberUpdate, InboundMessage, NoticeEvent, PushMessage, ReadEvent, StatusEvent, StatusExtItem, VoipCallEvent } from './types.js'

/** 解析推送 content JSON；非法返回 undefined（服务端偶发非 JSON 变体）；protectBigInt 保 16+ 位数字精度（uid/msgId） */
function parseContent (text: string, protectBigInt = false): Record<string, unknown> | undefined {
  try {
    return JSON.parse(
      protectBigInt ? text.replace(/"(\w+)"\s*:\s*(\d{16,})/g, '"$1":"$2"') : text,
    ) as Record<string, unknown>
  } catch {
    return undefined
  }
}
const str = (value: unknown): string => (value == null ? '' : String(value))
const num = (value: unknown): number => (value == null ? 0 : Number(value))

/** 原始推送 → 业务入站消息（平铺消息体：type 判别 + text 展示文本） */
export function toInboundMessage (push: PushMessage): InboundMessage {
  // raw 以 push 原样为准（parseBody 的 raw 仅兜底，交集后 PushMessage.raw 必为对象）
  return {
    ...parseBody(push.content, push.messageType),
    ...push,
  }
}

/* ---------------------------------------------------------------------------
 * Android Frontier 无 schema 消息提取（对齐 douyin-im android-ws.ts collectMessages）
 * 群聊（纯数字 conversationId）与私聊（0:1:xxx:xxx）均走此路径。
 * ------------------------------------------------------------------------- */

/** content 恒为空、信息全在 ext 的命令帧类型（50005 会话删除/群解散，实证帧 content 为空） */
const BODYLESS_COMMAND_TYPES = new Set([50005])

interface MessageContext {
  cmd?: number
  inboxType?: number
  conversationId?: string
  senderUid?: string
  senderSecUid?: string
  conversationShortId?: string
  serverMessageId?: string
  /** 盖楼层 id（serverMessageId:clientMessageId:convShortId） */
  threadId?: string
  /** 盖楼短 id */
  threadShortId?: string
  /** 盖楼根消息（messageType=50002、正文为空） */
  isThreadRoot?: boolean
  /** 消息编辑次数（ext s:edit_count） */
  editCount?: number
  /** 编辑元数据（ext s:edit_info） */
  editInfo?: { contentIsEdited: boolean; editorUid: string; editTime: string }
  /** 编辑前原始消息类型（ext s:org_msg_type） */
  orgMsgType?: number
  indexInConversation?: string
  indexInConversationV2?: string
  createTime?: string
  reference?: NonNullable<PushMessage['reference']>
}

/**
 * 无 schema 提取嵌套引用信息（对齐实际帧形态）：
 * field 1 = referencedMessageId（int64 → varint），field 2 = hint JSON（含 refmsg_type/refmsg_uid 等键），
 * field 3 = refmsg_type（公告/系统消息等无本地上下文），field 8/9 = 被引消息索引。
 * 引用的是无上下文消息（如群公告 refmsg_type=1004）时只透出 replyid，不编造 rootMessageId。
 */
function extractReference (fields: WireField[]): NonNullable<PushMessage['reference']> | undefined {
  for (const field of fields) {
    if (field.type !== 'message') continue
    const hint = field.value.find(item =>
      item.type === 'string' && item.value.includes('refmsg_type'),
    )?.value as string | undefined
    if (!hint) continue
    const refId = field.value.find(item => item.type === 'varint' && item.field === 1)?.value as bigint | undefined
    if (refId === undefined) continue
    return { referencedMessageId: refId.toString(), hint }
  }
  return undefined
}

function collectMessages (
  fields: WireField[],
  output: PushMessage[],
  rawTree: unknown,
  inherited: MessageContext = {},
): void {
  const strings = fields
    .filter((item): item is Extract<WireField, { type: 'string' }> => item.type === 'string')
    .map((item) => ({ field: item.field, value: item.value }))
  const context: MessageContext = { ...inherited }
  const envelopeCmd = fieldString(fields, 1)
  const envelopeInboxType = fieldString(fields, 5)
  if (envelopeCmd && envelopeInboxType && (envelopeInboxType === '0' || envelopeInboxType === '1')) {
    context.cmd = Number(envelopeCmd)
    context.inboxType = Number(envelopeInboxType)
  }
  const conversationId = strings.find(({ value }) => /^0:1:\d+:\d+$/.test(value))?.value ??
    strings.find(({ field, value }) => field === 1 && /^\d+$/.test(value))?.value
  if (conversationId) context.conversationId = conversationId
  const signalHead = fieldString(fields, 7)
  // 信令回执类帧（cmd=504 同步，50001/50013 等）布局异于普通推送：f7 为 5 位信令号、发送者在 f22
  //（普通推送 f7 是 15 位+ 的 sender uid，按位数区分防误判）
  const signalLayout = !!signalHead && /^\d{5}$/.test(signalHead)
  const senderUid = fieldString(fields, signalLayout ? 22 : 7)
  // 抖音 uid 至少 15 位数字；短数字（如回显帧中的 50013）是其他字段，不能当 sender
  if (senderUid && senderUid.length >= 15 && /^\d+$/.test(senderUid)) context.senderUid = senderUid
  const senderSecUid = fieldString(fields, 14)
  if (senderSecUid?.startsWith('MS4')) context.senderSecUid = senderSecUid
  // 盖楼检测：楼内回复帧正文 f1 直接为 thread_id，楼根藏在其 ext 的 s:add_ext。
  // 中间段是含连字符的 uuid，据此区分私聊会话 0:1:uid:uid（无连字符）。
  const directThreadId = strings.find(({ value }) => /^\d+:[0-9a-fA-F-]+-[0-9a-fA-F]+:\d+$/.test(value))?.value
  const threadExt = collectKeyValues(fields, 9)
  const addExt = parseContent(threadExt.get('s:add_ext') ?? '')
  const addThreadId = str(addExt?.['a:thread_id'])
  if (directThreadId) context.threadId = directThreadId
  if (addThreadId) context.threadId = addThreadId
  // 编辑元数据：编辑重推仍是普通消息帧，靠 ext 标记识别（s:edit_info 含 19 位 uid，需保精度解析）
  const editRaw = parseContent(threadExt.get('s:edit_info') ?? '', true)
  const editCount = threadExt.get('s:edit_count')
  if (editRaw?.['content_is_edited'] === true || (editCount && Number(editCount) > 0)) {
    context.editCount = editCount ? Number(editCount) : 1
    context.editInfo = {
      contentIsEdited: editRaw?.['content_is_edited'] === true,
      editorUid: str(editRaw?.['content_editor']),
      editTime: str(editRaw?.['content_edit_time']),
    }
    const orgType = threadExt.get('s:org_msg_type')
    if (orgType && /^\d+$/.test(orgType)) context.orgMsgType = Number(orgType)
  }
  const shortId = fieldString(fields, 5)
  if (!directThreadId && (conversationId || senderUid) && shortId && /^\d+$/.test(shortId)) {
    context.conversationShortId = shortId
  }
  if (context.threadId) {
    // f5 在楼内回复帧即 threadShortId；add_ext 数值可信度最高（楼根）；楼根自身 id 在 s:server_message_id
    const extServerId = threadExt.get('s:server_message_id')
    context.threadShortId = str(addExt?.['a:thread_short_id']) ||
      (directThreadId && shortId && /^\d+$/.test(shortId) ? shortId : undefined)
    context.isThreadRoot = addExt?.['a:is_thread_root_msg'] === '1'
    if (extServerId && /^\d+$/.test(extServerId)) context.serverMessageId = extServerId
    // 会话槽位被 thread_id 占用，末段即群会话短 id，据此还原会话标识
    if (!conversationId) {
      const tail = context.threadId.split(':')[2]
      if (tail && /^\d+$/.test(tail)) {
        context.conversationId = tail
        context.conversationShortId = context.conversationShortId ?? tail
      }
    }
  }
  const serverMessageId = fieldString(fields, 3)
  if ((conversationId || senderUid) && serverMessageId && /^\d+$/.test(serverMessageId)) context.serverMessageId = serverMessageId
  // 编辑重推的 f3 是推送载体 id，每次编辑都变；原消息 id 在 ext s:server_message_id，回填保证事件可关联原消息
  const editServerId = threadExt.get('s:server_message_id')
  if (context.editCount != null && editServerId && /^\d+$/.test(editServerId)) context.serverMessageId = editServerId
  const indexInConversation = fieldString(fields, 4)
  if ((conversationId || senderUid) && indexInConversation) context.indexInConversation = indexInConversation
  const indexInConversationV2 = fieldString(fields, 17)
  if ((conversationId || senderUid) && indexInConversationV2) context.indexInConversationV2 = indexInConversationV2
  const createTime = fieldString(fields, 10)
  if ((conversationId || senderUid) && createTime) context.createTime = createTime
  const reference = extractReference(fields)
  if ((conversationId || senderUid) && reference) context.reference = reference
  const contentField = fields.find((item): item is Extract<WireField, { type: 'string' }> =>
    item.type === 'string' && (item.field === 8 || item.field === 6) && item.value.trimStart().startsWith('{'),
  )
  const content = contentField?.value ?? ''
  // 无正文命令帧：content 为空、信息全在 ext（如 50005 会话删除/群解散），不放行则事件没有任何出口
  const bodylessCommand = !contentField && threadExt.size > 0 &&
    BODYLESS_COMMAND_TYPES.has(Number(fieldString(fields, 6) ?? 7))
  if (context.conversationId && context.senderUid && (contentField || context.isThreadRoot || bodylessCommand)) {
    output.push({
      cmd: context.cmd ?? 500,
      ...(context.inboxType !== undefined ? { inboxType: context.inboxType } : {}),
      conversationId: context.conversationId,
      conversationShortId: context.conversationShortId ?? '',
      conversationType: /^\d+$/.test(context.conversationId) ? 2 : 1,
      senderUid: context.senderUid,
      ...(context.senderSecUid ? { senderSecUid: context.senderSecUid } : {}),
      content,
      messageType: signalLayout ? Number(signalHead) : Number(fieldString(fields, 6) ?? 7),
      ...(context.serverMessageId ? { serverMessageId: context.serverMessageId } : {}),
      ...(context.indexInConversation ? { indexInConversation: context.indexInConversation } : {}),
      ...(context.indexInConversationV2 ? { indexInConversationV2: context.indexInConversationV2 } : {}),
      ...(context.createTime ? { createTime: context.createTime } : {}),
      ...(context.reference ? { reference: context.reference } : {}),
      ...(context.threadId ? { threadId: context.threadId } : {}),
      ...(context.threadShortId ? { threadShortId: context.threadShortId } : {}),
      ...(context.isThreadRoot ? { isThreadRoot: context.isThreadRoot } : {}),
      ...(context.editCount != null ? { editCount: context.editCount } : {}),
      ...(context.editInfo ? { editInfo: context.editInfo } : {}),
      ...(context.orgMsgType != null ? { orgMsgType: context.orgMsgType } : {}),
      // ext 全文透出：撤回（s:target_server_message_id/s:recall_uid）等命令信息只在 f:9，content 常为空
      ...(threadExt.size > 0 ? { ext: Object.fromEntries(threadExt) } : {}),
      raw: { transport: 'android-frontier', content, wireTree: rawTree },
    })
  }
  for (const field of fields) {
    if (field.type === 'message') collectMessages(field.value, output, rawTree, context)
  }
}

/** Android Frontier payload 的无 schema 消息提取 */
export function extractAndroidPushes (payload: Uint8Array): PushMessage[] {
  const output: PushMessage[] = []
  const fields = decodeWire(payload)
  const tree = decodeWireTree(payload)
  collectMessages(fields, output, tree)
  const unique = new Map<string, PushMessage>()
  for (const message of output) {
    unique.set(`${message.serverMessageId ?? ''}|${message.conversationId}|${message.senderUid}|${message.content}`, message)
  }
  return [...unique.values()]
}

/** messageType=50018 来电推送 → voip 事件；content 无 call_info（异常/非来电变体）返回 undefined */
export function toVoipCall (push: PushMessage): VoipCallEvent | undefined {
  const parsed = parseContent(push.content)
  if (!parsed) return undefined
  const call = parsed.call_info as Record<string, unknown> | undefined
  if (!call) return undefined
  return {
    type: 'voip.call',
    conversationId: push.conversationId,
    conversationType: push.conversationType,
    callerUid: push.senderUid,
    callId: str(call.call_id),
    roomId: str(call.room_id),
    voipType: num(call.voip_type),
    callType: num(call.call_type),
    cameraOff: num(call.camera_off),
    callInfo: call,
  }
}

/** messageType=50013 单聊已读回执 → read 事件；content 无 P2PSender（异常变体）返回 undefined */
export function toReadEvent (push: PushMessage): ReadEvent | undefined {
  const info = parseContent(push.content)
  if (!info) return undefined
  const readerUid = info.P2PSender
  if (readerUid == null) return undefined
  return {
    type: 'read',
    conversationId: push.conversationId,
    readerUid: str(readerUid),
    conShortId: str(info.ConShortId),
    messageId: str(info.MessageId),
    readIndex: str(info.P2PSenderReadIndex),
  }
}

/** messageType=50001 会话状态变更 → status 事件；content 无 conversation_id（异常变体）返回 undefined */
export function toStatusEvent (push: PushMessage): StatusEvent | undefined {
  // protectBigInt：群成员/群主 uid 为 16+ 位，默认 JSON.parse 丢精度（raw 内数字均带引号保真）
  const info = parseContent(push.content, true)
  if (!info) return undefined
  const conversationId = info.conversation_id
  if (conversationId == null) return undefined
  const extData = Array.isArray(info.ext_data) ? statusExt(info.ext_data) : undefined
  const memberDiff = num(info.command_type) === 7 ? memberChange(info) : undefined
  return {
    type: 'status',
    conversationId: str(conversationId),
    conversationType: num(info.conversation_type),
    commandType: num(info.command_type),
    ...(info.read_badge_count != null ? { unread: num(info.read_badge_count) } : {}),
    readIndex: str(info.read_index),
    ...(push.serverMessageId ? { messageId: push.serverMessageId } : {}),
    // command_type=6 会话属性变更帧：按 ext_data 键判定群名/群头像变更，取本帧全量下发的新值；=7 群成员变更帧：按增删/角色/群主/群昵称变更解析
    ...(num(info.command_type) === 6 ? convChange(info, extData) : {}),
    ...(memberDiff ? { memberChange: memberDiff } : {}),
    ...(extData ? { extData } : {}),
    raw: info,
  }
}

/** command_type=6 帧 → 群名/群头像变更；改名帧也带头像键，按 ext_data 变更键优先定夺，故改名判定在头像之前 */
function convChange (info: Record<string, unknown>, extData?: StatusExtItem[]): Partial<StatusEvent> {
  const hit = (key: string): StatusExtItem | undefined => extData?.find(item => item.key === key)
  // 改名：a:s_name_operator 值记操作者；a:group_name_lifecycle 须为 name_change（建群/头像帧也带 lifecycle 但 event=group_create）
  const nameOp = hit('a:s_name_operator')
  const lifecycle = hit('a:group_name_lifecycle')
  if (nameOp || (lifecycle && lifecycle.value.includes('name_change'))) {
    return { nameChange: { name: str(info.conversation_name), operatorUid: nameOp ? nameOp.value : '' } }
  }
  // 改头像：a:group_avatar_user_set / s_user_set_avatar 值记操作者；a:ab_avatar 值即新头像（无签名），conversation_icon 带签名为准
  const avatarOp = hit('a:group_avatar_user_set') ?? hit('s_user_set_avatar')
  const avatarUrl = hit('a:ab_avatar')
  if (avatarOp || avatarUrl) {
    return { avatarChange: { icon: str(info.conversation_icon) || (avatarUrl ? avatarUrl.value : ''), operatorUid: avatarOp ? avatarOp.value : '' } }
  }
  return {}
}

/** command_type=7 帧 → 群成员变更（增删成员/角色/群主/群昵称变更）；无任何变化返回 undefined */
function memberChange (info: Record<string, unknown>): GroupMemberChange | undefined {
  const updated = (Array.isArray(info.updated_participant_info) ? info.updated_participant_info : [])
    .map((item): GroupMemberUpdate => {
      const it = item as Record<string, unknown>
      return {
        uid: str(it.user_id),
        role: num(it.role),
        ...(it.sec_uid ? { secUid: str(it.sec_uid) } : {}),
        // alias 下发即变更（含空串=昵称被清空），未下发才是「未涉及昵称」，故不做真值判断
        ...(typeof it.alias === 'string' ? { alias: it.alias } : {}),
      }
    })
    .filter(u => u.uid !== '')
  const added = stringArray(info.added_participant)
  const removed = stringArray(info.removed_participant)
  if (added.length === 0 && removed.length === 0 && updated.length === 0) return undefined
  // 群主变更只有 new_owner_id 非 0 才算：普通帧的 old_owner_id 是现任群主（恒有值），
  // 单看它会误判成「群主移交」，故 old/new 必须成对透出
  const oldOwnerId = str(info.old_owner_id)
  const newOwnerId = str(info.new_owner_id)
  const transfer = newOwnerId !== '' && newOwnerId !== '0'
  return {
    added,
    removed,
    updated,
    ...(transfer && oldOwnerId !== '' && oldOwnerId !== '0' ? { oldOwnerId } : {}),
    ...(transfer ? { newOwnerId } : {}),
  }
}

function stringArray (value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(v => (v == null ? '' : String(v))).filter(v => v !== '')
    : []
}

/** content.ext_data → 会话属性变更项（key/value/version/op_type） */
function statusExt (items: unknown[]): StatusExtItem[] {
  return items.map((item) => {
    const it = item as Record<string, unknown>
    return {
      key: str(it.key),
      value: str(it.value),
      version: num(it.version),
      opType: num(it.op_type),
    }
  })
}

/** varint 字段值（bigint → string） */
function fieldVarint (fields: WireField[], field: number): string | undefined {
  const hit = fields.find(item => item.type === 'varint' && item.field === field)?.value as bigint | undefined
  return hit?.toString()
}

/**
 * cmd=500 field=500 property 推送 → 消息表情回应（ModifyPropertyBody 同构下发）：
 * f1=conversation_id, f2=conversation_type, f3=conversation_short_id, f4=server_message_id,
 * f5=client_message_id, f6=repeated ModifyPropertyContent{operation=1,key=2,value=3,idempotent_id=4}
 */
export function extractReactions (payload: Uint8Array): NoticeEvent[] {
  const events: NoticeEvent[] = []
  const visit = (fields: WireField[]): void => {
    for (const item of fields) {
      if (item.type === 'message') visit(item.value)
      if (item.type !== 'message' || item.field !== 500) continue
      for (const body of item.value.filter(inner => inner.type === 'message' && inner.field === 5)) {
        const list = body.value as Extract<WireField, { type: 'message' }>['value']
        const conversationId = list.find(inner => inner.type === 'string' && inner.field === 1)?.value as string | undefined
        // serverMessageId 为 19 位 int64；短于 18 位的是 shortId 之类字段
        const bigId = (field: number): string | undefined => {
          const value = fieldVarint(list, field)
          return value && value.length >= 18 ? value : undefined
        }
        const serverMessageId = bigId(4) ?? bigId(3)
        if (!conversationId || !serverMessageId) continue
        for (const content of list.filter(inner => inner.type === 'message' && inner.field === 6)) {
          const inner = (content as Extract<WireField, { type: 'message' }>).value as WireField[]
          const operation = Number(fieldVarint(inner, 1) ?? '0')
          const rawKey = inner.find(el => el.type === 'string' && el.field === 2)?.value as string | undefined
          const operatorUid = inner.find(el => el.type === 'string' && el.field === 4)?.value as string | undefined
          // 表态 key 形如 se:[爱心]；容忍其他前缀
          if (!rawKey || !rawKey.includes(':')) continue
          events.push({
            type: 'message.reaction',
            conversationId,
            serverMessageId,
            emoji: rawKey.replace(/^se:/, ''),
            operatorUid: operatorUid ?? '',
            isSet: operation === 0,
            raw: {},
          })
        }
      }
    }
  }
  visit(decodeWire(payload))
  return events
}
