const { log, logWarn } = require('../utils/utils');
const { isAutomationOn, setAutomation } = require('../models/store');
const { runYuluAutoCollectBatch } = require('./yulu-activity');

const YULU_AUTO_COLLECT_INTERVAL_MS = 10 * 60 * 1000;

let yuluAutoCollectTimer = null;
let yuluAutoCollectRunning = false;

function getAccountId() {
  return String(process.env.FARM_ACCOUNT_ID || '').trim();
}

function isYuluAutoCollectOn(accountId) {
  return isAutomationOn('yulu_auto_collect', accountId || getAccountId());
}

function stopYuluAutoCollectTimer() {
  if (yuluAutoCollectTimer) {
    clearInterval(yuluAutoCollectTimer);
    yuluAutoCollectTimer = null;
  }
}

function disableYuluAutoCollect(reason) {
  const accountId = getAccountId();
  if (!accountId) return;
  if (isYuluAutoCollectOn(accountId)) {
    setAutomation('yulu_auto_collect', false, accountId);
  }
  stopYuluAutoCollectTimer();
  log('雨落', `自动采集已停止：${reason}`, {
    module: 'activity',
    event: 'yulu_auto_collect',
    result: 'stop',
    reason,
  });
}

async function checkYuluAutoCollectOnce() {
  const accountId = getAccountId();
  if (!isYuluAutoCollectOn(accountId)) return;
  if (yuluAutoCollectRunning) {
    log('雨落', '自动采集跳过：上一轮尚未完成', {
      module: 'activity',
      event: 'yulu_auto_collect',
      result: 'skip',
    });
    return;
  }

  yuluAutoCollectRunning = true;
  try {
    const result = await runYuluAutoCollectBatch({ auto: true });
    if (result.stoppedNoBottle) {
      disableYuluAutoCollect('天气采集瓶已用完');
      return;
    }
    if (result.ok > 0) {
      log('雨落', `自动采集完成：成功 ${result.ok}/${result.total} 位好友`, {
        module: 'activity',
        event: 'yulu_auto_collect',
        result: 'ok',
        ok: result.ok,
        total: result.total,
      });
      return;
    }
    if (result.total > 0) {
      logWarn('雨落', `自动采集完成：无可作用地块或使用失败（${result.total} 位好友）`, {
        module: 'activity',
        event: 'yulu_auto_collect',
        result: 'empty',
        total: result.total,
      });
    }
  } catch (err) {
    logWarn('雨落', `自动采集失败: ${err.message || err}`, {
      module: 'activity',
      event: 'yulu_auto_collect',
      result: 'error',
      error: err.message || String(err),
    });
  } finally {
    yuluAutoCollectRunning = false;
  }
}

function startYuluAutoCollectTimer() {
  stopYuluAutoCollectTimer();
  if (!isYuluAutoCollectOn()) return;

  checkYuluAutoCollectOnce();
  yuluAutoCollectTimer = setInterval(() => {
    checkYuluAutoCollectOnce();
  }, YULU_AUTO_COLLECT_INTERVAL_MS);

  log('雨落', `自动采集定时器已启动，间隔 ${YULU_AUTO_COLLECT_INTERVAL_MS / 60000} 分钟`, {
    module: 'activity',
    event: 'yulu_auto_collect',
    result: 'start',
    intervalMinutes: YULU_AUTO_COLLECT_INTERVAL_MS / 60000,
  });
}

function syncYuluAutoCollectTimer() {
  if (isYuluAutoCollectOn()) startYuluAutoCollectTimer();
  else stopYuluAutoCollectTimer();
}

module.exports = {
  YULU_AUTO_COLLECT_INTERVAL_MS,
  startYuluAutoCollectTimer,
  stopYuluAutoCollectTimer,
  syncYuluAutoCollectTimer,
  checkYuluAutoCollectOnce,
  isYuluAutoCollectOn,
};
