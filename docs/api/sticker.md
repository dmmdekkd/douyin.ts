# sticker 表情

表情贴纸资源：热门贴纸、我的收藏、动图（GIF）表情，以及收藏/取消收藏。走浏览器 cookie 直调，无需签名。

## 面板分区对照

官方客户端表情面板共四个分区，与 SDK 接口的对应关系（浏览器实测）：

| 面板分区 | SDK 接口 | 资源域 | SDK 可用性 |
|----------|----------|--------|------------|
| 贴纸（23 个官方互动贴纸） | `bot.sticker.trending()` | `im-resource`（`s=im_111`/`im_2`） | 可用，表情消息推荐源 |
| 小表情（214 个键值表情） | `bot.media.emojiList()` | `tos-cn-i-tsj2vxp0zn` | 可用，仅表态/文本键值 |
| 收藏（用户收藏贴纸） | `bot.sticker.favs()` | `im-emoticon`（`s=im_123`） | 接口被风控，仅浏览器可用 |
| GIF（动图表情） | `bot.sticker.list({ scenes })` | `im-emoticon`（`s=im_124`） | 接口被风控，仅浏览器可用 |

::: warning
lite_emoji 直链必须为 `im-resource`/`im-emoticon` 域；`tos-cn` 域（小表情源）会被服务端标记 `s:visible` 仅发送者可见。
:::

## 表情列表

`bot.sticker.list(options?)` — 表情资源列表，`scenes` 决定面板（缺省我的收藏）。aggregation 接口无浏览器签名时返回 `blocked`，SDK 环境不可用，请用 `trending()` 替代。

```ts
const page = await bot.sticker.list()
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| options.scenes | string | - | 面板场景，缺省我的收藏面板 |
| options.cursor | number | - | 翻页游标 |
| options.limit | number | - | 单页条数 |

## 我的收藏

`bot.sticker.favs()` — 我的收藏表情，等价于 `list()` 缺省入参。同受 aggregation 风控限制，SDK 环境不可用。

## 动图表情

`bot.sticker.gifs()` — 收藏中带 `animate` 动图的贴纸（GIF 无独立接口，即贴纸动图形态）。同受 aggregation 风控限制，SDK 环境不可用。

```ts
const gifs = await bot.sticker.gifs()
for (const g of gifs.list) {
  console.log(g.animate.urls[0]) // 动图直链（带签名时效）
}
```

## 收藏表情

`bot.sticker.collect(ids, options?)` — 收藏/取消收藏。

```ts
await bot.sticker.collect(['7383944950850781211'])
await bot.sticker.collect(['7383944950850781211'], { remove: true })
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| ids | string[] | - | 贴纸 id 列表 |
| options.remove | boolean | `true` `false` | true 取消收藏 |

## 热门表情

`bot.sticker.trending(options?)` — 热门表情分页，官方面板「贴纸」分区同源数据（`im-resource` 域），表情消息推荐数据源。响应无总量，`done` 由 `has_more` 表达。

```ts
const page = await bot.sticker.trending({ cursor: 0, count: 50 })
while (!page.done) {
  const next = await bot.sticker.trending({ cursor: page.cursor, count: 50 })
  page.list.push(...next.list)
}
```

### 参数

| 参数 | 类型 | 可能的值 | 说明 |
|------|------|----------|------|
| options.cursor | number | `0` | 翻页游标 |
| options.count | number | `50` | 单页条数 |

## 能力开关

`bot.sticker.strategy(scenes?)` — app 能力开关，返回决策树与动效资源包配置，`scenes` 决定拉取哪套（缺省 `interactive_resources`）。

```ts
const cfg = await bot.sticker.strategy()
// { decisionTrees?, interactiveResourceConfig? }
```

## 数据结构

资源列表为分页结构（`list` / `favs` / `gifs` / `trending` 均同形），需要全量时按 `done` + `cursor` 翻页。

```ts
interface Sticker {
  id: string        // 贴纸 id（字符串，服务端 number 字段在 JS 中会丢精度）
  type: number      // sticker_type：如 2=表情贴纸
  name?: string     // 显示名（如 [微笑]）
  hash?: string
  source?: string   // 来源标记（comment_emoji 等）
  static?: StickerImage      // 静态图
  animate?: StickerImage     // 动图（webp/gif 载体）
}

interface StickerImage {
  width: number
  height: number
  uri: string
  urls: string[]    // CDN 直链，带签名时效
}

interface StickerPage {
  list: Sticker[]
  total: number
  cursor: number
  done: boolean
}
```

## ID 对照表：贴纸分区

「贴纸」分区 23 个官方互动贴纸，`id` 为 `im-resource` 资源路径（URL `.../obj/im-resource/<id>?...` 的路径段），可直接传给表情消息（SDK 自动解析签名直链）；节日限定贴纸（桂兔绣月/礼敬山河）的 `uri` 在 `p3-aweme-im-img.byteimg.com/tos-cn-i-7lppr0tkux/` 下。

| 名称 | 资源 id |
|------|---------|
| 续火花 | `1687263281313-ts-e7bbade781abe88ab12e706e67` |
| 比心 | `1700709715333-ts-e6af94e5bf832e706e67` |
| 桂兔绣月 | `6abd634f269b485d875e9225a6482337.webp`（节日限定） |
| 礼敬山河 | `ca85d1a5885340e6b4c0da8e20024f85.webp`（节日限定） |
| 在干嘛 | `1700709660537-ts-e59ca8e5b9b2e5989b2e706e67` |
| 笑死 | `1700709792873-ts-e7ac91e593ad2e706e67` |
| 麻了 | `1700709833784-ts-e9babbe4ba862e706e67` |
| 躺平 | `1700709877574-ts-e8babae5b9b32e706e67` |
| 摇骰子 | `1687261809634-ts-e9aab0e5ad902e77656270` |
| 猜拳 | `1687262043957-ts-e78c9ce68bb32e77656270` |
| 开心 | `1700709744299-ts-e5bc80e5bf832e706e67` |
| 嗨 | `1652427775960-ts-373039313837373530383930373438333137322e706e67` |
| 吹泡泡 | `1687263233752-ts-e590b9e6b3a1e6b3a12e706e67` |
| 黑人问号 | `1700709932312-ts-e9bb91e4babae997aee58fb72e706e67` |
| 早上好 | `1687263059740-ts-e697a9e4b88ae5a5bd2de5a4aae998b32e706e67` |
| 晚上好 | `1687263122037-ts-e6999ae4b88ae5a5bd2de6989fe6989f2e706e67` |
| 早点睡 | `1687263141266-ts-e6999ae4b88ae5a5bd2de697a9e782b9e79da12e706e67` |
| 爱心 | `1687263417979-ts-e788b1e5bf832e77656270` |
| 便便 | `1687263664039-ts-e5bda9e889b2e4bebfe4bebf2e77656270` |
| 戳一戳 | `1687263258495-ts-e688b3e4b880e688b32e706e67` |
| 绝了 | `1687262734782-ts-e7bb9de4ba862e706e67` |
| 已阅 | `1687262804182-ts-e5b7b2e998852e706e67` |
| 生日祝福 | `1687263782367-ts-e89b8be7b3952e706e67` |

## ID 对照表：小表情分区

「小表情」分区 214 个键值表情（`bot.media.emojiList()` 下发），`id` 为拼音资源名，可传给表情消息或表情回应（SDK 自动解析为键值文本）；`hash` 仅供面板资源对账，`tos-cn` 域不可发 lite_emoji。

| id | 键值 | hash |
|----|------|------|
| `weixiao` | [微笑] | `54a0f69dc150401a85ba8c20c1a05db1` |
| `aimu` | [色] | `27a1d35dea9748ac8c14f6c2c9829965` |
| `liangdai` | [发呆] | `88ebe7b3f2e24729aa4de3ff33ae5731` |
| `kuye` | [酷拽] | `0fac43466165409a805b3b6e3547ccef` |
| `koubi` | [抠鼻] | `accde8fa9fe04c5e8fa3f25d1ddb5584` |
| `liulei` | [流泪] | `2d8dc1e2bb8a417cab4130df2d10e478` |
| `wulian` | [捂脸] | `357ac72b9b6449f7bd3005ff66678822` |
| `fanu` | [发怒] | `156352b6879b4b5f96fd80434ff72c8e` |
| `ziya` | [呲牙] | `17bc9c4501784279b8e7d886832b0f28` |
| `gaxiao` | [尬笑] | `96744c9a302345d1b14d7e0a9951c7b9` |
| `haixiu` | [害羞] | `d05cee2608fe4f998fef3f90de9466df` |
| `keai` | [调皮] | `a921fa28653043c1bbf162abe017c99a` |
| `tianping` | [舔屏] | `d99bd102d422484188b98e8889c0c330` |
| `kan` | [看] | `87c2ae45679c4cc4a35bd7182fd76935` |
| `xin` | [爱心] | `427b632213784532a4076c3b0ab269fb` |
| `bixin` | [比心] | `75b4e7e2405447959578f54d87811e35` |
| `zan` | [赞] | `1a09f79a0e7e433eb2bc143c9f026d65` |
| `guzhang` | [鼓掌] | `15d1258bec8e4c9ea9687f1134bd5f65` |
| `qidao` | [感谢] | `fabab8b14ec64f669283287a4b7041cb` |
| `baobaoni` | [抱抱你] | `299f50b8f96640d5b349cc6cb4a76030` |
| `meigui` | [玫瑰] | `683fcd46faf148af99c90e36ccc4c013` |
| `gangaliuhan` | [尴尬流汗] | `160eca1320584e2e87122e7d7ba72a53` |
| `chuoshoushou` | [戳手手] | `4268c0b885ec4eae8e95dab8635ca215` |
| `xingxingyan` | [星星眼] | `007064f99b694041a1890e52ff8c5768` |
| `shamate` | [杀马特] | `ed5fb68598cf4741b3e7f2affd825650` |
| `huanglianganbei` | [黄脸干杯] | `a0a1e35991334532b142572d93f38ac5` |
| `baojinziji` | [抱紧自己] | `c0cf6b7d6a144b68b6045fd92bfe9fe2` |
| `baibai` | [拜拜] | `36cf73734e9c49d48b3e9a5bbe2affaf` |
| `rehuale` | [热化了] | `2cffc18234074d20acb0c6334c76f04a` |
| `huanglianqidao` | [黄脸祈祷] | `3f67722d0c694372b7023deda01bd91c` |
| `meng` | [懵] | `dbd68a1183b344648759f5971cbc6238` |
| `jushou` | [举手] | `3c34da0d65db47c6933e6b66cc17e5aa` |
| `jiagongde` | [加功德] | `49b00fcf022d4c36ba86bb19c7358ec6` |
| `tanshou` | [摊手] | `6ffc70d8850b4e5eb6c7a5aa9e7b1782` |
| `wuyuliuhan` | [无语流汗] | `67f5a31e2895499dbfff97ff81efb0f8` |
| `xuhuohuaba` | [续火花吧] | `1da1cd2598ba48a78cf07dc7eea09338` |
| `dianhuo` | [点火] | `3bb9834bd95d4a5ba305ca2d788bd62e` |
| `kuku` | [哭哭] | `c380b32e707b43a2967ee7b492771c0f` |
| `tushexiaogou` | [吐舌小狗] | `e4fb11ce2e2b432483ef58e058be6e0d` |
| `songhua` | [送花] | `ff736698b03446d19ae05cbd6cc45256` |
| `aixinshou` | [爱心手] | `7f50f1d4d0c74571b1a60eba9b41a4d7` |
| `tietie` | [贴贴] | `c3dee11223784da3a2ed524d94bb2ce8` |
| `lingguangyishan` | [灵机一动] | `801127f060844405b0f5e00bd01cb8ba` |
| `ye` | [耶] | `f00c1c8054ff41768994256236d305b1` |
| `dalian` | [打脸] | `d00f39c3d5d54144a395ad4d7f8d4489` |
| `daxiao` | [大笑] | `ce993ad237174993a2ed8de550a63772` |
| `jizhi` | [机智] | `ca113e21412d4609ae38032b3befddb9` |
| `songxin` | [送心] | `72211d3eadb64791a967f43ab340a55a` |
| `666` | [666] | `11a083f1a213461f859370ccbce074df` |
| `bizui` | [闭嘴] | `d32f14b5edfd4489a4ea736a8ad39741` |
| `laikanwo` | [来看我] | `27059cc0891649a8b2b0860b5b08f540` |
| `yiqijiayou` | [一起加油] | `632214f7625a41ec8b558961929153f8` |
| `haqian` | [哈欠] | `8ef4e9f6ef36449dab4c5ecde36f7d6b` |
| `zhenliang` | [震惊] | `7181d20e807f4c5787f484531d1d8468` |
| `yun` | [晕] | `2af8cb49d2854197b7dd9b87f9dd106b` |
| `shuai` | [衰] | `aa5c7f4a1d0c430a94934287cacd3c17` |
| `kun` | [困] | `23cdce75a6d64bd8bb7ff87037db1be0` |
| `what` | [疑问] | `9ea78ef420fa4bf1b7e544a01e75b830` |
| `qibuchengsheng` | [泣不成声] | `7fb67c323a0d410ea5573d4825e347eb` |
| `xiaoguzhang` | [小鼓掌] | `8f19f0db21324c7f9ce7b2dca984a309` |
| `dajinya` | [大金牙] | `b94090121f3e4549a3bee84e00515ed0` |
| `touxiao` | [偷笑] | `817c931baafa4d06a120a8d67973b6f0` |
| `shihua` | [石化] | `88746458dcbd47b1aa801e3823e6c9a2` |
| `sikao` | [思考] | `c3e345069adf42f58036c349ecc20a00` |
| `tuxie` | [吐血] | `331299e25af844a38800ec75d8dd0a16` |
| `kelian` | [可怜] | `1369a30daa7d45d6b3fa5ab241938fd2` |
| `xu` | [嘘] | `7c02d77ba7b44cfda223941529ccb2e6` |
| `piezui` | [撇嘴] | `784ef77ac9de4e4990a607166856cd38` |
| `xiaoku` | [笑哭] | `e4f0c86449754bab8ae2cefe6317ceee` |
| `jianxiao` | [奸笑] | `6ac6247beb3a41d9b9e0e982e0225506` |
| `deyi` | [得意] | `b1b52b6e940a4ef8907819eb8e871c21` |
| `hanxiao` | [憨笑] | `fceeae50c04b4343b44055ba9f9bb1a3` |
| `huaixiao` | [坏笑] | `eab59a94674f40358b412586f148aac6` |
| `zhuakuang` | [抓狂] | `e7ffd9db28e3455195872ebf666d2c66` |
| `leiben` | [泪奔] | `20dbe8334dd64d028f943abc2ccde4d9` |
| `qian` | [钱] | `9a45bb9c0b8a4963b858846b079cfe2f` |
| `kongju` | [恐惧] | `c12d025f50a047c2b064ce5f1a196f94` |
| `xiao` | [愉快] | `62266cefe5fe4422aceaeaeed9072b3b` |
| `kuaikule` | [快哭了] | `79df79563eaf424e9eb7a26558236ff7` |
| `fanbaiyan` | [翻白眼] | `0e40da06368145848f7585edc937f34e` |
| `hufen` | [互粉] | `cb46843009fe47808953af2c9ab2fb9a` |
| `woxiangjingjing` | [我想静静] | `95d5d919b99c43f29d2fbc660ec873f0` |
| `weiqu` | [委屈] | `2f7509f2cbe248889f279d19ea3fd649` |
| `bishi` | [鄙视] | `5c13cbb44f334122a9cd7cf4bcc6598e` |
| `feiwen` | [飞吻] | `6dcb7560c1c84d45b4abe2cb37ae7afb` |
| `zaijian` | [再见] | `cae63f89c3eb478f8d1cca893b1b1a0c` |
| `ziweibiezou` | [紫薇别走] | `1d921b6eff48473f872fa7d278d26926` |
| `tingge` | [听歌] | `82bed7a3182b4c6db21ca39417359fa1` |
| `qiubaobao` | [求抱抱] | `de99b54c6be24f73a5aaef8366a55e99` |
| `zhoudongyudeningshi` | [绝望的凝视] | `19f6a9449e714d85bb393794daaf6d58` |
| `masichundeweixiao` | [不失礼貌的微笑] | `b7b842ba92e14fb8a8f328f25db91276` |
| `bukan` | [不看] | `626f19e473d94e95b21b67f098599281` |
| `liekai` | [裂开] | `e8c40bd4201e4afda065c55688971a2f` |
| `ganfanren` | [干饭人] | `0b0adfdffaea4c62a73302ae44d67a66` |
| `qingzhu` | [庆祝] | `9c1325e3650a4a4d96d8e299406d9d68` |
| `tushe` | [吐舌] | `e577535321324e68a0cc8fcff1a2f421` |
| `daiwugu` | [呆无辜] | `98c368cc39b74b94bf7923b6d9c479b9` |
| `baiyan` | [白眼] | `a9d1ba597042412f9275369807147bee` |
| `zhutou` | [猪头] | `4296ea156ee6479e9ad5c1381ec73cca` |
| `lengmo` | [冷漠] | `ba1d020f28a749e388fb1d15e52ac4ae` |
| `anzhongguancha` | [暗中观察] | `3cf77301823a4e969cc4c0a04d245f3d` |
| `erha` | [二哈] | `2ddc8ae48fae4a4fb3767f666bb79d95` |
| `caigou` | [菜狗] | `62baecf5a0084194ac383d3d199ab597` |
| `heilian` | [黑脸] | `b96c76ac689f44d09537583ca2357672` |
| `zhankaishuoshuo` | [展开说说] | `30f0c01ef9d24144a8ae05351485fe18` |
| `mifenggou` | [蜜蜂狗] | `d336f83b827b407d872bc48861a44c70` |
| `huangchaiquan` | [柴犬] | `764a5db2a67242c189f5fdabb1c75648` |
| `motou` | [摸头] | `10790e118cbc4d13b48cdc19c1eecb96` |
| `zhoumei` | [皱眉] | `d143738426054c9f88657ee97b779643` |
| `cahan` | [擦汗] | `0f7be11419c44d1ab158bbafa666101c` |
| `honglian` | [红脸] | `15efff0277f74e5b9e2b12c984eac159` |
| `zuoguilian` | [做鬼脸] | `e8d099b1dc5b41b0b8535b47747a94f4` |
| `qiang` | [强] | `0b815bcdb647471b9281e3105d8d6c8e` |
| `ruhua` | [如花] | `dd44ccdacbe6444a9515bdca3fb56d5f` |
| `tu` | [吐] | `c0157bfb1fc548d097933c039d6952ae` |
| `liangxi` | [惊喜] | `e718e4d7913c4bcf9c49560ff96386e9` |
| `qiaoda` | [敲打] | `8067eb30b0d74ad29c15a8c5c7b11230` |
| `fendou` | [奋斗] | `fb3fb08ab5204f2a83086d782944882d` |
| `tucaihong` | [吐彩虹] | `0878b09fe3fa4d4a8f47c63748cf7762` |
| `daku` | [大哭] | `53246f7d51fa42e5b48b99c8074ca607` |
| `heiha` | [嘿哈] | `af4e2e63b51f4d66a060ff0a42d0098b` |
| `jingkong` | [惊恐] | `fd2f5745edbd4dadb6014096965d1c6c` |
| `jiong` | [囧] | `4cd5a1e2c43341a9b4ac95ace6ed913e` |
| `nanguo` | [难过] | `697dc91cd453495d988628058582fed3` |
| `xieyan` | [斜眼] | `63a00ad586eb4f9e81369a7e693b778b` |
| `yinxian` | [阴险] | `628bc8956092489399730d0c8178de5b` |
| `youxian` | [悠闲] | `989818a338bd4d718f0afc47f7c76a4c` |
| `zhouma` | [咒骂] | `44802ec1a8bd4ff2aac38cfcf97201cb` |
| `chiguaqunzhong` | [吃瓜群众] | `2e2059714acb489483735cbe63ff7dbc` |
| `lvmaozi` | [绿帽子] | `d23e058bab744349ac636c45e9a3687f` |
| `gannubuganyan` | [敢怒不敢言] | `38b34096e69c41119b8d50cfd3a66882` |
| `qiuqiule` | [求求了] | `3b99deef770044d79182c18a854f4f27` |
| `yanhanrelei` | [眼含热泪] | `daf0e01ed3404b8e88898f690533bb76` |
| `tanqi` | [叹气] | `d7c541c323de4272acf862f77bb8b8a2` |
| `haokaixin` | [好开心] | `9b931359a63a42f693fdabe5934e95a9` |
| `bushiba` | [不是吧] | `a854fc87af894fddb1e36f97867c8169` |
| `jugong` | [鞠躬] | `93ffc02b07174d15a0d602b7a4cbb87f` |
| `tangping` | [躺平] | `25625ce0678448fc9c556bd1ebcf638c` |
| `jiuzhuandachang` | [九转大肠] | `ea89e25c77dd423d8403d20740f23bb7` |
| `bunibuxiang` | [不你不想] | `b4845baf417a404488e955464208cc3c` |
| `yitouluanma` | [一头乱麻] | `db393c6b9bba40f3b37d4e079d1cbf1e` |
| `kisskiss` | [kisskiss] | `f971f6f859b24829a15196c5a0738df1` |
| `nibudaxing` | [你不大行] | `0f2d07ea48a94bf0a57818056392bb42` |
| `omg` | [噢买尬] | `af75834bf58e44c88b1825f85d50b7da` |
| `dangji` | [宕机] | `561341b97e7844148b6f040241357122` |
| `kuse` | [苦涩] | `e72ce46a6ab640b38c7686f4b77fb7e4` |
| `chengqiangluolei` | [逞强落泪] | `67b9bcd2e1d64888bf57fa433e5b4717` |
| `huanglianqiujiwei` | [求机位-黄脸] | `66e8109018b64af1b87ce68ff2bfc18e` |
| `qiujiwei3` | [求机位3] | `ec3d99650c114cb49f22cda9ce06d25f` |
| `jingxuan` | [点赞] | `8e7e1b35d32b4623a0240552dc784b0f` |
| `jingxuanzan` | [精选] | `8d72402dd91a4a3a8cf4591b266ddb14` |
| `jiayou` | [强壮] | `41a493d326e7475fb8f1ef0c614dbf25` |
| `pengquan` | [碰拳] | `2bba2a8b361e467288d796c1581fec60` |
| `ok` | [OK] | `28dd2b330ea74d4cac2388f617177fe1` |
| `jizhang` | [击掌] | `d3f83268e073468fbe8759638beb42ef` |
| `zuoshang` | [左上] | `cf670dd2a4c2487181ee834aa0b048fa` |
| `woshou` | [握手] | `4550a48b841144d7b37fff3d02ec8a25` |
| `baoquan` | [抱拳] | `5c6a7e331b7441ecb615e0adab43935a` |
| `gouyin` | [勾引] | `6db49f314c1d4754a8205c3231edd396` |
| `quantou` | [拳头] | `5bede8c4134b4be798c924faee784650` |
| `ruo` | [弱] | `5028f8d3638a488b987008c384745afc` |
| `shengli` | [胜利] | `85abaf2fa4b940879a7b3bfdb45c3299` |
| `youbian` | [右边] | `11aadc9ed7b643279c38f94e8ed347c0` |
| `zuobian` | [左边] | `bed344e70c214bf281db6a7944ef909a` |
| `kiss` | [嘴唇] | `b1b3824e7b6c482b8d52b1c3b5577849` |
| `shangxin` | [心碎] | `371bb866809f454597ef538f604bd25a` |
| `diaoxie` | [凋谢] | `c93a47ad594b4be3a8c288aff0d7543b` |
| `fennu` | [愤怒] | `6dd1d010b5fd4f5197c1ecad3ce6796b` |
| `laji` | [垃圾] | `d7d09280091445aabfd912bcca4d9a89` |
| `pijiu` | [啤酒] | `a8ae1c4c2e0f467dbff1ba0964e0175d` |
| `kafei` | [咖啡] | `dcbcf5d7ca07490a950a37ff66a5be74` |
| `dangao` | [蛋糕] | `1153a12fbb514977b3a5349d3dcc509b` |
| `liwu` | [礼物] | `e8e086e0f6544f9b87117abebd96e840` |
| `sahua` | [撒花] | `8cefd1b8c16b412298657b6e1d81f8ab` |
| `jiayi` | [加一] | `496076e82fd74be793ab16d2940e8f8c` |
| `jianyi` | [减一] | `ffc25006163e4ecfa70968744d1be61e` |
| `okk` | [okk] | `9309aa3f9bed475b88538346f56fc6e6` |
| `V5` | [V5] | `cddffb522b2d421d81eb9da0f7f3cbb1` |
| `jue` | [绝] | `f1e1a02468b7420c841733c780ec2576` |
| `geili` | [给力] | `5387fc1361634b579946fbac7c4ea5f4` |
| `hongbao` | [红包] | `3e78d79aa4964404bb78b445f34c78fd` |
| `shi` | [屎] | `eae0730620d644bdbb91985bd9cfff4e` |
| `fa` | [发] | `ee4f3e944a62429e8e963bd187d00536` |
| `18jin` | [18禁] | `40724dd5538c474693ec54d34a14c613` |
| `zhadan` | [炸弹] | `a309a1e9a10049d88b1c9848f5f7b287` |
| `xigua` | [西瓜] | `39ca333313da4187bd5651a5404aed26` |
| `jiajitui` | [加鸡腿] | `1391aac43d004af986f2202f43253f94` |
| `wozhua` | [握爪] | `966210d6153146e8b58686aa1cc763ca` |
| `taiyang` | [太阳] | `5c9e5b67fc524f14b4ae49b5977afd9d` |
| `yueliang` | [月亮] | `cfa03e7f7b534eb2a9bc16fec54ed23f` |
| `geiguile` | [给跪了] | `21d2a8bbe630496d88c03fa9179b17cb` |
| `jiaolv` | [蕉绿] | `ac2d04da5bf54c8bb12628510d8718ba` |
| `zhaxin` | [扎心] | `e6121879b6de4bd08d35a312574f6563` |
| `hugua` | [胡瓜] | `5f3bb76347cd49e4935300b507353f68` |
| `dacall` | [打call] | `31a1efcf7c97414fae43d1d08058b0ee` |
| `shuanq` | [栓Q] | `a948fa11ae344a1d91276235ab6bf70b` |
| `xuehua` | [雪花] | `5144febc02ad42c082b83980d9159e13` |
| `shengdanshu` | [圣诞树] | `9d3184f19a0042f2886922fd6d1b6823` |
| `pinganguo` | [平安果] | `0855a7b63f1f437db4eaa3519d5dd4d5` |
| `shengdanmao` | [圣诞帽] | `71d0ea5435d443519eafc2d72eee07c7` |
| `qiqiu` | [气球] | `2eb779c7734345979bd3f866989a167f` |
| `yanhua` | [烟花] | `e679017985b54d19b23668fc3437a1a1` |
| `fu` | [福] | `c5dd439d89754e4aa6c553a244aacc4b` |
| `candy` | [candy] | `cce110c8f9f74a898a21ab413fb6cc63` |
| `tanghulu` | [糖葫芦] | `f99e62388e6c4553974f1fe44f602456` |
| `bianpao` | [鞭炮] | `237a828fd0964b2b9510c15de33383ad` |
| `yuanbao` | [元宝] | `6c0ebb50021a4b9e84cb5908be4eb5ef` |
| `denglong` | [灯笼] | `a7a43e8805fc425990fed26d8be5b7b6` |
| `jinli` | [锦鲤] | `f88e3e8d639b438aaa084549086fbb46` |
| `qiaokeli` | [巧克力] | `c6db9180292c47779624a865d80f67e7` |
| `jiezhi` | [戒指] | `f8eb6c5b5d6640cc82de8ecd4acd33d0` |
| `bangbangtang` | [棒棒糖] | `38fd079e306a40e4953bdf4a5d8a16db` |
| `zhifeiji` | [纸飞机] | `c0e6de9ee9d646d0a0d01831f3870787` |
| `zongzi` | [粽子] | `ce5e59e1376d440b98bb738c90e1a6e1` |
