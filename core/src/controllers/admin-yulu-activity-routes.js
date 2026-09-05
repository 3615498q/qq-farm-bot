const {
  getAuthorizedAccountId,
  requireConnectedAccount,
} = require('./admin-activity-route-helpers');

function registerAdminYuluActivityRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    getAccountIdFromRequest,
    canAccessAccount,
  };

  app.get('/api/activity/yulu', async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;
    try {
      if (!requireConnectedAccount(res, provider, accountId, '获取雨落成诗状态失败: 账号未运行')) return;
      const data = await provider.getYuluStatus(accountId);
      res.json({ ok: true, account: accountId, data });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post('/api/activity/yulu/open', async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;
    const itemId = Number(req.body?.itemId) || 0;
    if (!itemId) {
      res.json({ ok: false, error: '缺少 itemId' });
      return;
    }
    try {
      if (!requireConnectedAccount(res, provider, accountId, '开箱失败: 账号未运行')) return;
      const result = await provider.openYuluItem(accountId, itemId);
      res.json({ ok: true, account: accountId, ...result });
    } catch (err) {
      res.json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/activity/yulu/mutate', async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;
    try {
      if (!requireConnectedAccount(res, provider, accountId, '闪电变异失败: 账号未运行')) return;
      const data = await provider.mutateYulu(accountId);
      res.json({ ok: true, account: accountId, data });
    } catch (err) {
      res.json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/activity/yulu/use', async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;
    const itemId = Number(req.body?.itemId) || 0;
    const hostGid = Number(req.body?.hostGid) || 0;
    const landIds = Array.isArray(req.body?.landIds) ? req.body.landIds : [];
    if (!itemId) {
      res.json({ ok: false, error: '缺少 itemId' });
      return;
    }
    try {
      const auto = !!req.body?.auto;
      const friendName = String(req.body?.friendName || '').trim();
      if (!requireConnectedAccount(res, provider, accountId, '使用天气瓶失败: 账号未运行')) return;
      const data = await provider.useYuluItem(accountId, itemId, hostGid, landIds, {
        auto,
        friendName,
      });
      res.json({ ok: true, account: accountId, data });
    } catch (err) {
      res.json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/activity/yulu/research', async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;
    const nodeId = Number(req.body?.nodeId) || 0;
    if (!nodeId) {
      res.json({ ok: false, error: '缺少 nodeId' });
      return;
    }
    try {
      if (!requireConnectedAccount(res, provider, accountId, '气象研究领取失败: 账号未运行')) return;
      const data = await provider.claimYuluResearch(accountId, nodeId);
      res.json({ ok: true, account: accountId, data });
    } catch (err) {
      res.json({ ok: false, error: err.message || String(err), nodeId });
    }
  });

  app.post('/api/activity/yulu/exchange', async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;
    try {
      if (!requireConnectedAccount(res, provider, accountId, '兑换天气瓶失败: 账号未运行')) return;
      const data = await provider.exchangeYuluBottle(accountId);
      res.json({ ok: true, account: accountId, data });
    } catch (err) {
      res.json({ ok: false, error: err.message || String(err) });
    }
  });
}

module.exports = { registerAdminYuluActivityRoutes };
