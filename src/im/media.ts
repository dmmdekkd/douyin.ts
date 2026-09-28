import { createCipheriv, createDecipheriv } from 'node:crypto'
import type { MediaInput } from './source.js'

/* ---------------------------------------------------------------------------
 * 富媒体资源
 * ------------------------------------------------------------------------- */

export interface ImageResource {
  oid: string
  skey: string
  md5: string
  dataSize: number
  width: number
  height: number
  originUrls?: string[]
  largeUrls?: string[]
  mediumUrls?: string[]
  thumbUrls?: string[]
  /** 图片格式（发侧上传脚本可由 oid 推断；收侧缺省） */
  format?: ImageFormat
}

/** 图片上传资产（uploadImage 返回；字段与 ImageResource 同形，发侧要求齐全） */
export interface ImageAsset {
  oid: string
  skey: string
  md5: string
  dataSize: number
  width: number
  height: number
  format?: ImageFormat
}

/** 视频上传资产（uploadVideo 返回） */
export interface VideoAsset {
  tkey: string
  skey: string
  md5: string
}

/** 视频发送项：source 简写（自动上传/抽帧封面）或预上传 asset */
export type VideoSend =
  | { source: MediaInput; poster?: MediaInput | ImageAsset; width?: number; height?: number }
  | { asset: VideoAsset; poster?: ImageAsset; width?: number; height?: number }

/** batch_play_info 换取的加密视频地址（CENC 加密流，下载后用 decryptCencMp4 解密才能播放） */
export interface EncryptedVideoUrl {
  mainUrl: string
  backupUrl?: string
  /** 签名过期时间（秒级时间戳），过期后 URL 失效需重取 */
  expireTime?: number
}

export interface VideoResource {
  tkey: string
  skey: string
  md5: string
  width: number
  height: number
  checkPics: string[]
  poster?: ImageResource
  /** 内置缩略图（WEBP base64 裸串，前缀 data:image/webp;base64, 即显；poster 签名 URL 过期时的兜底） */
  inlinePic?: string
  /** 播放地址（事件下发前自动换取；过期后可 media.videoUrl(tkey) 重取） */
  url?: EncryptedVideoUrl
}

export interface CencSubsample {
  clear: number
  protected: number
}

/* ---------------------------------------------------------------------------
 * 卡片结构（入站解析用；LinkCard/UserCard/FileAsset 见消息段 data.value）
 * ------------------------------------------------------------------------- */

export interface LinkCard {
  url: string
  title?: string
  description?: string
  coverUrl?: string
}

export interface UserCard {
  uid: string
  secUid?: string
  name?: string
  avatarUrl?: string
  desc?: string
  followerCount?: string
  coverItems?: string[]
  coverUrls?: string[]
}

/** 群聊邀请卡载荷（messageType=58 / aweme_invite_card）：向某会话发送「邀请加入某群」卡片 */
export interface GroupCard {
  /** 被邀请群 id（conversation_id 与 conversation_short_id 同值下发） */
  conversationId: string
  /** 群名（group_name，title/desc 展示文案内嵌） */
  groupName: string
  /** 群图标 URL（group_icon.url_list 首位；缺省卡片无图） */
  iconUrl?: string
  /** 群成员数（group_member_count） */
  memberCount?: number
  /** 群主 uid（group_owner_uid） */
  ownerUid?: string
  /** 群主 sec uid（sec_group_owner_uid） */
  ownerSecUid?: string
  /** 群主昵称（group_owner_nickname，缺省空） */
  ownerNickname?: string
  /** 邀请人 uid（from_uid；缺省用发送者自身） */
  fromUid?: string
  /** 邀请人 sec uid（sec_from_uid），缺省省略 */
  fromSecUid?: string
  /** 邀请人昵称（title/desc 文案；缺省用 uid） */
  fromNickname?: string
  /** 群邀请凭证（aweme_invite_card.ticket）：经 chat.info 查目标群详情取得，服务端校验通过才派发卡片 */
  ticket?: string
}

/** 位置消息载荷（messageType=502 POI 定位）：坐标 + 地点信息 + 封面图 */
export interface LocationCard {
  /** 地点名（poi_name，text 展示） */
  name: string
  /** 详细地址（poi_address） */
  address: string
  /** 纬度 */
  latitude: number
  /** 经度 */
  longitude: number
  /** 模板 POI id（poi_id） */
  poiId?: string
  /** 作品 POI id（aweme_poi_id） */
  awemePoiId?: string
  /** 封面资源路径（cover_info.resource_url.uri） */
  uri?: string
  /** 封面 URL 列表（cover_info.resource_url.url_list，发侧缺省用空数组） */
  urlList?: string[]
}

export interface FileAsset {
  uri: string
  skey: string
  md5: string
  name: string
  dataSize: number
}

/* ---------------------------------------------------------------------------
 * 解密 / 嗅探
 * ------------------------------------------------------------------------- */

export function pickImageUrl (image: ImageResource): string | undefined {
  return [image.originUrls, image.largeUrls, image.mediumUrls, image.thumbUrls]
    .flatMap((urls) => urls ?? [])
    .find(Boolean)
}

/** 解密抖音 iv(12) + ciphertext + GCM tag(16) 的图片容器 */
export function decryptImage (encrypted: Uint8Array, skeyHex: string): Buffer {
  const key = Buffer.from(skeyHex, 'hex')
  if (key.length !== 32 || skeyHex.length !== 64) {
    throw new Error('image skey must be 32 bytes encoded as 64 hex characters')
  }
  if (encrypted.length < 28) throw new Error('encrypted image is too short')
  const input = Buffer.from(encrypted)
  const iv = input.subarray(0, 12)
  const tag = input.subarray(input.length - 16)
  const ciphertext = input.subarray(12, input.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * 解密单个 cenc-aes-ctr sample。受保护子区共享同一条连续计数器流；
 * clear 区间不消耗计数流。
 */
export function decryptCencSample (
  data: Uint8Array,
  keyInput: Uint8Array,
  ivInput: Uint8Array,
  subsamples: readonly CencSubsample[] = [],
): Buffer {
  const key = Buffer.from(keyInput)
  if (key.length !== 16) throw new Error('CENC key must be 16 bytes')
  if (ivInput.length !== 8 && ivInput.length !== 16) throw new Error('CENC IV must be 8 or 16 bytes')
  const iv = Buffer.alloc(16)
  Buffer.from(ivInput).copy(iv)
  const source = Buffer.from(data)

  if (subsamples.length === 0) {
    const cipher = createCipheriv('aes-128-ctr', key, iv)
    return Buffer.concat([cipher.update(source), cipher.final()])
  }

  const protectedChunks: Buffer[] = []
  let pos = 0
  for (const sample of subsamples) {
    if (sample.clear < 0 || sample.protected < 0 || pos + sample.clear + sample.protected > source.length) {
      throw new Error('CENC subsample exceeds sample bounds')
    }
    pos += sample.clear
    protectedChunks.push(source.subarray(pos, pos + sample.protected))
    pos += sample.protected
  }
  const cipher = createCipheriv('aes-128-ctr', key, iv)
  const decrypted = Buffer.concat([
    cipher.update(Buffer.concat(protectedChunks)),
    cipher.final(),
  ])

  const output = Buffer.alloc(source.length)
  pos = 0
  let decryptedPos = 0
  for (const sample of subsamples) {
    source.copy(output, pos, pos, pos + sample.clear)
    pos += sample.clear
    decrypted.copy(output, pos, decryptedPos, decryptedPos + sample.protected)
    pos += sample.protected
    decryptedPos += sample.protected
  }
  source.copy(output, pos, pos)
  return output
}

export type ImageFormat = 'webp' | 'jpeg' | 'png' | 'gif' | 'heic' | 'unknown'

export function sniffImageFormat (data: Uint8Array): ImageFormat {
  const b = Buffer.from(data)
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString() === 'RIFF' &&
    b.subarray(8, 12).toString() === 'WEBP'
  ) return 'webp'
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.length >= 6 && (b.subarray(0, 6).toString() === 'GIF87a' || b.subarray(0, 6).toString() === 'GIF89a')) return 'gif'
  if (b.length >= 12 && b.subarray(4, 8).toString() === 'ftyp') {
    const brands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])
    for (let offset = 8; offset + 4 <= Math.min(b.length, 32); offset += 4) {
      if (brands.has(b.subarray(offset, offset + 4).toString())) return 'heic'
    }
  }
  return 'unknown'
}
