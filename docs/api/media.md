# media 媒体

媒体上传。返回的 Asset 直接传给 `msg.send` / `msg.media`。

## image

```ts
const img = await bot.media.image(new Uint8Array(pngBytes))
await bot.msg.media(chatId, { image: img })
```

## video

返回值需配合封面与尺寸一起发送。

```ts
const video = await bot.media.video(new Uint8Array(mp4Bytes))
const poster = await bot.media.image(new Uint8Array(jpegBytes))
await bot.msg.media(chatId, { video: { asset: video, poster, width: 720, height: 1280 } })
```

## file

```ts
const f = await bot.media.file(new Uint8Array(bytes), '报表.xlsx')
await bot.msg.media(chatId, { file: f })
```

| 方法 | 参数 | 返回 |
|------|------|------|
| image | `data: Uint8Array` | `Promise<ImageAsset>` |
| video | `data: Uint8Array` | `Promise<VideoAsset>` |
| file | `data: Uint8Array, name?: string` | `Promise<FileUploadAsset>` |
