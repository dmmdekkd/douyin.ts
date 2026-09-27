<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const { isDark, lang } = useData()
const KEY = 'dts-brand'
const t = (zh: string, en: string) => (lang.value.startsWith('en') ? en : zh)

// 现代化色板：同饱和明度、色相均匀分布的 8 色（源自 Tailwind 500 阶），首色为抖音品牌红
const presets = [
  '#fe2c55',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
]
const custom = ref('#fe2c55')

// 自绘取色器状态：面板开关、HSV 分量（供滑条 / SV 方块 / 游标定位）
const open = ref(false)
const hue = ref(348)
const sat = ref(82)
const val = ref(100)
const hexInput = ref('#fe2c55')
const padRef = ref<HTMLElement | null>(null)

// 向黑（t<0）或向白（t>0）混合出派生色
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const f = (c: number) =>
    t < 0 ? Math.round(c * (1 + t)) : Math.round(c + (255 - c) * t)
  const to = (c: number) => c.toString(16).padStart(2, '0')
  return `#${to(f(r))}${to(f(g))}${to(f(b))}`
}

function soft(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${
    isDark.value ? 0.2 : 0.14
  })`
}

// 改写品牌色 CSS 变量，brand-2 按明暗派生 hover 色
function apply(hex: string) {
  const root = document.documentElement
  root.style.setProperty('--vp-c-brand-1', hex)
  root.style.setProperty('--vp-c-brand-2', shade(hex, isDark.value ? 0.3 : -0.14))
  root.style.setProperty('--vp-c-brand-3', hex)
  root.style.setProperty('--vp-c-brand-soft', soft(hex))
}

function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const h =
    d === 0
      ? 0
      : max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4
  const s = max === 0 ? 0 : d / max
  return [((h * 60) % 360 + 360) % 360, s * 100, max * 100]
}

function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360
  const c = (v / 100) * (s / 100)
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = v / 100 - c
  let rgb: [number, number, number]
  if (hh < 60) rgb = [c, x, 0]
  else if (hh < 120) rgb = [x, c, 0]
  else if (hh < 180) rgb = [0, c, x]
  else if (hh < 240) rgb = [0, x, c]
  else if (hh < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`
}

// 统一入口：校验、持久化、应用、回填取色器控件
function pick(hex: string) {
  const v = hex.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(v)) return
  custom.value = v
  localStorage.setItem(KEY, v)
  apply(v)
  const [hh, ss, vv] = hexToHsv(v)
  hue.value = hh
  sat.value = ss
  val.value = vv
  hexInput.value = v
}

// SV 方块点击：坐标换算饱和度 / 明度
function onPad(e: MouseEvent) {
  const el = padRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  pick(hsvToHex(hue.value, s * 100, v * 100))
}

// 色相滑条输入：保持当前 s/v 换算新色
function onHue() {
  pick(hsvToHex(hue.value, sat.value, val.value))
}

function onHex() {
  pick(hexInput.value)
}

onMounted(() => {
  const saved = localStorage.getItem(KEY)
  if (saved) pick(saved)
})

// 明暗切换时重新派生 brand-2/soft
watch(isDark, () => {
  const saved = localStorage.getItem(KEY)
  if (saved) apply(saved)
})
</script>

<template>
  <div class="group">
    <p class="title">{{ t('主题颜色', 'Theme Color') }}</p>
    <div class="colors">
      <button
        v-for="c in presets"
        :key="c"
        class="color"
        :class="{ on: c === custom }"
        :style="{ '--c': c }"
        :aria-label="c"
        @click="pick(c)"
      />
      <!-- 自定义取色入口：展开自绘取色面板，替代浏览器原生对话框 -->
      <button
        class="picker"
        :class="{ open }"
        :title="t('自定义', 'Custom')"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span class="rainbow" aria-hidden="true" />
      </button>
    </div>
    <!-- 自由取色：色相滑条 + 饱和度/明度方块 + HEX 输入 -->
    <div v-if="open" class="panel">
      <div
        ref="padRef"
        class="pad"
        :style="{ '--hue': hue + 'deg', '--sv': sat + '%', '--vv': val + '%' }"
        @click="onPad"
      >
        <i aria-hidden="true" />
      </div>
      <input
        v-model.number="hue"
        class="hue"
        type="range"
        min="0"
        max="360"
        :aria-label="t('色相', 'Hue')"
        @input="onHue"
      />
      <div class="hex">
        <input
          v-model="hexInput"
          spellcheck="false"
          :aria-label="t('颜色值', 'Hex')"
          @change="onHex"
          @keydown.enter="onHex"
        />
        <span class="dot" :style="{ background: custom }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.title {
  padding: 0 24px 0 12px;
  line-height: 32px;
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 4px 16px 10px;
  min-width: 168px;
}

/* 动效与官方一致：0.25s + 官方缓动，不弹跳不发光 */
.color {
  --c: #fe2c55;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--c);
  cursor: pointer;
  transition:
    box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.color:hover,
.picker:hover {
  /* 细环提示，与选中态同一套环体系 */
  box-shadow:
    0 0 0 2px var(--vp-c-bg),
    0 0 0 3px var(--c, #a0a0a0);
}

/* 选中：白底分隔外环 + 同色细环，明暗主题下都醒目且不喧宾夺主 */
.color.on,
.picker.open {
  box-shadow:
    0 0 0 3px var(--vp-c-bg),
    0 0 0 4px var(--c, #a0a0a0);
}

/* 自定义取色：现代线性彩虹圆点 */
.picker {
  --c: #a0a0a0;
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: visible;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  transition: box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.rainbow {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: linear-gradient(90deg, #f66, #fc6, #6c9, #6cf, #66f, #c6f);
  pointer-events: none;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 168px;
  margin: 0 16px 12px;
  padding: 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
}

/* SV 方块：上黑渐变叠右白->当前色相渐变，点击换 s/v */
.pad {
  position: relative;
  height: 88px;
  border-radius: 6px;
  cursor: crosshair;
  background:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
}

.pad i {
  position: absolute;
  left: var(--sv);
  top: calc(100% - var(--vv));
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #0006;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* 色相滑条：内嵌彩虹轨道 + 白圆钮 */
.hue {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  outline: none;
  cursor: pointer;
}

.hue::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #0003;
  background: #fff;
  box-shadow: 0 1px 3px #0005;
  cursor: pointer;
}

.hue::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #0003;
  background: #fff;
  box-shadow: 0 1px 3px #0005;
  cursor: pointer;
}

.hex {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hex input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  font-family: inherit;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.hex input:focus {
  border-color: var(--vp-c-brand-1);
}

.hex .dot {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--vp-c-divider);
}
</style>