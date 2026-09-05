function requireCurrentUser(req, res) {
  const currentUser = req.currentUser;
  if (!currentUser) {
    res.status(401).json({ ok: false, error: "未登录" });
    return null;
  }
  return currentUser;
}

function registerAdminCurrentUserRoutes({
  app,
  requireAdminToken,
  requireAdminRole,
  userStore,
  store,
}) {
  app.get("/api/user/me", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      res.json({
        ok: true,
        data: {
          username: currentUser.username,
          role: currentUser.role,
          card: currentUser.card,
          accountLimit:
            currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/user/wxlogin-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const currentUser = requireCurrentUser(req, res);
        if (!currentUser) return;

        const config = store.setGlobalWxConfig(req.body || {});
        res.json({ ok: true, config });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/user/wxlogin-config", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const config = store.getGlobalWxConfig();
      const isAdmin =
        currentUser.role === "admin" || currentUser.role === "super_admin";
      // 普通用户只需知道服务是否可用，不暴露接口地址与 Token
      if (!isAdmin) {
        res.json({
          ok: true,
          config: {
            enabled: config.enabled !== false,
            autoReconnect: config.autoReconnect === true,
            reconnectDelayMin: config.reconnectDelayMin || 5,
            reconnectMaxAttempts: config.reconnectMaxAttempts || 3,
            userIsolation: config.userIsolation !== false,
            autoAddAccount: config.autoAddAccount !== false,
            serverManaged: true,
          },
        });
        return;
      }

      res.json({ ok: true, config });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/user/device-protocol", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const config = store.setUserDeviceProtocol(
        req.body || {},
        currentUser.username,
      );
      res.json({ ok: true, config });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/user/device-protocol", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      res.json({
        ok: true,
        config: store.getUserDeviceProtocol(currentUser.username),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminCurrentUserRoutes };
