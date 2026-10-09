import type { SendMessageReference, RecvBody, ForwardNode, ShareItem, Card } from './types.js'
import type { ImageFormat, ImageResource, VideoResource, UserCard, ImageAsset, FileAsset, LocationCard, GroupCard } from './media.js'

/** 文本 @ 提及（richTextInfos 元数据；收侧无昵称，text 为发侧可选） */
export interface TextMention {
  uid: string
  /** 会话 id（官方 info.con_id，@ 归属会话） */
  conId?: string
  text?: string
  location: number
  length: number
}

/** 引用元数据：从被引用消息提取，任意消息类型均可引用，refmsg_type 原样透传 */
export interface ReferenceMeta {
  referencedMessageId: string
  referencedMessageType: number
  referencedUid: string
  referencedSecUid?: string
  nickname?: string
  referencedText?: string
  rootMessageId?: string
  rootMessageConvIndex?: string
}

export interface ReplyMessageOptions extends ReferenceMeta {
  text: string
}

export interface ReplyPayload {
  content: string
  reference: SendMessageReference
}

/** messageType=1 文本 content（HTTP SDK 可投递） */
export function buildLegacyTextContent (text: string): string {
  return JSON.stringify({ text })
}

/** 创作者 Web 文本消息 content（messageType=7，HTTP 路径 aweType=774） */
export function buildCreatorTextContent (text: string): string {
  return JSON.stringify({ text, aweType: 774 })
}

/** Desktop IM 文本 content；字段和值与 jumpbyte 的成功 HAR 保持一致。 */
export function buildDesktopTextContent (text: string, mentions: TextMention[] = []): string {
  return JSON.stringify({
    aweType: 700,
    type: 0,
    instruction_type: 0,
    item_type_local: -1,
    richTextInfos: mentions.map(mention => ({
      infoType: 1,
      location: mention.location,
      length: mention.length,
      info: {
        uid: mention.uid,
        ...(mention.conId ? { con_id: mention.conId } : {}),
      },
    })),
    text,
    createdAt: 0,
    is_card: false,
    msgHint: '',
  })
}

/**
 * Desktop IM 文本 + @所有人 content：占位「@所有人 」从开头插入（length=5、location=0）。
 * richTextInfos 镜像收侧实测样本（infoType=4 mention_label 标记 + infoType=2 加粗），
 * font_weight 为数字（对齐 HAR 权威样本）——发侧 @all 判定另靠 ext s:mentioned_users="0"。
 */
export function buildAtAllTextContent (text: string): string {
  const label = '@所有人 '
  return JSON.stringify({
    aweType: 700,
    type: 0,
    instruction_type: 0,
    item_type_local: -1,
    richTextInfos: [
      { info: { mention_label: '1' }, infoType: 4, length: label.length, location: 0 },
      { info: { font_weight: 2 }, infoType: 2, length: label.length, location: 0 },
    ],
    text: label + text,
    createdAt: 0,
    is_card: false,
    msgHint: '',
  })
}

export function buildImageContent (image: {
  oid: string
  skey: string
  md5: string
  dataSize: number
  width: number
  height: number
  format?: ImageFormat
}): string {
  return JSON.stringify({
    resource_url: {
      oid: image.oid,
      skey: image.skey,
      data_size: image.dataSize,
      md5: image.md5,
    },
    cover_height: image.height,
    cover_width: image.width,
    check_pics: [],
    md5: image.md5,
    from_gallery: 1,
    aweType: image.format === 'gif' ? 2703 : 2702,
  })
}

/** 文件消息 content（messageType=6，aweType=15001，字段与官方接收样例同形） */
export function buildFileContent (file: FileAsset): string {
  return JSON.stringify({
    aweType: 15001,
    uri: file.uri,
    skey: file.skey,
    md5: file.md5,
    name: file.name,
    data_size: file.dataSize,
    format: file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '',
    createdAt: 0,
    is_card: false,
    msgHint: '',
  })
}

export function buildVideoContent (video: {
  tkey: string
  skey: string
  md5: string
  poster?: ImageAsset
  width?: number
  height?: number
  checkPics?: string[]
}): string {
  return JSON.stringify({
    video: { tkey: video.tkey, md5: video.md5, skey: video.skey },
    ...(video.poster ? { poster: { oid: video.poster.oid, md5: video.poster.md5, skey: video.poster.skey } } : {}),
    ...(video.width !== undefined ? { width: video.width } : {}),
    ...(video.height !== undefined ? { height: video.height } : {}),
    check_pics: video.checkPics ?? [],
  })
}

/** 作品分享卡片 content（messageType=8 / aweType=800，结构对齐 Android 分享帧），share_id 首段为自己的 uid */
export function buildShareContent (item: ShareItem, senderUid: string): string {
  const image = (uri: string): object => ({
    data_size: 0,
    height: 720,
    uri,
    url_list: [uri],
    width: 540,
  })
  return JSON.stringify({
    aweType: 800,
    awemeType: 0,
    content_name: item.authorName ?? '',
    content_title: item.title ?? item.itemId,
    ...(item.coverUrl
      ? { cover_height: 1440, cover_url: image(item.coverUrl), cover_width: 2560 }
      : {}),
    createdAt: 0,
    is_aigc: false,
    is_card: false,
    is_hot_spot_video: false,
    is_story: false,
    itemId: item.itemId,
    item_mask_status: 0,
    msgHint: '',
    need_skip_strange: 0,
    scene_type: 0,
    ...(item.secUid ? { secUID: item.secUid } : {}),
    share_id: `${senderUid}_${Date.now()}_${item.itemId}`,
    share_with_timestamp: -1,
    uid: item.uid,
  })
}

/** 用户名片卡片 content（messageType=25 / aweType=0，结构对齐 Android 名片帧）；uid 与 secUid 须真实，服务端可能据 uid 重建 */
export function buildUserCardContent (item: UserCard): string {
  return JSON.stringify({
    ...(item.avatarUrl
      ? { avatar: { data_size: 0, height: 0, uri: item.avatarUrl, url_list: [item.avatarUrl], width: 0 } }
      : {}),
    aweType: 0,
    createdAt: 0,
    ...(item.coverItems?.length ? { cover_items: item.coverItems } : {}),
    ...(item.coverUrls?.length
      ? { cover_url: item.coverUrls.map(url => ({ data_size: 0, height: 0, uri: '', url_list: [url], width: 0 })) }
      : {}),
    ...(item.desc ? { desc: item.desc } : {}),
    ...(item.followerCount ? { follower_count: item.followerCount } : {}),
    is_card: false,
    is_secret: false,
    msgHint: '',
    name: item.name ?? '',
    push_detail: item.name ?? '',
    ...(item.secUid ? { secUID: item.secUid } : {}),
    source: 'private_chat',
    uid: item.uid,
  })
}

/** 构造互动卡 content（messageType=110）：description/push_detail 即展示文本，patch 原样回填，aweType 还原接收值 */
export function buildCardContent (card: Card, title: string): string {
  return JSON.stringify({
    aweType: card.aweType || 110402,
    im_dynamic_patch: card.patch,
    description: title,
    push_detail: title,
  })
}

/** 构造表情消息 content（messageType=5 / lite_emoji）：字段与官方发送样本逐一同形（含 aweType:507、url.width:0）；url 必须传 im-resource 域直链，tos-cn 表态域会被服务端注入 s:visible 导致仅自身可见 */
export function buildEmojiContent (url: string, displayName = '[表情]'): string {
  return JSON.stringify({
    display_name: displayName,
    height: 100,
    width: 100,
    image_id: 0,
    image_type: 'png',
    package_id: 0,
    show_notice: false,
    resource_type: 4,
    updateConversationTime: true,
    url: { height: 0, data_size: 0, uri: url, url_list: [url], width: 0 },
    createdAt: 0,
    is_card: false,
    msgHint: '',
    aweType: 507,
  })
}

/** 构造位置消息 content（messageType=502 POI 定位）：字段与官方接收样例同形，封面用 cover_info.resource_url */
export function buildLocationContent (location: LocationCard): string {
  return JSON.stringify({
    aweType: 0,
    ...(location.awemePoiId ? { aweme_poi_id: location.awemePoiId } : {}),
    cover_info: {
      resource_url: {
        data_size: 0,
        height: 0,
        uri: location.uri ?? '',
        url_list: location.urlList ?? [],
        width: 0,
      },
    },
    createdAt: 0,
    is_card: false,
    latitude: location.latitude,
    longitude: location.longitude,
    msgHint: '',
    poi_address: location.address,
    ...(location.poiId ? { poi_id: location.poiId } : {}),
    poi_name: location.name,
  })
}

/** 构造群聊邀请卡 content（messageType=58 / aweme_invite_card）；from_uid 缺省以发送者身份填充，title/desc 参照官方文案 */
export function buildGroupCardContent (card: GroupCard, senderUid: string): string {
  const name = card.groupName
  const inviter = card.fromNickname ?? card.fromUid ?? senderUid
  return JSON.stringify({
    aweme_invite_card: {
      scene: 0,
      card_type: 1,
      ...(card.iconUrl ? { group_icon: { url_list: [card.iconUrl] } } : {}),
      group_name: name,
      ...(card.memberCount !== undefined ? { group_member_count: card.memberCount } : {}),
      conversation_id: card.conversationId,
      conversation_short_id: card.conversationId,
      ...(card.ownerNickname ? { group_owner_nickname: card.ownerNickname } : {}),
      from_uid: card.fromUid ?? senderUid,
      ...(card.fromSecUid ? { sec_from_uid: card.fromSecUid } : {}),
      group_create_type: '0',
      need_cut_icon: 1,
      ...(card.ownerUid ? { group_owner_uid: card.ownerUid } : {}),
      ...(card.ownerSecUid ? { sec_group_owner_uid: card.ownerSecUid } : {}),
      source: 0,
      // ticket 服务端校验通过才派发；缺省(未填)仍按收卡回传形态提交
      ...(card.ticket ? { ticket: card.ticket } : {}),
    },
    title: `邀请你加入「${name}」`,
    desc: `${inviter} 邀请你加入「${name}」群聊，快来看下吧。`,
    type_desc: `${name}群聊`,
    push_detail: `邀请你加入${name}`,
  })
}

/** 构造引用元数据（refMsgInfo）：任意消息类型均可引用，hint 承载被引用消息类型与摘要 */
export function buildReference (meta: ReferenceMeta): SendMessageReference {
  const reference: SendMessageReference = {
    referencedMessageId: meta.referencedMessageId,
    hint: JSON.stringify({
      refmsg_type: meta.referencedMessageType,
      content: meta.referencedText ?? '',
      refmsg_uid: meta.referencedUid,
      refmsg_sec_uid: meta.referencedSecUid ?? '',
      nickname: meta.nickname ?? '',
      refmsg_content: '',
      version: 0,
      itemId: '',
      scene_type: 0,
    }),
  }
  if (meta.rootMessageId) reference.rootMessageId = meta.rootMessageId
  if (meta.rootMessageConvIndex) reference.rootMessageConvIndex = meta.rootMessageConvIndex
  return reference
}

export function buildReplyPayload (options: ReplyMessageOptions): ReplyPayload {
  const { text, ...meta } = options
  return { content: buildDesktopTextContent(text), reference: buildReference(meta) }
}

/* ---------------------------------------------------------------------------
 * 入站内容解析
 * ------------------------------------------------------------------------- */

function objectValue (value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringArray (value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function imageFromObject (value: Record<string, unknown>): ImageResource | undefined {
  const resource = objectValue(value['resource_url']) ?? value
  const oid = String(resource['oid'] ?? resource['uri'] ?? '')
  const skey = String(resource['skey'] ?? '')
  const urls = (name: string): string[] => stringArray(resource[name] ?? value[name])
  if (!oid && !skey && !['origin_url_list', 'large_url_list', 'medium_url_list', 'thumb_url_list'].some((name) => urls(name).some(Boolean))) return undefined
  return {
    oid,
    skey,
    md5: String(resource['md5'] ?? value['md5'] ?? ''),
    dataSize: Number(resource['data_size'] ?? value['data_size'] ?? 0),
    width: Number(value['cover_width'] ?? resource['width'] ?? 0),
    height: Number(value['cover_height'] ?? resource['height'] ?? 0),
    originUrls: urls('origin_url_list'),
    largeUrls: urls('large_url_list'),
    mediumUrls: urls('medium_url_list'),
    thumbUrls: urls('thumb_url_list'),
  }
}

/** 收侧 @ 提及：解析 richTextInfos，仅 infoType=1（@ 人）计入，位置/长度用于从原 text 剥离 */
function mentionsFromValue (value: Record<string, unknown>): TextMention[] | undefined {
  const infos = value['richTextInfos']
  if (!Array.isArray(infos) || infos.length === 0) return undefined
  const mentions = infos
    .map(item => {
      const record = objectValue(item)
      if (!record || Number(record['infoType']) !== 1) return undefined
      const info = objectValue(record['info'])
      return {
        uid: String(info?.['uid'] ?? ''),
        location: Number(record['location'] ?? 0),
        length: Number(record['length'] ?? 0),
      }
    })
    .filter((m): m is TextMention => m !== undefined && m.uid !== '')
  return mentions.length ? mentions : undefined
}

/** 按 mentions 的 location/length 从原文本剥离 @ 片段；从后往前裁避免偏移 */
function stripMentions (text: string, mentions: TextMention[]): string {
  const parts = [...mentions].sort((a, b) => b.location - a.location)
  let rest = text
  for (const m of parts) {
    if (m.location < 0 || m.location + m.length > rest.length) continue
    rest = rest.slice(0, m.location) + rest.slice(m.location + m.length)
  }
  return rest
}

/** 系统消息占位用户（active_users/passive_users）：取昵称，缺昵称回退 uid */
function placeholderUsers (value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const record = objectValue(item)
    const name = String(record?.['nickname'] ?? record?.['nick_name'] ?? record?.['uid'] ?? '')
    if (name) names.push(name)
  }
  return names
}

/**
 * 群系统消息文案（messageType=1001，成员进出/群资料变更等）：服务端只下发模板，
 * 正文在 locale_resources（zh 优先）、回退 template，{0}/{1} 占位按 active_users→passive_users 顺序填昵称
 */
function systemMessageText (value: Record<string, unknown>): string {
  const resources = (Array.isArray(value['locale_resources']) ? value['locale_resources'] : [])
    .map(objectValue)
    .filter((item): item is Record<string, unknown> => item !== undefined)
  const localized = (resources.find(item => String(item['lang'] ?? '').startsWith('zh')) ?? resources[0])?.['text']
  const template = typeof localized === 'string' && localized
    ? localized
    : typeof value['template'] === 'string' ? value['template'] : ''
  if (!template) return ''
  const users = [...placeholderUsers(value['active_users']), ...placeholderUsers(value['passive_users'])]
  return template.replace(/\{(\d+)\}/g, (slot, index: string) => users[Number(index)] ?? slot)
}

/**
 * 解析 wire content 为收侧消息体（RecvBody）：type 判别 + 载荷字段平铺，媒体恒为资产/资源形态。
 * text 为可读展示文本（媒体字段无文案时保持原值，不再内填「[视频]」等占位，
 * 拼接展示交由外部按 type 处理，避免外部再追加时重复）；@ 提及并入 text 的 ats（纯 @ 消息 text 保留原文）。
 */
export function parseBody (content: string, messageType?: number): RecvBody {
  let value: Record<string, unknown>
  try {
    // JSON.parse 前把 16+ 位整数包成字符串：uid/msg_id 等 19 位大整数超出 Number 精度，直接 parse 会丢尾数
    const decoded: unknown = JSON.parse(content.replace(/"(\w+)"\s*:\s*(\d{16,})/g, '"$1":"$2"'))
    if (!objectValue(decoded)) return { type: 'unknown', text: content, raw: content }
    value = decoded as Record<string, unknown>
  } catch {
    return { type: 'text', text: content }
  }
  const aweType = Number(value['aweType'] ?? value['awe_type'] ?? 0)
  const text = String(value['text'] ?? value['content'] ?? value['display_name'] ?? '')
  if (messageType === 17) {
    const resource = objectValue(value['resource_url'])
    return {
      type: 'audio', text,
      audio: { urls: stringArray(resource?.['url_list']), uri: String(resource?.['uri'] ?? '') },
    }
  }
  if (messageType === 6 || messageType === 150) {
    return {
      type: 'file', text: String(value['name'] ?? ''),
      file: { uri: String(value['uri'] ?? ''), skey: String(value['skey'] ?? ''), md5: String(value['md5'] ?? ''), name: String(value['name'] ?? ''), dataSize: Number(value['data_size'] ?? 0) },
    }
  }
  // 通话状态/一起看邀请：hint 即展示文本
  if (messageType === 73 || messageType === 90) {
    return { type: 'text', text: String(value['hint'] ?? '') }
  }
  // 系统引导模板（如开启消息通知）：无内容价值，置空文本由分发层过滤
  if (messageType === 1 && aweType === 133) {
    return { type: 'text', text: '' }
  }
  if (messageType === 26) {
    return {
      type: 'link', text: String(value['title'] ?? ''),
      link: { url: String(value['link_url'] ?? ''), title: String(value['title'] ?? ''), description: String(value['desc'] ?? ''), coverUrl: String(value['cover_url'] ?? '') },
    }
  }
  if (messageType === 25) {
    const coverArr = value['cover_url'] as { url_list?: unknown[] }[] | undefined
    return {
      type: 'userCard', text: String(value['name'] ?? ''),
      user: {
        uid: String(value['uid'] ?? ''),
        secUid: String(value['secUID'] ?? ''),
        name: String(value['name'] ?? ''),
        avatarUrl: stringArray(objectValue(value['avatar'])?.['url_list'])[0] ?? '',
        ...(value['desc'] !== undefined && value['desc'] !== '' ? { desc: String(value['desc']) } : {}),
        ...(value['follower_count'] !== undefined ? { followerCount: String(value['follower_count']) } : {}),
        ...(Array.isArray(value['cover_items']) && value['cover_items'].length ? { coverItems: stringArray(value['cover_items']) } : {}),
        ...(Array.isArray(coverArr) && coverArr.length
          ? { coverUrls: coverArr.map(c => stringArray(c.url_list)?.[0] ?? '').filter(Boolean) }
          : {}),
      },
    }
  }
  if (messageType === 8 || messageType === 77 || (messageType == null && aweType === 800)) {
    const title = String(value['content_title'] ?? '')
    const cover = objectValue(value['cover_url'])
    const coverUrl = cover ? stringArray(cover['url_list'])[0] ?? String(cover['uri'] ?? '') : ''
    return {
      type: 'share', text: text || title,
      share: {
        itemId: String(value['itemId'] ?? ''),
        title,
        uid: String(value['uid'] ?? ''),
        ...(value['secUID'] ? { secUid: String(value['secUID']) } : {}),
        ...(value['content_name'] ? { authorName: String(value['content_name']) } : {}),
        ...(coverUrl ? { coverUrl } : {}),
      },
    }
  }
  if (messageType === 136) {
    const summary = Array.isArray(value['list_content']) ? value['list_content'] : []
    const refs = Array.isArray(value['msg_ids']) ? value['msg_ids'] : []
    const refById = new Map(refs.map(ref => [String(ref?.['msg_id'] ?? ''), ref as Record<string, unknown>]))
    const nodes: ForwardNode[] = []
    for (const item of summary) {
      const msgId = String(item?.['msgid'] ?? '')
      const ref = refById.get(msgId)
      nodes.push({
        uid: String(ref?.['uid'] ?? ''),
        nickname: String(item?.['nick_name'] ?? ''),
        text: String(item?.['text'] ?? ''),
        msgType: Number(ref?.['msg_type'] ?? 0),
        aweType: Number(ref?.['awe_type'] ?? 0),
        msgId,
        ...(ref?.['sec_uid'] ? { secUid: String(ref['sec_uid']) } : {}),
        ...(ref?.['create_time'] ? { createTime: Number(ref['create_time']) } : {}),
      })
    }
    return { type: 'forward', text: '', nodes }
  }
  // 接龙（群内多人接力登记项）：push_detail 即官方展示文本，describe 为标题
  if (messageType === 152) {
    const items = Array.isArray(value['chains_entry_list']) ? value['chains_entry_list'] : []
    return {
      type: 'chains',
      text: String(value['push_detail'] ?? value['chains_description'] ?? ''),
      chains: {
        id: String(value['chains_id'] ?? ''),
        description: String(value['chains_description'] ?? ''),
        isStart: Number(value['is_start_chains']) === 1,
        entries: items.map((item) => {
          const it = item as Record<string, unknown>
          return { uid: String(it['e_c_u'] ?? ''), text: String(it['e_t'] ?? '') }
        }),
      },
    }
  }
  // 互动卡（messageType=110）：im_dynamic_patch 为卡片载荷，raw_data 是双层转义 JSON，
  // description(=push_detail) 即展示文本。引导卡(aweType=110402/msg_guide)与打卡卡
  // (110372/msg_preview) 的 raw_data 布局不同，平铺字段各取首段候选回退
  if (messageType === 110) {
    const patch = objectValue(value['im_dynamic_patch'])
    const raw = typeof patch?.['raw_data'] === 'string'
      ? objectValue(JSON.parse(patch['raw_data']))
      : undefined
    const pick = (...names: string[]): string => {
      for (const name of names) {
        const node = objectValue(raw?.[name])
        const value = node?.['content']
        const hit = Array.isArray(value) ? value[0] : value
        if (typeof hit === 'string' && hit) return hit
      }
      return ''
    }
    // 打卡卡 patch.id 是嵌套 JSON 字符串 {"id":..,"sign":..}，取内层 id；引导卡用 card_id
    let cardId = String(patch?.['card_id'] ?? '')
    if (!cardId && typeof patch?.['id'] === 'string') {
      const nested = objectValue(JSON.parse(patch['id']))
      cardId = String(nested?.['id'] ?? '')
    }
    return {
      type: 'card',
      text: String(value['description'] ?? value['push_detail'] ?? ''),
      card: {
        key: String(patch?.['card_key'] ?? ''),
        type: String(patch?.['card_type'] ?? ''),
        id: cardId,
        aweType: Number(value['aweType'] ?? 0),
        title: pick('content_middle_top', 'content_top'),
        desc: pick('content_middle_content', 'content_middle'),
        button: pick('bottom', 'bottom_right'),
        coverUrl: pick('content_left', 'content_bottom'),
        sign: String(patch?.['sign'] ?? ''),
        patch: patch ?? {},
      },
    }
  }
  // 位置消息（messageType=502，POI 定位）：坐标 + 地点名/地址，封面为 cover_info.resource_url
  if (messageType === 502) {
    const cover = objectValue(objectValue(value['cover_info'])?.['resource_url'])
    return {
      type: 'location',
      text: String(value['poi_name'] ?? value['poi_address'] ?? ''),
      location: {
        name: String(value['poi_name'] ?? ''),
        address: String(value['poi_address'] ?? ''),
        latitude: Number(value['latitude'] ?? 0),
        longitude: Number(value['longitude'] ?? 0),
        poiId: String(value['poi_id'] ?? ''),
        awemePoiId: String(value['aweme_poi_id'] ?? ''),
        uri: String(cover?.['uri'] ?? ''),
        urlList: stringArray(cover?.['url_list']),
      },
    }
  }
  // 群聊邀请卡（messageType=58）：aweme_invite_card 为载荷，title 即展示文本
  if (messageType === 58) {
    const card = objectValue(value['aweme_invite_card'])
    const icon = objectValue(card?.['group_icon'])
    return {
      type: 'groupCard',
      text: String(value['title'] ?? value['push_detail'] ?? ''),
      groupCard: {
        conversationId: String(card?.['conversation_id'] ?? ''),
        groupName: String(card?.['group_name'] ?? ''),
        iconUrl: stringArray(icon?.['url_list'])[0] ?? '',
        ...(card?.['group_member_count'] !== undefined ? { memberCount: Number(card['group_member_count']) } : {}),
        ...(card?.['group_owner_uid'] ? { ownerUid: String(card['group_owner_uid']) } : {}),
        ...(card?.['sec_group_owner_uid'] ? { ownerSecUid: String(card['sec_group_owner_uid']) } : {}),
        ...(card?.['group_owner_nickname'] ? { ownerNickname: String(card['group_owner_nickname']) } : {}),
        fromUid: String(card?.['from_uid'] ?? ''),
        ...(card?.['sec_from_uid'] ? { fromSecUid: String(card['sec_from_uid']) } : {}),
        // 收卡即带凭证，回传时服务端才能校验派发
        ...(card?.['ticket'] ? { ticket: String(card['ticket']) } : {}),
      },
    }
  }
  // 群系统消息（messageType=1001）：文案在 locale_resources/template，渲染出可读文本而非丢给 unknown
  if (messageType === 1001) {
    const system = systemMessageText(value)
    if (system) return { type: 'text', text: system }
  }
  // 明确不支持的 wire 类型不得从通用 resource 字段猜测
  if (messageType != null && ![1, 2, 5, 7, 27, 30].includes(messageType)) {
    return { type: 'unknown', text, raw: value }
  }
  const image = imageFromObject(value)
  if (image) return { type: 'image', text, image }

  const videoValue = objectValue(value['video'])
  if (videoValue) {
    const posterValue = objectValue(value['poster'])
    const poster = posterValue ? imageFromObject(posterValue) : undefined
    const video: VideoResource = {
      tkey: String(videoValue['tkey'] ?? ''),
      skey: String(videoValue['skey'] ?? ''),
      md5: String(videoValue['md5'] ?? ''),
      width: Number(value['width'] ?? 0),
      height: Number(value['height'] ?? 0),
      checkPics: stringArray(value['check_pics']),
      ...(poster ? { poster } : {}),
      ...(value['inline_pic'] ? { inlinePic: String(value['inline_pic']) } : {}),
    }
    return { type: 'video', text, video }
  }

  const emojiUrl = objectValue(value['url'])
  const url = String(emojiUrl?.['uri'] ?? stringArray(emojiUrl?.['url_list'])[0] ?? '')
  if (aweType === 507 || url) return { type: 'emoji', text, emoji: url }
  if (text || 'text' in value) {
    const mentions = mentionsFromValue(value)
    // 有 @ 提及时按原文位置剥离「@xxx 」；纯 @ 消息保留原文（无剥离文本）
    if (!mentions) return { type: 'text', text }
    const stripped = stripMentions(text, mentions)
    const ats = mentions.sort((a, b) => a.location - b.location).map(m => ({ uid: m.uid }))
    return { type: 'text', text: stripped || text, ats }
  }
  return { type: 'unknown', text, raw: value }
}

/**
 * 将简单 `{"text":"..."}` 或纯文本转为 type=7 内容。
 * HTTP 默认 aweType=774；desktop 发送使用 normalizeDesktopTextMessageContent（aweType=700）。
 */
export function normalizeTextMessageContent (content: string, msgType: number): string {
  if (msgType === 1) {
    try {
      const j = JSON.parse(content) as { text?: string }
      if (j.text != null) return content
    } catch {
      return buildLegacyTextContent(content)
    }
    return content
  }
  if (msgType !== 7) return content
  try {
    const j = JSON.parse(content) as { text?: string; aweType?: number; ai_ext?: string }
    if (j.text != null && j.aweType == null && !('ai_ext' in j)) {
      return buildCreatorTextContent(j.text)
    }
    if (j.aweType != null || j.ai_ext != null) return content
  } catch {
    return buildCreatorTextContent(content)
  }
  return content
}

/** 仅将普通文本转换成 Desktop IM 模板，富媒体保持原样。 */
export function normalizeDesktopTextMessageContent (content: string, msgType: number): string {
  if (msgType !== 7) return normalizeTextMessageContent(content, msgType)
  try {
    // JSON.parse("1") 返回数字而非对象，必须显式校验，否则裸数字/布尔文本会原样发出
    const value = JSON.parse(content) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return buildDesktopTextContent(content)
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    const isPlainText =
      typeof record['text'] === 'string' &&
      keys.every((key) => ['text', 'aweType', 'type', 'richTextInfos'].includes(key)) &&
      (!Array.isArray(record['richTextInfos']) || record['richTextInfos'].length === 0)
    return isPlainText ? buildDesktopTextContent(record['text'] as string) : content
  } catch {
    return buildDesktopTextContent(content)
  }
}
