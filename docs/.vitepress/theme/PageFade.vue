<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { useRoute } from 'vitepress'
import PageProgress from './PageProgress.vue'

const route = useRoute()
// 路由切换后主内容轻量淡入上移，避免页面生硬跳变
// 尊重系统「减少动态效果」，开启时跳过
watch(
  () => route.path,
  () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    nextTick(() => {
      document.querySelector('#VPContent')?.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 250, easing: 'ease' },
      )
    })
  },
)
</script>

<template>
  <PageProgress />
  <slot />
</template>