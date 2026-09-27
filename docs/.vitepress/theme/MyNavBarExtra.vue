<script lang="ts" setup>
import { computed } from 'vue'
import VPFlyout from 'vitepress/dist/client/theme-default/components/VPFlyout.vue'
import VPSwitchAppearance from 'vitepress/dist/client/theme-default/components/VPSwitchAppearance.vue'
import VPSocialLinks from 'vitepress/dist/client/theme-default/components/VPSocialLinks.vue'
import { useData } from 'vitepress'
import PanelTheme from './PanelTheme.vue'

const { site, theme } = useData()

// 渲染条件：外观开关 或 社交链接 存在即显示 ⋮
const hasExtraContent = computed(() => site.value.appearance || theme.value.socialLinks)
</script>

<template>
  <VPFlyout v-if="hasExtraContent" class="VPNavBarExtra" label="extra navigation">
    <PanelTheme />

    <div
      v-if="
        site.appearance &&
        site.appearance !== 'force-dark' &&
        site.appearance !== 'force-auto'
      "
      class="group"
    >
      <div class="item appearance">
        <p class="label">
          {{ theme.darkModeSwitchLabel || 'Appearance' }}
        </p>
        <div class="appearance-action">
          <VPSwitchAppearance />
        </div>
      </div>
    </div>

    <div v-if="theme.socialLinks" class="group">
      <div class="item social-links">
        <VPSocialLinks class="social-links-list" :links="theme.socialLinks" />
      </div>
    </div>
  </VPFlyout>
</template>

<style scoped>
.VPNavBarExtra {
  margin-right: -12px;
}

/* 官方布局为桌面 768-1279 显示 ⋮，桌面 ≥960 的常显见 custom.css 覆盖 */

.item.appearance,
.item.social-links {
  display: flex;
  align-items: center;
  padding: 0 12px;
}

.item.appearance {
  min-width: 176px;
}

.appearance-action {
  margin-right: -2px;
}

.social-links-list {
  margin: -4px -8px;
}
</style>