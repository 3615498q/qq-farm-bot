/**
 * 雨落成诗（WeatherBottleUI）活动服务
 * 对标 QQ-farm-BOT-GO/activity_yulu.go
 */
const protobuf = require('protobufjs');
const { PlantPhase } = require('../config/config');
const { getItemImageById } = require('../config/gameConfig');
const { enterFriendFarm, leaveFriendFarm } = require('./friend-api');
const { getBag, getBagItems } = require('./warehouse');
const { operateActivity, getActivityGroup } = require('./activity');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, toTimeSec, getServerTimeSec, sleep, log, logWarn } = require('../utils/utils');
const { getFriendsList } = require('./friend');

const YULU_ITEM_COLLECT = 5001;
const YULU_ITEM_SUMMON = 5002;
const YULU_ITEM_MUTATE = 5003;
const YULU_ITEM_THUNDER = 5004;
const YULU_ITEM_FROG = 5005;
const YULU_ITEM_CLOUD = 5006;
const YULU_ITEM_SURPRISE = 5007;
const YULU_ITEM_GIFT_BOX = 5008;
const YULU_ITEM_WOOD = 5009;
const YULU_ITEM_GOLD_WOOD = 5010;

const YULU_ALL_ITEM_IDS = [
  YULU_ITEM_COLLECT, YULU_ITEM_SUMMON, YULU_ITEM_MUTATE, YULU_ITEM_THUNDER,
  YULU_ITEM_FROG, YULU_ITEM_CLOUD, YULU_ITEM_SURPRISE, YULU_ITEM_GIFT_BOX,
  YULU_ITEM_WOOD, YULU_ITEM_GOLD_WOOD,
];

const YULU_RESEARCH_NODE_ID = 2026070304;
const YULU_RESEARCH_CMD = 40;
const YULU_RESEARCH_EXT_FIELD = 140;
const YULU_BADGE_ID = 1027;

const YULU_EXCH_NODE = 2026070301;
const YULU_EXCH_CMD = 1;
const YULU_EXCH_SLOT = 200;

const YULU_TASK_NODE_ID = 2026070303;
const YULU_TASK_CMD = 9;
const YULU_TASK_EXT_FIELD = 107;
const YULU_GROUP_ROOT_ID = 2026070300;

const YULU_ONECLICK_MAX = 5;
const YULU_ONECLICK_GAP = 400;

const YULU_ITEM_NAME = {
  [YULU_ITEM_COLLECT]: '天气采集瓶',
  [YULU_ITEM_SUMMON]: '雷雨召唤瓶',
  [YULU_ITEM_MUTATE]: '闪电变异瓶',
  [YULU_ITEM_THUNDER]: '霹雳引雷瓶',
  [YULU_ITEM_FROG]: '青蛙使坏瓶',
  [YULU_ITEM_CLOUD]: '乌云使坏瓶',
  [YULU_ITEM_SURPRISE]: '百宝惊喜瓶',
  [YULU_ITEM_GIFT_BOX]: '雷纹礼盒',
  [YULU_ITEM_WOOD]: '雷击木',
  [YULU_ITEM_GOLD_WOOD]: '黄金雷击木',
};

const YULU_RESEARCH_TREE = [
  { nodeId: 1000, rewardId: YULU_ITEM_COLLECT, reward: '天气采集瓶', count: 1, cost: 20, prevs: [] },
  { nodeId: 1001, rewardId: 100003, reward: '化肥礼包', count: 5, cost: 40, prevs: [1000] },
  { nodeId: 1002, rewardId: YULU_ITEM_FROG, reward: '青蛙使坏瓶', count: 20, cost: 40, prevs: [1001] },
  { nodeId: 1003, rewardId: YULU_ITEM_CLOUD, reward: '乌云使坏瓶', count: 20, cost: 40, prevs: [1001] },
  { nodeId: 1004, rewardId: YULU_ITEM_SUMMON, reward: '雷雨召唤瓶', count: 1, cost: 60, prevs: [1002] },
  { nodeId: 1005, rewardId: 80013, reward: '有机化肥(8小时)', count: 3, cost: 60, prevs: [1003] },
  { nodeId: 1006, rewardId: 4002, reward: '闪电感应', count: 1, cost: 80, prevs: [1004] },
  { nodeId: 1007, rewardId: 4003, reward: '闪电感应', count: 1, cost: 80, prevs: [1005] },
  { nodeId: 1008, rewardId: 2159, reward: '头像框', count: 1, cost: 100, prevs: [1006, 1007] },
];

function yuluItemNameOf(id) {
  return YULU_ITEM_NAME[id] || `物品${id}`;
}

function bagLookup(br, id) {
  const items = getBagItems(br);
  for (const it of items) {
    if (toNum(it.id) === id) {
      return { count: toNum(it.count), uid: toNum(it.uid) };
    }
  }
  return { count: 0, uid: 0 };
}

function appendVarintBytes(v) {
  const buf = [];
  let n = BigInt(v);
  while (n >= 0x80n) {
    buf.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  buf.push(Number(n));
  return Buffer.from(buf);
}

function readProtoFields(rawBytes) {
  const buf = Buffer.from(rawBytes || []);
  const reader = protobuf.Reader.create(buf);
  const entries = [];
  while (reader.pos < reader.len) {
    let tag = 0;
    try {
      tag = reader.uint32();
    } catch {
      break;
    }
    const field = tag >>> 3;
    const wire = tag & 0x7;
    try {
      if (wire === 0) {
        entries.push({ field, wire, value: toNum(reader.uint64()) });
      } else if (wire === 2) {
        entries.push({ field, wire, value: Buffer.from(reader.bytes()) });
      } else if (wire === 5) {
        entries.push({ field, wire, value: reader.uint32() });
      } else if (wire === 1) {
        entries.push({ field, wire, value: reader.fixed64() });
      } else {
        reader.skipType(wire);
      }
    } catch {
      break;
    }
  }
  return entries;
}

function getProtoNumber(entries, field, fallback = 0) {
  const hit = (entries || []).find((entry) => entry.field === field && entry.wire === 0);
  return hit ? toNum(hit.value) : fallback;
}

function getProtoBytes(entries, field) {
  const hit = (entries || []).find((entry) => entry.field === field && entry.wire === 2);
  return hit ? Buffer.from(hit.value || []) : null;
}

function getProtoBytesAll(entries, field) {
  return (entries || [])
    .filter((entry) => entry.field === field && entry.wire === 2)
    .map((entry) => Buffer.from(entry.value || []));
}

function encodeUsePlain(itemId, count, uid = 0) {
  const writer = protobuf.Writer.create();
  writer.uint32(10).fork();
  writer.uint32(8).int64(toLong(itemId));
  writer.uint32(16).int64(toLong(count));
  if (uid > 0) writer.uint32(48).int64(toLong(uid));
  writer.ldelim();
  return writer.finish();
}

function encodeUseWithTarget(itemId, count, uid, hostGid, landId) {
  const writer = protobuf.Writer.create();
  const item = protobuf.Writer.create();
  item.uint32(8).int64(toLong(itemId));
  item.uint32(16).int64(toLong(count));
  if (uid > 0) item.uint32(48).int64(toLong(uid));
  writer.uint32(10).bytes(item.finish());

  const target = protobuf.Writer.create();
  target.uint32(8).int64(toLong(hostGid));
  target.uint32(18).bytes(appendVarintBytes(landId));
  writer.uint32(18).bytes(target.finish());

  return writer.finish();
}

function encodeResearchOperate(nodeId) {
  const writer = protobuf.Writer.create();
  writer.uint32(8).int64(toLong(YULU_RESEARCH_NODE_ID));
  writer.uint32(16).int64(toLong(YULU_RESEARCH_CMD));
  writer.uint32((YULU_RESEARCH_EXT_FIELD << 3) | 2).fork();
  writer.uint32(8).int64(toLong(nodeId));
  writer.ldelim();
  return writer.finish();
}

function encodeWeatherCollectOperate(hostGid) {
  const writer = protobuf.Writer.create();
  writer.uint32(8).int64(toLong(YULU_TASK_NODE_ID));
  writer.uint32(16).int64(toLong(YULU_TASK_CMD));
  writer.uint32((YULU_TASK_EXT_FIELD << 3) | 2).fork();
  writer.uint32(24).int64(toLong(hostGid));
  writer.ldelim();
  return writer.finish();
}

function parseItemMessage(rawBytes) {
  const entries = readProtoFields(rawBytes);
  const id = getProtoNumber(entries, 1);
  const count = getProtoNumber(entries, 2);
  if (id <= 0) return null;
  return { id, count };
}

function decodeYuluTaskResult(body) {
  const res = getProtoBytes(readProtoFields(body), 108);
  if (!res) return { gained: null, consumed: null };
  let gained = null;
  let consumed = null;
  for (const entry of readProtoFields(res)) {
    if (entry.wire !== 2) continue;
    if (entry.field === 2) gained = parseItemMessage(entry.value);
    if (entry.field === 3) consumed = parseItemMessage(entry.value);
  }
  return { gained, consumed };
}

function yuluResearchUnlocked(body) {
  const resRaw = getProtoBytes(readProtoFields(body), 140);
  if (!resRaw) return [];
  for (const entry of readProtoFields(resRaw)) {
    if (entry.field !== 3 || entry.wire !== 2) continue;
    const out = [];
    const bytes = Buffer.from(entry.value || []);
    let i = 0;
    while (i < bytes.length) {
      let v = 0n;
      let shift = 0n;
      while (i < bytes.length) {
        const x = bytes[i++];
        v |= BigInt(x & 0x7f) << shift;
        if (x < 0x80) break;
        shift += 7n;
      }
      out.push(Number(v));
    }
    return out;
  }
  return [];
}

function yuluResearchStateFromBody(rawBody) {
  const out = {};
  const groupRaw = getProtoBytes(readProtoFields(rawBody), 1);
  if (!groupRaw) return out;

  function walk(raw) {
    const fs = readProtoFields(raw);
    const infoRaw = getProtoBytes(fs, 1);
    if (infoRaw && getProtoNumber(readProtoFields(infoRaw), 1) === YULU_RESEARCH_NODE_ID) {
      const wr = getProtoBytes(fs, 118);
      if (wr) {
        const stateRaw = getProtoBytes(readProtoFields(wr), 1);
        if (stateRaw) {
          for (const nRaw of getProtoBytesAll(readProtoFields(stateRaw), 2)) {
            const nf = readProtoFields(nRaw);
            const nid = getProtoNumber(nf, 1);
            if (nid <= 0) continue;
            out[nid] = {
              status: getProtoNumber(nf, 3),
              claimed: getProtoNumber(nf, 4) !== 0,
            };
          }
        }
      }
      return true;
    }
    for (const child of getProtoBytesAll(fs, 2)) {
      if (walk(child)) return true;
    }
    return false;
  }

  walk(groupRaw);
  return out;
}

async function yuluResearchState() {
  try {
    const reply = await getActivityGroup(YULU_GROUP_ROOT_ID, '');
    const rawBody = reply.__rawBody;
    if (!rawBody) return {};
    return yuluResearchStateFromBody(rawBody);
  } catch {
    return {};
  }
}

async function yuluGetWeather() {
  try {
    const { body } = await sendMsgAsync(
      'gamepb.weatherpb.WeatherService',
      'GetWeatherStatus',
      Buffer.alloc(0),
      12000,
    );
    const statusRaw = getProtoBytes(readProtoFields(body), 1);
    if (!statusRaw) return { id: 0, active: false };
    const st = readProtoFields(statusRaw);
    return {
      id: getProtoNumber(st, 1),
      active: getProtoNumber(st, 5) !== 0,
    };
  } catch {
    return { id: 0, active: false };
  }
}

async function requestUse(body) {
  try {
    const { body: rep } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', body, 12000);
    return types.UseReply.decode(rep);
  } catch (err) {
    const msg = String(err?.message || '');
    if (!msg.includes('code=1000020') && !msg.includes('请求参数错误')) throw err;
    return null;
  }
}

async function useItemPlain(itemId, count = 1, uid = 0) {
  let rep = await requestUse(encodeUsePlain(itemId, count, uid));
  if (!rep) {
    const request = types.UseRequest.encode(types.UseRequest.create({
      item_id: toLong(itemId),
      count: toLong(count),
    })).finish();
    const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', request, 12000);
    rep = types.UseReply.decode(body);
  }
  return rep;
}

async function useItemWithTarget(itemId, hostGid, landId, uid = 0) {
  const body = encodeUseWithTarget(itemId, 1, uid, hostGid, landId);
  await sendMsgAsync('gamepb.itempb.ItemService', 'Use', body, 12000);
}

async function getAllLandsForHost(hostGid = 0) {
  const payload = types.AllLandsRequest.encode(types.AllLandsRequest.create({
    host_gid: toLong(hostGid),
  })).finish();
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'AllLands', payload, 15000);
  return types.AllLandsReply.decode(body);
}

function getCurrentPhase(phases) {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  const now = getServerTimeSec();
  for (let i = phases.length - 1; i >= 0; i--) {
    const begin = toTimeSec(phases[i]?.begin_time);
    if (begin > 0 && begin <= now) return phases[i];
  }
  return null;
}

function yuluMutateTargets(lands) {
  const out = [];
  for (const land of lands || []) {
    const plant = land?.plant;
    if (!plant) continue;
    const ph = getCurrentPhase(plant.phases);
    if (!ph) continue;
    if (toNum(ph.phase) === PlantPhase.SEED) continue;
    if (toNum(ph.phase) === PlantPhase.DEAD) continue;
    const mutantIds = plant.mutant_config_ids || plant.mutantConfigIds || [];
    if (Array.isArray(mutantIds) && mutantIds.length > 0) continue;
    const landId = toNum(land.id);
    if (landId > 0) out.push(landId);
  }
  return out;
}

function mapActError(err) {
  const msg = String(err?.message || err || '');
  if (msg.includes('雷电徽章不足')) return '雷电徽章不足';
  if (msg.includes('节点未解锁')) return '节点未解锁（需先领取前置档位）';
  if (msg.includes('限购') || msg.includes('已兑换')) return '今日已兑换过（每自然日限兑 1 个）';
  if (msg.includes('1034041') || msg.includes('雷雨天气已结束')) {
    return '该好友雷雨天气已结束，无法采集';
  }
  if (msg.includes('不足')) return '金豆不足（需 200 金豆）';
  return msg || '操作失败';
}

function isYuluWeatherEndedError(msg) {
  const text = String(msg || '');
  return text.includes('1034041') || text.includes('雷雨天气已结束');
}

function shuffleFriends(list) {
  const shuffled = list.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function getYuluStatus() {
  const br = await getBag();
  const items = {};
  for (const id of YULU_ALL_ITEM_IDS) {
    const { count } = bagLookup(br, id);
    items[String(id)] = {
      id,
      count,
      name: yuluItemNameOf(id),
      image: getItemImageById(id) || '',
    };
  }
  const badgeCnt = bagLookup(br, YULU_BADGE_ID).count;
  const researchState = await yuluResearchState();
  const weather = await yuluGetWeather();
  const weatherName = weather.id !== 0 ? '雷雨' : '无';
  const tiers = YULU_RESEARCH_TREE.map((t) => {
    const st = researchState[t.nodeId];
    return {
      nodeId: t.nodeId,
      name: t.reward,
      reward: t.reward,
      rewardId: t.rewardId,
      count: t.count,
      cost: t.cost,
      prevs: t.prevs,
      claimed: !!st?.claimed,
      status: st?.status || 0,
    };
  });
  return {
    badge: badgeCnt,
    badgeNote: '雷电徽章：气象研究/换天气瓶消耗',
    badgeImage: getItemImageById(YULU_BADGE_ID) || '',
    weather: {
      id: weather.id,
      name: weatherName,
      active: weather.active,
    },
    items,
    research: {
      tiers,
      claimedAll: false,
      note: '',
    },
  };
}

async function openYuluItem(itemId) {
  if (itemId <= 0) throw new Error('缺少 itemId');
  await useItemPlain(itemId, 1);
  return { itemId, opened: true };
}

async function mutateYulu() {
  const br = await getBag();
  const { uid } = bagLookup(br, YULU_ITEM_MUTATE);
  if (!uid) throw new Error('背包中无闪电变异瓶(5003)或缺少实例');

  const rep = await getAllLandsForHost(0);
  const targets = yuluMutateTargets(rep.lands || []);
  if (targets.length === 0) {
    return {
      mutated: [],
      mutateCount: 0,
      msg: '无可变异地块（已排除种子/枯萎/天工）',
    };
  }

  const mutated = [];
  const errors = [];
  for (const landId of targets) {
    try {
      await useItemWithTarget(YULU_ITEM_MUTATE, 0, landId, uid);
      mutated.push(landId);
    } catch (e) {
      errors.push(`land${landId}:${e.message || e}`);
    }
    await sleep(300);
  }
  return { mutated, mutateCount: mutated.length, errors };
}

async function useYuluCollect(hostGid, options = {}) {
  const auto = !!options.auto;
  const displayName = options.friendName || `GID${hostGid}`;
  try {
    const body = await sendMsgAsync(
      'gamepb.activitypb.ActivityService',
      'Operate',
      encodeWeatherCollectOperate(hostGid),
      15000,
    ).then((r) => r.body);
    const { gained, consumed } = decodeYuluTaskResult(body);
    if (auto) {
      log('雨落', `对好友 ${displayName} 采集成功`, {
        module: 'activity',
        event: 'yulu_auto_collect',
        hostGid,
        useCount: 1,
        result: 'ok',
      });
    }
    return {
      used: [hostGid],
      useCount: 1,
      gained,
      consumed,
    };
  } catch (err) {
    throw new Error(mapActError(err));
  }
}

async function useYuluItem(itemId, hostGid = 0, landIds = [], options = {}) {
  if (itemId <= 0) throw new Error('缺少 itemId');
  const auto = !!options.auto;
  const friendName = String(options.friendName || '').trim();

  const allowed = new Set([
    YULU_ITEM_SUMMON, YULU_ITEM_COLLECT, YULU_ITEM_THUNDER,
    YULU_ITEM_FROG, YULU_ITEM_CLOUD,
  ]);
  if (!allowed.has(itemId)) {
    throw new Error(`物品 ${itemId} 不支持该接口`);
  }

  if (itemId === YULU_ITEM_SUMMON) {
    const weather = await yuluGetWeather();
    if (weather.id !== 0) {
      throw new Error('当前已有特殊天气，无法召唤雷雨');
    }
    await useItemPlain(itemId, 1);
    return { used: true, useCount: 1 };
  }

  if (!hostGid || hostGid <= 0) {
    throw new Error('好友向瓶子需指定 hostGid');
  }

  const displayName = friendName || `GID${hostGid}`;
  await enterFriendFarm(hostGid, { reason: 2 });
  try {
    if (itemId === YULU_ITEM_COLLECT) {
      return await useYuluCollect(hostGid, { auto, friendName: displayName });
    }

    const rep = await getAllLandsForHost(hostGid);
    const want = new Set((landIds || []).map(Number).filter((n) => n > 0));
    const selected = [];
    for (const land of rep.lands || []) {
      const hasCrop = land?.plant && Array.isArray(land.plant.phases) && land.plant.phases.length > 0;
      if (!hasCrop) continue;
      const id = toNum(land.id);
      if (want.size > 0 && !want.has(id)) continue;
      selected.push(id);
    }
    if (selected.length === 0) {
      const msg = '好友无可作用地块（无作物或未指定）';
      if (auto) {
        logWarn('雨落', `对好友 ${displayName} 采集：${msg}`, {
          module: 'activity',
          event: 'yulu_auto_collect',
          hostGid,
          result: 'empty',
        });
      }
      return { used: [], useCount: 0, msg };
    }

    const br = await getBag();
    const { uid } = bagLookup(br, itemId);
    const used = [];
    const errors = [];
    for (const landId of selected) {
      try {
        await useItemWithTarget(itemId, hostGid, landId, uid);
        used.push(landId);
      } catch (e) {
        errors.push(`land${landId}:${e.message || e}`);
      }
      await sleep(300);
    }
    const useCount = used.length;
    if (auto && useCount > 0) {
      log('雨落', `对好友 ${displayName} 使用成功 ${useCount} 块地`, {
        module: 'activity',
        event: 'yulu_auto_collect',
        hostGid,
        useCount,
        result: 'ok',
      });
    }
    return { used, useCount, errors };
  } finally {
    await leaveFriendFarm(hostGid);
  }
}

async function runYuluAutoCollectBatch(options = {}) {
  const auto = !!options.auto;
  let bottleCount = bagLookup(await getBag(), YULU_ITEM_COLLECT).count;
  if (bottleCount <= 0) {
    return { ok: 0, total: 0, stoppedNoBottle: true };
  }

  const friends = await getFriendsList();
  const list = shuffleFriends(
    (Array.isArray(friends) ? friends : [])
      .filter((f) => toNum(f?.gid) > 0),
  ).slice(0, YULU_ONECLICK_MAX);

  if (list.length === 0) {
    if (auto) {
      logWarn('雨落', '自动采集跳过：好友列表为空', {
        module: 'activity',
        event: 'yulu_auto_collect',
        result: 'no_friends',
      });
    }
    return { ok: 0, total: 0, stoppedNoBottle: false };
  }

  if (auto) {
    log('雨落', `自动采集开始：目标 ${list.length} 位好友，当前采集瓶 ${bottleCount} 个`, {
      module: 'activity',
      event: 'yulu_auto_collect',
      result: 'begin',
      total: list.length,
      bottleCount,
    });
  }

  let ok = 0;
  for (const f of list) {
    bottleCount = bagLookup(await getBag(), YULU_ITEM_COLLECT).count;
    if (bottleCount <= 0) {
      return { ok, total: list.length, stoppedNoBottle: true };
    }

    const gid = toNum(f.gid);
    const name = f.name || f.nickname || String(gid);
    try {
      const result = await useYuluItem(YULU_ITEM_COLLECT, gid, [], { auto, friendName: name });
      if ((result.useCount || 0) > 0) ok++;
      else if (auto) {
        logWarn('雨落', `对好友 ${name} 采集：${result.msg || '无可作用地块'}`, {
          module: 'activity',
          event: 'yulu_auto_collect',
          hostGid: gid,
          result: 'empty',
        });
      }
    } catch (err) {
      if (auto) {
        const errMsg = err.message || String(err);
        const friendly = isYuluWeatherEndedError(errMsg)
          ? '雷雨天气已结束，跳过'
          : (errMsg || '采集失败');
        logWarn('雨落', `对好友 ${name} 采集：${friendly}`, {
          module: 'activity',
          event: 'yulu_auto_collect',
          hostGid: gid,
          result: isYuluWeatherEndedError(errMsg) ? 'weather_ended' : 'error',
          error: errMsg,
        });
      }
    }
    await sleep(YULU_ONECLICK_GAP);
  }

  return { ok, total: list.length, stoppedNoBottle: false };
}

async function claimYuluResearch(nodeId) {
  const tier = YULU_RESEARCH_TREE.find((t) => t.nodeId === nodeId);
  if (!tier) throw new Error('无效的研究节点 nodeId');

  let body;
  try {
    const rep = await sendMsgAsync(
      'gamepb.activitypb.ActivityService',
      'Operate',
      encodeResearchOperate(nodeId),
      20000,
    );
    body = rep.body;
  } catch (err) {
    throw new Error(mapActError(err));
  }
  return {
    nodeId,
    reward: tier.reward,
    count: tier.count,
    unlockedNodeIds: yuluResearchUnlocked(body),
  };
}

async function exchangeYuluBottle() {
  try {
    await operateActivity(YULU_EXCH_NODE, YULU_EXCH_CMD, {
      exchangeShopOperate: { id: YULU_EXCH_SLOT, count: 1 },
    });
  } catch (err) {
    throw new Error(mapActError(err));
  }
  return {
    costItem: 1005,
    costCount: 200,
    getItem: YULU_ITEM_COLLECT,
    getCount: 1,
  };
}

module.exports = {
  getYuluStatus,
  openYuluItem,
  mutateYulu,
  useYuluItem,
  claimYuluResearch,
  exchangeYuluBottle,
  runYuluAutoCollectBatch,
  YULU_RESEARCH_TREE,
};
