<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useSettingStore } from '@/stores/setting'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  accountId: string
}>()

const toast = useToastStore()
const settingStore = useSettingStore()

const YULU_OPEN = 1787709600 * 1000
const YULU_SELF = [5002, 5003, 5007]
const YULU_PRODUCT = [5008, 5009, 5010]
const YULU_TOP = [5001, 5002, 5003, 5004, 5005, 5006, 5007]
const YULU_ONECLICK = { collect: 5001, frog: 5005, cloud: 5006, thunder: 5004 } as const
const YULU_ONECLICK_MAX = 5
const YULU_ONECLICK_GAP = 400

const autoCollect = ref(false)
const autoCollectSaving = ref(false)

const YULU_NAMES: Record<number, string> = {
  5001: '天气采集瓶',
  5002: '雷雨召唤瓶',
  5003: '闪电变异瓶',
  5004: '霹雳引雷瓶',
  5005: '青蛙使坏瓶',
  5006: '乌云使坏瓶',
  5007: '百宝惊喜瓶',
  5008: '雷纹礼盒',
  5009: '雷击木',
  5010: '黄金雷击木',
}

const YULU_RES_ICON: Record<number, string> = {
  1000: '🌦️',
  1001: '🎁',
  1002: '🐸',
  1003: '☁️',
  1004: '🌩️',
  1005: '🧪',
  1006: '⚡',
  1007: '⚡',
  1008: '🖼️',
}

interface YuluItem {
  id: number
  count: number
  name: string
  image: string
}

interface YuluTier {
  nodeId: number
  reward: string
  count: number
  cost: number
  prevs: number[]
  claimed?: boolean
  status?: number
}

interface YuluWeather {
  id: number
  name: string
  active: boolean
}

interface YuluFriend {
  gid: number
  name: string
}

const yulu = reactive({
  badge: null as number | null,
  badgeNote: '',
  badgeImage: '',
  weather: null as YuluWeather | null,
  items: {} as Record<string, YuluItem>,
  research: {
    tiers: [] as YuluTier[],
    claimed: new Set<number>(),
  },
  exchangedOn: null as string | null,
  dayTick: 0,
  friends: [] as YuluFriend[],
  allFriends: [] as YuluFriend[],
  friendsDisplayCount: 0,
  friendsPerPage: 5,
  friendsLoading: false,
  oneClickRunning: false,
  oneClickTotal: 0,
  oneClickDone: 0,
  oneClickOk: 0,
  err: '',
})

const yuluCd = ref('')
let yuluCdTimer: ReturnType<typeof setInterval> | null = null
let yuluDayTimer: ReturnType<typeof setInterval> | null = null

function n(v: unknown) {
  return v == null ? 0 : (Number(v) || 0)
}

function yuluImg(id: number) {
  return yulu.items[String(id)]?.image || ''
}

function yuluCount(id: number) {
  return n(yulu.items[String(id)]?.count)
}

function yuluName(id: number) {
  return yulu.items[String(id)]?.name || YULU_NAMES[id] || `物品${id}`
}

function yuluToday() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

const yuluExchangedToday = computed(() => {
  void yulu.dayTick
  return yulu.exchangedOn === yuluToday()
})

function yuluTick() {
  const diff = YULU_OPEN - Date.now()
  if (diff <= 0) {
    yuluCd.value = '🟢 活动已开启'
    if (yuluCdTimer) {
      clearInterval(yuluCdTimer)
      yuluCdTimer = null
    }
    return
  }
  const s = Math.floor(diff / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  yuluCd.value = `⏳ 距开启 ${String(d).padStart(2, '0')}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

async function loadYulu() {
  if (!props.accountId) return
  yulu.err = ''
  try {
    const { data } = await api.get('/api/activity/yulu', {
      headers: { 'x-account-id': props.accountId },
    })
    if (data?.ok && data.data) {
      const d = data.data
      yulu.badge = d.badge
      yulu.badgeNote = d.badgeNote || ''
      yulu.badgeImage = d.badgeImage || ''
      yulu.weather = d.weather || null
      yulu.items = d.items || {}
      const prevClaimed = yulu.research.claimed || new Set<number>()
      yulu.research.tiers = d.research?.tiers || []
      yulu.research.claimed = prevClaimed
      ;(d.research?.tiers || []).forEach((t: YuluTier) => {
        if (t.claimed) prevClaimed.add(t.nodeId)
      })
    }
  } catch {
    yulu.err = '加载失败'
  }
}

async function refreshYuluFriends() {
  yulu.friendsLoading = true
  try {
    const { data } = await api.get('/api/friends', {
      headers: { 'x-account-id': props.accountId },
    })
    const list = Array.isArray(data?.data) ? data.data : (data?.data?.friends || [])
    yulu.allFriends = list
      .filter((f: { gid?: number }) => f.gid)
      .map((f: { gid: number, name?: string, nickname?: string }) => ({
        gid: f.gid,
        name: f.name || f.nickname || String(f.gid),
      }))
    yulu.friendsDisplayCount = Math.min(yulu.friendsPerPage, yulu.allFriends.length)
    yulu.friends = yulu.allFriends.slice(0, yulu.friendsDisplayCount)
  } catch {
    toast.error('好友列表加载失败')
  }
  yulu.friendsLoading = false
}

async function syncAutoCollect() {
  if (!props.accountId) {
    autoCollect.value = false
    return
  }
  await settingStore.fetchSettings(props.accountId)
  autoCollect.value = settingStore.settings.automation?.yulu_auto_collect === true
}

async function onAutoCollectToggle(value: boolean | undefined) {
  const enabled = value === true
  autoCollect.value = enabled
  if (!props.accountId)
    return
  autoCollectSaving.value = true
  try {
    const res = await settingStore.saveSettings(props.accountId, {
      ...settingStore.settings,
      automation: {
        ...settingStore.settings.automation,
        yulu_auto_collect: enabled,
      },
    })
    if (res.ok) {
      toast.success(enabled ? '已开启雨落自动采集（每 10 分钟）' : '已关闭雨落自动采集')
    }
    else {
      toast.error(res.error || '保存失败')
      await syncAutoCollect()
    }
  }
  catch {
    toast.error('保存失败')
    await syncAutoCollect()
  }
  finally {
    autoCollectSaving.value = false
  }
}

function resetYuluFriends() {
  yulu.allFriends = []
  yulu.friends = []
  yulu.friendsDisplayCount = 0
}

function loadMoreYuluFriends() {
  if (yulu.friendsDisplayCount >= yulu.allFriends.length) return
  yulu.friendsDisplayCount = Math.min(yulu.friendsDisplayCount + yulu.friendsPerPage, yulu.allFriends.length)
  yulu.friends = yulu.allFriends.slice(0, yulu.friendsDisplayCount)
}

function onYuluFriendScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) loadMoreYuluFriends()
}

async function yuluOpen(itemId: number) {
  if (yuluCount(itemId) <= 0) {
    toast.error(`${yuluName(itemId)} 库存为空`)
    return
  }
  try {
    const { data } = await api.post('/api/activity/yulu/open', { itemId }, {
      headers: { 'x-account-id': props.accountId },
    })
    if (data?.ok) {
      toast.success(`打开成功：${yuluName(itemId)}`)
      await loadYulu()
    } else {
      toast.error(data?.error || '打开失败')
    }
  } catch {
    toast.error('打开失败')
  }
}

async function yuluMutate() {
  if (yuluCount(5003) <= 0) {
    toast.error('闪电变异瓶库存为空')
    return
  }
  try {
    const { data } = await api.post('/api/activity/yulu/mutate', {}, {
      headers: { 'x-account-id': props.accountId },
    })
    if (data?.ok) {
      const cnt = data.data?.mutateCount || 0
      if (cnt > 0) toast.success(`闪电变异 ${cnt} 块地`)
      else toast.error(data.data?.msg || '无可变异地块')
      await loadYulu()
    } else {
      toast.error(data?.error || '变异失败')
    }
  } catch {
    toast.error('变异失败')
  }
}

async function yuluUseOnce(itemId: number, friend?: YuluFriend) {
  try {
    const body: { itemId: number, hostGid?: number, friendName?: string } = { itemId }
    if (friend) {
      body.hostGid = friend.gid
      body.friendName = friend.name
    }
    const { data } = await api.post('/api/activity/yulu/use', body, {
      headers: { 'x-account-id': props.accountId },
    })
    return data
  } catch {
    return { ok: false, error: '网络错误' }
  }
}

async function yuluUse(itemId: number, friend?: YuluFriend) {
  if (yuluCount(itemId) <= 0) {
    toast.error(`${yuluName(itemId)} 库存为空`)
    return
  }
  const data = await yuluUseOnce(itemId, friend)
  if (!data) {
    toast.error('使用失败')
    return
  }
  if (data.ok) {
    const cnt = data.data?.useCount || 0
    if (cnt > 0) toast.success(`${yuluName(itemId)} 使用成功 ${cnt} 块地`)
    else toast.error(data.data?.msg || '无可作用地块')
    await loadYulu()
  } else {
    toast.error(data.error || '使用失败')
  }
}

function rsLevels() {
  const tiers = yulu.research.tiers || []
  const depth: Record<number, number> = { 1000: 0 }
  let changed = true
  let guard = 0
  while (changed && guard++ < 20) {
    changed = false
    tiers.forEach((t) => {
      const ps = t.prevs || []
      if (ps.every(p => depth[p] !== undefined)) {
        const d = Math.max(0, ...ps.map(p => (depth[p] ?? 0) + 1))
        const cur = depth[t.nodeId]
        if (cur === undefined || d > cur) {
          depth[t.nodeId] = d
          changed = true
        }
      }
    })
  }
  const max = Math.max(0, ...Object.values(depth))
  const levels: YuluTier[][] = Array.from({ length: max + 1 }, () => [])
  tiers.forEach((t) => {
    const idx = depth[t.nodeId] ?? 0
    const level = levels[idx]
    if (level)
      level.push(t)
  })
  return levels
}

function rsClaimed(nodeId: number) {
  if (yulu.research.claimed.has(nodeId)) return true
  const t = yulu.research.tiers.find(x => x.nodeId === nodeId)
  return !!(t && t.claimed)
}

function rsUnlockable(nodeId: number) {
  const t = yulu.research.tiers.find(x => x.nodeId === nodeId)
  if (!t) return false
  return (t.prevs || []).every(p => rsClaimed(p))
}

async function yuluResearch(nodeId: number) {
  try {
    const { data } = await api.post('/api/activity/yulu/research', { nodeId }, {
      headers: { 'x-account-id': props.accountId },
    })
    if (data?.ok) {
      const nm = data.data?.reward ? `${data.data.reward}×${data.data.count}` : '研究奖励'
      toast.success(`领取成功：${nm}`)
      yulu.research.claimed.add(nodeId)
      const unlocked = data.data?.unlockedNodeIds
      if (Array.isArray(unlocked)) {
        unlocked.forEach((id: number) => yulu.research.claimed.add(Number(id)))
      }
      await loadYulu()
    } else {
      toast.error(data?.error || '领取失败')
    }
  } catch {
    toast.error('领取失败')
  }
}

function rsClick(t: YuluTier) {
  if (rsClaimed(t.nodeId)) return
  if (!rsUnlockable(t.nodeId)) {
    toast.error('需先领取前置档位')
    return
  }
  yuluResearch(t.nodeId)
}

function nodeStyle(t: YuluTier) {
  if (rsClaimed(t.nodeId)) return { borderColor: '#4caf7a', opacity: 1 }
  if (!rsUnlockable(t.nodeId)) return { opacity: 0.5 }
  return { borderColor: '#6ea8ff' }
}

async function yuluExchange() {
  try {
    const { data } = await api.post('/api/activity/yulu/exchange', {}, {
      headers: { 'x-account-id': props.accountId },
    })
    if (data?.ok) {
      yulu.exchangedOn = yuluToday()
      toast.success('兑换成功：天气采集瓶 ×1')
      await loadYulu()
    } else {
      const e = data?.error || '兑换失败'
      if (e.includes('今日已兑换')) yulu.exchangedOn = yuluToday()
      toast.error(e)
    }
  } catch {
    toast.error('兑换失败')
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function yuluOneClick(kind: keyof typeof YULU_ONECLICK) {
  if (yulu.oneClickRunning) {
    toast.error('上一次一键尚未完成')
    return
  }
  if (!yulu.allFriends.length) {
    toast.error('请先点击「🔄 刷新好友」加载好友')
    return
  }
  const itemId = YULU_ONECLICK[kind]
  if (yuluCount(itemId) <= 0) {
    toast.error(`${yuluName(itemId)} 库存为空`)
    return
  }
  yulu.oneClickRunning = true
  const shuffled = yulu.allFriends.slice()
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  const target = shuffled.slice(0, YULU_ONECLICK_MAX)
  yulu.oneClickTotal = target.length
  yulu.oneClickDone = 0
  yulu.oneClickOk = 0
  let stopped = ''
  for (const f of target) {
    if (yuluCount(itemId) <= 0) {
      stopped = `${yuluName(itemId)} 已用完，停止`
      break
    }
    const data = await yuluUseOnce(itemId, f)
    yulu.oneClickDone++
    if (data?.ok) {
      const cnt = data.data?.useCount || 0
      if (cnt > 0) yulu.oneClickOk++
    }
    // 单好友失败（如无雷雨/雷雨已结束）不中断，继续尝试下一位
    await loadYulu()
    await sleep(YULU_ONECLICK_GAP)
    if (yuluCount(itemId) <= 0) {
      stopped = `${yuluName(itemId)} 已用完，停止`
      break
    }
  }
  yulu.oneClickRunning = false
  if (stopped) toast.error(stopped)
  else if (yulu.oneClickOk === 0) toast.error('一键完成：无可作用地块或使用失败')
  else toast.success(`一键完成：成功 ${yulu.oneClickOk}/${yulu.oneClickTotal} 位好友`)
}

watch(() => props.accountId, async () => {
  resetYuluFriends()
  await loadYulu()
  await syncAutoCollect()
}, { immediate: true })

onMounted(() => {
  yuluTick()
  yuluCdTimer = setInterval(yuluTick, 1000)
  yuluDayTimer = setInterval(() => { yulu.dayTick = Date.now() }, 60000)
})

onUnmounted(() => {
  if (yuluCdTimer) clearInterval(yuluCdTimer)
  if (yuluDayTimer) clearInterval(yuluDayTimer)
})

function removeImgOnError(e: Event) {
  (e.target as HTMLImageElement)?.remove()
}

defineExpose({ loadYulu })
</script>

<template>
  <section class="yulu-panel">
    <div v-if="yulu.err" class="yulu-err">
      {{ yulu.err }}
    </div>

    <div class="yulu-hero">
      <h1>🌧️ 雨落成诗</h1>
      <div class="yulu-sub">
        雷雨限定活动 · 2026-08-26 ~ 09-08 · 当前天气：{{ yulu.weather?.name || '--' }}
      </div>
      <span class="yulu-cd">{{ yuluCd }}</span>
    </div>

    <div class="yulu-chips">
      <div class="yulu-chip badge">
        <img
          v-if="yulu.badgeImage"
          class="yulu-chip-ico"
          :src="yulu.badgeImage"
          alt=""
          @error="removeImgOnError"
        >
        <div class="v">{{ yulu.badge == null ? '—' : yulu.badge }}</div>
        <div class="k">雷电徽章</div>
      </div>
      <div v-for="id in YULU_TOP" :key="id" class="yulu-chip">
        <img
          v-if="yuluImg(id)"
          class="yulu-chip-ico"
          :src="yuluImg(id)"
          alt=""
          @error="removeImgOnError"
        >
        <div class="v">{{ yuluCount(id) }}</div>
        <div class="k">{{ yuluName(id) }}</div>
      </div>
    </div>

    <div class="card">
      <div class="ttl">
        <span class="dot" />给自己用的天气瓶
      </div>
      <div v-for="id in YULU_SELF" :key="id" class="yulu-self">
        <img
          v-if="yuluImg(id)"
          class="yulu-s-ico"
          :src="yuluImg(id)"
          alt=""
          @error="removeImgOnError"
        >
        <div class="yulu-s-body">
          <div class="yulu-s-name">{{ yuluName(id) }}</div>
          <div class="muted">
            库存 <b class="good">{{ yuluCount(id) }}</b>
          </div>
          <div class="row" style="margin-top:8px">
            <button v-if="id === 5002" class="btn primary small" @click="yuluUse(5002)">
              雷雨召唤
            </button>
            <button v-else-if="id === 5003" class="btn primary small" @click="yuluMutate">
              闪电变异（自家）
            </button>
            <button v-else-if="id === 5007" class="btn gold small" @click="yuluOpen(5007)">
              打开
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="ttl ttl-row">
        <div class="ttl-main">
          <span class="dot" />好友互动 <span class="pill">雷雨好友农场</span>
        </div>
        <button
          class="btn primary refresh-friends"
          :disabled="yulu.friendsLoading || yulu.oneClickRunning"
          @click="refreshYuluFriends"
        >
          {{ yulu.friendsLoading ? '⏳ 刷新中…' : '🔄 刷新好友' }}
        </button>
      </div>
      <div class="yulu-onetabs">
        <div
          class="yulu-onetab collect"
          :class="{ busy: yulu.oneClickRunning, 'auto-on': autoCollect }"
          @click="yuluOneClick('collect')"
        >
          <div class="oi">🫧</div>一键采集
        </div>
        <div class="yulu-onetab frog" :class="{ busy: yulu.oneClickRunning }" @click="yuluOneClick('frog')">
          <div class="oi">🐸</div>一键青蛙
        </div>
        <div class="yulu-onetab cloud" :class="{ busy: yulu.oneClickRunning }" @click="yuluOneClick('cloud')">
          <div class="oi">☁️</div>一键乌云
        </div>
        <div class="yulu-onetab light" :class="{ busy: yulu.oneClickRunning }" @click="yuluOneClick('thunder')">
          <div class="oi">⚡</div>一键引雷
        </div>
      </div>
      <div class="yulu-auto-row" :class="{ saving: autoCollectSaving }">
        <BaseSwitch
          :model-value="autoCollect"
          :disabled="autoCollectSaving"
          label="自动采集"
          @update:model-value="onAutoCollectToggle"
        />
        <span class="muted yulu-auto-tip">
          开启后账号在线时每 10 分钟自动采集前 {{ YULU_ONECLICK_MAX }} 位好友；无天气采集瓶时自动停止并关闭开关。日志见首页运行日志。
        </span>
      </div>
      <div v-if="yulu.oneClickRunning" class="yulu-oc-progress">
        ⏳ 一键进行中… {{ yulu.oneClickDone }}/{{ yulu.oneClickTotal }}（成功 {{ yulu.oneClickOk }}）
      </div>
      <div class="muted yulu-friend-hint">
        一键按钮对前 {{ YULU_ONECLICK_MAX }} 位好友生效；自动采集由后台定时执行，无需停留本页
      </div>
      <div v-if="yulu.friends.length" class="yulu-flist" @scroll="onYuluFriendScroll">
        <div v-for="(f, i) in yulu.friends" :key="i" class="yulu-frow">
          <div class="yulu-av">{{ f.name[0] }}</div>
          <div style="flex:1;min-width:0">
            <div class="yulu-fnm">{{ f.name }}</div>
            <div class="st">好友农场</div>
          </div>
          <div class="yulu-fbtns">
            <button class="btn ghost small" :disabled="yulu.oneClickRunning" @click="yuluUse(5001, f)">采集</button>
            <button class="btn ghost small" :disabled="yulu.oneClickRunning" @click="yuluUse(5004, f)">引雷</button>
            <button class="btn ghost small" :disabled="yulu.oneClickRunning" @click="yuluUse(5005, f)">青蛙</button>
            <button class="btn ghost small" :disabled="yulu.oneClickRunning" @click="yuluUse(5006, f)">乌云</button>
          </div>
        </div>
        <div
          v-if="yulu.friendsDisplayCount < yulu.allFriends.length"
          class="yulu-loadmore"
          @click="loadMoreYuluFriends"
        >
          📜 下滑加载更多（{{ yulu.friendsDisplayCount }}/{{ yulu.allFriends.length }}）
        </div>
      </div>
      <div v-else class="empty">
        👥 点击「🔄 刷新好友」加载好友
      </div>
    </div>

    <div class="card">
      <div class="ttl">
        <span class="dot" />产出与奖励
      </div>
      <div v-for="id in YULU_PRODUCT" :key="id" class="yulu-self">
        <img
          v-if="yuluImg(id)"
          class="yulu-s-ico"
          :src="yuluImg(id)"
          alt=""
          @error="removeImgOnError"
        >
        <div class="yulu-s-body">
          <div class="yulu-s-name">{{ yuluName(id) }}</div>
          <div class="muted">
            库存 <b class="good">{{ yuluCount(id) }}</b>
          </div>
          <div class="row" style="margin-top:8px">
            <button v-if="id === 5008" class="btn gold small" @click="yuluOpen(5008)">
              打开
            </button>
            <span v-else class="pill warn">产物 · 暂不支持一键出售</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="ttl">
        <span class="dot" />气象研究
        <span class="pill float-right">⚡ 雷电徽章 {{ yulu.badge ?? 0 }}</span>
      </div>
      <div class="muted" style="margin:0 0 8px">
        每档需先把前置档位领取后才解锁，点击档位解锁兑换奖励。
      </div>
      <div class="rs-scroll">
        <template v-for="(lv, li) in rsLevels()" :key="li">
          <div v-if="li > 0" class="rs-arrow">➜</div>
          <div class="rs-col">
            <button
              v-for="t in lv"
              :key="t.nodeId"
              class="rs-node"
              :style="nodeStyle(t)"
              @click="rsClick(t)"
            >
              <span class="rs-icon">{{ YULU_RES_ICON[t.nodeId] || '🎁' }}</span>
              <b class="rs-reward">{{ t.reward }}</b>
              <span class="rs-count">×{{ t.count }}</span>
              <span v-if="rsClaimed(t.nodeId)" class="rs-status good">✅ 已领取</span>
              <span v-else-if="!rsUnlockable(t.nodeId)" class="rs-status muted">🔒 未解锁</span>
              <span v-else class="rs-status primary">⚡{{ t.cost }} 解锁</span>
            </button>
          </div>
        </template>
      </div>
      <div class="muted" style="margin:8px 0 0;font-size:11.5px">
        使用天气瓶 / 收获闪电变异作物得雷电徽章，推进研究领奖；天气瓶活动结束后可出售换金币。
      </div>
    </div>

    <div class="card">
      <div class="ttl">
        <span class="dot" />兑换收集天气瓶
      </div>
      <div class="exchange-row">
        <div class="exchange-icon">
          <span class="exchange-emoji">🌦️</span>
          <b class="exchange-label">天气采集瓶</b>
        </div>
        <div class="exchange-info">
          <div class="exchange-title">
            消耗 <b class="warn">金豆 ×200</b> → 天气采集瓶 ×1
          </div>
          <div class="muted" style="font-size:11px">
            每自然日限兑 1 个，兑换后可在好友雷雨农场使用。
          </div>
        </div>
      </div>
      <div class="act-actions">
        <button
          class="btn primary block"
          :disabled="yuluExchangedToday"
          :style="yuluExchangedToday ? { opacity: .6 } : {}"
          @click="yuluExchange"
        >
          {{ yuluExchangedToday ? '✅ 今日已兑换 · 0点后恢复' : '💰 兑换天气采集瓶（金豆×200）' }}
        </button>
      </div>
    </div>

    <details class="rules">
      <summary>📜 活动说明</summary>
      <ol>
        <li>雷雨天气下，作物可<b>闪电变异</b>（1/2 品除外），变异后售价 ×4。</li>
        <li>完成「使用天气采集瓶 / 雷雨召唤瓶 / 收获闪电变异作物」得<b>雷电徽章</b>，推进气象研究领奖。</li>
        <li>天气采集瓶去<b>雷雨好友农场</b>使用，必得雷雨召唤瓶 ×1。</li>
        <li>雷雨召唤瓶：自己农场召唤 20 分钟雷雨。</li>
        <li>霹雳引雷瓶 / 青蛙使坏瓶 / 乌云使坏瓶：在<b>好友农场</b>使用触发互动（引雷双方得雷纹礼盒、使坏得经验）。</li>
        <li>天气瓶限时，活动结束后可出售换金币。</li>
      </ol>
      <div class="muted" style="margin-top:8px;font-size:11.5px">
        数据芯片实时读背包；雷电徽章与气象研究档位待 8/26 开服抓包回填。
      </div>
    </details>
  </section>
</template>

<style scoped>
.yulu-panel {
  --card: var(--theme-glass, var(--surface-1));
  --border: var(--theme-border, var(--surface-border));
  --foreground: var(--theme-text);
  --muted: var(--muted-text);
  --primary: var(--theme-primary);
  --primary-2: var(--theme-secondary);
  --primary-soft: color-mix(in srgb, var(--theme-primary) 14%, transparent);
  --good: #10b981;
  --warn: #f59e0b;
  --on-primary: #fff;
}

.yulu-err {
  margin-bottom: 12px;
  border-radius: 12px;
  background: rgb(254 226 226);
  padding: 12px 16px;
  font-size: 13px;
  color: rgb(185 28 28);
}

.dark .yulu-err {
  background: rgb(127 29 29 / 0.25);
  color: rgb(252 165 165);
}

.yulu-hero {
  background: linear-gradient(135deg, #3194CB 0%, #1f5e9e 55%, #2a3f8f 100%);
  color: #fff;
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 14px;
}

.dark .yulu-hero {
  background: linear-gradient(135deg, #1c5a82 0%, #143f6e 55%, #1d2c63 100%);
}

.yulu-hero h1 {
  font-size: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.yulu-sub {
  opacity: 0.92;
  font-size: 13px;
  margin-top: 6px;
}

.yulu-cd {
  display: inline-block;
  margin-top: 10px;
  background: rgba(255, 255, 255, 0.22);
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.yulu-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.yulu-chip {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 4px;
  text-align: center;
}

.yulu-chip.badge {
  background: linear-gradient(135deg, rgba(49, 148, 203, 0.22), rgba(207, 255, 0, 0.10));
  border-color: rgba(49, 148, 203, 0.4);
}

.yulu-chip .v {
  font-size: 17px;
  font-weight: 800;
  color: var(--primary-2);
  font-variant-numeric: tabular-nums;
}

.yulu-chip .k {
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 3px;
  line-height: 1.2;
}

.yulu-chip-ico {
  width: 24px;
  height: 24px;
  object-fit: contain;
  margin: 0 auto 4px;
  display: block;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
  backdrop-filter: blur(12px);
}

.ttl {
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 12px;
}

.ttl-row {
  justify-content: space-between;
  gap: 12px;
}

.ttl-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.refresh-friends {
  flex-shrink: 0;
  padding: 10px 16px;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--primary) 28%, transparent);
}

.refresh-friends:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.yulu-friend-hint {
  margin: 0 0 8px;
  font-size: 12px;
}

.yulu-auto-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--primary) 8%, var(--card));
}

.yulu-auto-row.saving {
  opacity: 0.7;
  pointer-events: none;
}

.yulu-auto-tip {
  flex: 1;
  min-width: 180px;
  font-size: 11.5px;
  line-height: 1.4;
}

.ttl .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}

.pill {
  display: inline-block;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 700;
  color: var(--good);
}

.pill.warn {
  background: none;
  color: var(--warn);
  border-color: var(--warn);
}

.pill.float-right {
  margin-left: auto;
  margin-top: 2px;
}

.btn {
  border: none;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn.primary {
  background: var(--primary);
  color: var(--on-primary);
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.ghost {
  background: var(--primary-soft);
  color: var(--primary);
}

.btn.gold {
  background: var(--warn);
  color: #fff;
}

.btn.block {
  width: 100%;
}

.btn.small {
  padding: 6px 12px;
  font-size: 11px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.muted {
  color: var(--muted);
  font-size: 12.5px;
}

.good {
  color: var(--good);
}

.warn {
  color: var(--warn);
}

.st {
  font-size: 11px;
  color: var(--muted);
}

.empty {
  text-align: center;
  padding: 14px;
  color: var(--muted);
  font-size: 12.5px;
}

.yulu-self {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
}

.yulu-self:last-child {
  border-bottom: none;
}

.yulu-s-ico {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.14);
  object-fit: contain;
  flex-shrink: 0;
}

.yulu-s-body {
  flex: 1;
  min-width: 0;
}

.yulu-s-name {
  font-size: 13.5px;
  font-weight: 700;
}

.yulu-onetabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
  margin: 4px 0 12px;
}

.yulu-onetab {
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 9px 2px;
  text-align: center;
  cursor: pointer;
  background: var(--card);
  color: var(--foreground);
  font-size: 12px;
  font-weight: 700;
}

.yulu-onetab .oi {
  width: 22px;
  height: 22px;
  line-height: 22px;
  font-size: 16px;
  margin: 0 auto 2px;
}

.yulu-onetab.collect {
  background: linear-gradient(135deg, rgba(49, 148, 203, 0.22), rgba(49, 148, 203, 0.08));
  border-color: rgba(49, 148, 203, 0.35);
}

.yulu-onetab.collect.auto-on {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent);
}

.yulu-onetab.frog {
  background: linear-gradient(135deg, rgba(79, 208, 127, 0.20), rgba(79, 208, 127, 0.07));
  border-color: rgba(79, 208, 127, 0.35);
}

.yulu-onetab.cloud {
  background: linear-gradient(135deg, rgba(142, 162, 200, 0.22), rgba(142, 162, 200, 0.07));
  border-color: rgba(142, 162, 200, 0.35);
}

.yulu-onetab.light {
  background: linear-gradient(135deg, rgba(207, 255, 0, 0.18), rgba(207, 255, 0, 0.06));
  border-color: rgba(207, 255, 0, 0.3);
}

.yulu-onetab.busy {
  opacity: 0.55;
  cursor: progress;
  pointer-events: none;
}

.yulu-oc-progress {
  font-size: 12px;
  color: var(--primary);
  margin: 0 0 8px;
  font-weight: 600;
}

.yulu-flist {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  max-height: 360px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.yulu-loadmore {
  text-align: center;
  padding: 10px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  border-top: 1px solid var(--border);
}

.yulu-frow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.yulu-av {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary-2), var(--primary));
  color: var(--on-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  flex: none;
}

.yulu-fnm {
  font-size: 13.5px;
  font-weight: 600;
}

.yulu-fbtns {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.yulu-fbtns .btn {
  padding: 5px 8px;
  font-size: 11px;
}

.rs-scroll {
  display: flex;
  flex-direction: row;
  align-items: center;
  overflow-x: auto;
  padding-bottom: 2px;
}

.rs-arrow {
  color: var(--muted);
  padding: 0 4px;
  font-size: 13px;
  flex-shrink: 0;
}

.rs-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.rs-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 76px;
  padding: 7px 4px;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--card);
  cursor: pointer;
  color: inherit;
}

.rs-icon {
  font-size: 22px;
  line-height: 1;
}

.rs-reward {
  font-size: 10px;
  color: var(--foreground);
  margin-top: 3px;
}

.rs-count {
  font-size: 9px;
  color: var(--good);
  margin-top: 2px;
}

.rs-status {
  font-size: 9px;
  margin-top: 3px;
}

.rs-status.good {
  color: var(--good);
}

.rs-status.muted {
  color: var(--muted);
}

.rs-status.primary {
  color: var(--primary);
}

.exchange-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0 8px;
}

.exchange-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 14px;
  background: var(--card);
  border: 1.5px solid var(--border);
  flex-shrink: 0;
}

.exchange-emoji {
  font-size: 26px;
  line-height: 1;
}

.exchange-label {
  font-size: 10px;
  color: var(--foreground);
  margin-top: 4px;
}

.exchange-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.exchange-title {
  font-size: 12.5px;
  color: var(--foreground);
}

.act-actions {
  margin-top: 4px;
}

.rules {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
  backdrop-filter: blur(12px);
}

.rules summary {
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  list-style: none;
}

.rules summary::-webkit-details-marker {
  display: none;
}

.rules ol {
  margin: 10px 0 0 18px;
  font-size: 12.5px;
  color: var(--foreground);
  padding: 0;
}

@media (max-width: 640px) {
  .yulu-chips {
    grid-template-columns: repeat(2, 1fr);
  }

  .yulu-onetabs {
    grid-template-columns: repeat(2, 1fr);
  }

  .yulu-frow {
    flex-wrap: wrap;
  }

  .yulu-fbtns {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
