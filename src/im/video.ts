/** 视频本地处理：MP4 尺寸探测与首帧封面抽取（支撑无封面/无尺寸发送） */

import { Mp4Demuxer, VideoDecoder, type VideoFrame } from '@napi-rs/webcodecs'
import { Transformer } from '@napi-rs/image'

/** 轻量尺寸探测：读 MP4 视频轨元数据（codedWidth/codedHeight），不解码（探测不到返回 0,0） */
export async function probeVideo (data: Uint8Array): Promise<{ width: number; height: number }> {
  const demuxer = new Mp4Demuxer({ error: () => {} })
  try {
    await demuxer.loadBuffer(data)
    const track = demuxer.tracks.find(t => t.trackType === 'video')
    return { width: track?.codedWidth ?? 0, height: track?.codedHeight ?? 0 }
  } catch {
    return { width: 0, height: 0 }
  } finally {
    demuxer.close()
  }
}

/** 解码视频首帧为 JPEG 封面，顺带返回像素尺寸（无视频轨或无法解码时抛错） */
export async function extractVideoPoster (
  data: Uint8Array,
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  let first: VideoFrame | undefined
  let err: Error | undefined
  const fail = (e: Error): void => { err ??= e }
  const decoder = new VideoDecoder({
    output: frame => {
      // 只留首帧，其余解码产物直接释放
      if (first) { frame.close(); return }
      first = frame
    },
    error: fail,
  })
  const demuxer = new Mp4Demuxer({ error: fail })
  try {
    await demuxer.loadBuffer(data)
    const config = demuxer.videoDecoderConfig
    if (!config) throw new Error('video has no decodable track')
    decoder.configure({
      codec: config.codec,
      description: config.description,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
    })
    for await (const chunk of demuxer) {
      if (chunk.chunkType !== 'video' || !chunk.videoChunk) continue
      decoder.decode(chunk.videoChunk)
      // 每帧解码后冲刷一次，确保首帧回调后能及时中断，不拖全片解码
      await decoder.flush()
      if (err) throw err
      if (first) break
    }
    if (!first) throw err ?? new Error('video produced no frame')
    const width = first.codedWidth
    const height = first.codedHeight
    const pixels = new Uint8Array(width * height * 4)
    await first.copyTo(pixels, { format: 'RGBA' })
    const jpeg = Transformer.fromRgbaPixels(pixels, width, height).jpegSync()
    return { jpeg, width, height }
  } finally {
    first?.close()
    decoder.close()
    demuxer.close()
  }
}