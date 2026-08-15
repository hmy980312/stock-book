/* =========================================
   本地数据存储模块
   - 板块(Sector)、股票(Stock)、行情缓存
   ========================================= */

var StockDB = (function () {
  const KEYS = {
    SECTORS: 'stock_workbench_sectors',
    STOCKS: 'stock_workbench_stocks',
    QUOTES: 'stock_workbench_quotes',
    SETTINGS: 'stock_workbench_settings',
    QUOTE_CACHE_TS: 'stock_workbench_quote_ts',
    INSIGHTS: 'stock_workbench_insights'
  };

  const CACHE_EXPIRE = 10 * 60 * 1000; // 行情缓存10分钟

  /* ---------- 工具函数 ---------- */
  function uid() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('[Storage] read fail:', key, e);
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Storage] write fail:', key, e);
      return false;
    }
  }

  /* ---------- 初始化默认板块 ---------- */
  function ensureDefaultSectors() {
    const list = get(KEYS.SECTORS, null);
    if (list && list.length > 0) return list;
    const defaults = [
      { id: uid(), name: '稳稳的幸福', icon: '🏦', color: '#f7a1b9', createdAt: Date.now() },
      { id: uid(), name: '小酌怡情', icon: '🍶', color: '#ffb86b', createdAt: Date.now() },
      { id: uid(), name: '阳光赛道', icon: '⚡', color: '#8dd8c1', createdAt: Date.now() },
      { id: uid(), name: '安心持有', icon: '💊', color: '#d7b8e8', createdAt: Date.now() },
      { id: uid(), name: '心头好', icon: '💖', color: '#ff7ea8', createdAt: Date.now() }
    ];
    set(KEYS.SECTORS, defaults);
    return defaults;
  }

  /* ---------- 板块 CRUD ---------- */
  function getSectors() {
    ensureDefaultSectors();
    return get(KEYS.SECTORS, []);
  }

  function saveSector(sector) {
    const list = getSectors();
    if (sector.id) {
      const idx = list.findIndex(s => s.id === sector.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...sector };
      }
    } else {
      sector.id = uid();
      sector.createdAt = Date.now();
      list.push(sector);
    }
    set(KEYS.SECTORS, list);
    return sector;
  }

  function deleteSector(id) {
    const sectors = getSectors().filter(s => s.id !== id);
    set(KEYS.SECTORS, sectors);
    // 将该板块下的股票 sectorId 置空
    const stocks = getStocks().map(s => s.sectorId === id ? { ...s, sectorId: '' } : s);
    set(KEYS.STOCKS, stocks);
  }

  /* ---------- 股票 CRUD ---------- */
  function getStocks() {
    return get(KEYS.STOCKS, []);
  }

  function saveStock(stock) {
    const list = getStocks();
    if (stock.id) {
      const idx = list.findIndex(s => s.id === stock.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...stock, updatedAt: Date.now() };
      }
    } else {
      stock.id = uid();
      stock.createdAt = Date.now();
      stock.updatedAt = Date.now();
      list.push(stock);
    }
    set(KEYS.STOCKS, list);
    return stock;
  }

  function deleteStock(id) {
    const stocks = getStocks().filter(s => s.id !== id);
    set(KEYS.STOCKS, stocks);
  }

  function getStocksBySector(sectorId) {
    const stocks = getStocks();
    if (!sectorId || sectorId === 'all') return stocks;
    return stocks.filter(s => s.sectorId === sectorId);
  }

  /* ---------- 行情缓存 ---------- */
  function getQuotesCache() {
    const ts = get(KEYS.QUOTE_CACHE_TS, 0);
    if (Date.now() - ts > CACHE_EXPIRE) return null;
    return get(KEYS.QUOTES, null);
  }

  function setQuotesCache(quoteMap) {
    set(KEYS.QUOTES, quoteMap);
    set(KEYS.QUOTE_CACHE_TS, Date.now());
  }

  function getQuoteCacheByCode(fullCode) {
    const cache = get(KEYS.QUOTES, {});
    return cache[fullCode] || null;
  }

  /* ---------- 设置 ---------- */
  function getSettings() {
    return get(KEYS.SETTINGS, {
      refreshInterval: 300
    });
  }

  function updateSettings(patch) {
    const cur = getSettings();
    const next = { ...cur, ...patch };
    set(KEYS.SETTINGS, next);
    return next;
  }

  /* ---------- 悟道(Insight) CRUD ---------- */
  function getInsights() {
    const list = get(KEYS.INSIGHTS, []);
    // 默认按时间倒序返回（最新在前）
    return list.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }

  function saveInsight(entry) {
    const list = get(KEYS.INSIGHTS, []);
    if (entry.id) {
      const idx = list.findIndex(x => x.id === entry.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...entry, updatedAt: Date.now() };
      }
    } else {
      entry.id = uid();
      entry.createdAt = Date.now();
      entry.updatedAt = Date.now();
      list.push(entry);
    }
    set(KEYS.INSIGHTS, list);
    return entry;
  }

  function deleteInsight(id) {
    const list = get(KEYS.INSIGHTS, []).filter(x => x.id !== id);
    set(KEYS.INSIGHTS, list);
  }

  /* ---------- 导出/导入 ---------- */
  function exportAll() {
    return {
      version: 2,
      exportAt: Date.now(),
      sectors: getSectors(),
      stocks: getStocks(),
      settings: getSettings(),
      insights: getInsights()
    };
  }

  function importAll(data) {
    if (!data) return false;
    if (data.sectors) set(KEYS.SECTORS, data.sectors);
    if (data.stocks) set(KEYS.STOCKS, data.stocks);
    if (data.settings) set(KEYS.SETTINGS, { ...getSettings(), ...data.settings });
    if (data.insights) set(KEYS.INSIGHTS, data.insights);
    return true;
  }

  function clearAll() {
    [KEYS.SECTORS, KEYS.STOCKS, KEYS.QUOTES, KEYS.SETTINGS, KEYS.QUOTE_CACHE_TS, KEYS.INSIGHTS].forEach(k => {
      localStorage.removeItem(k);
    });
  }

  return {
    KEYS,
    uid,
    ensureDefaultSectors,
    // sector
    getSectors, saveSector, deleteSector,
    // stock
    getStocks, saveStock, deleteStock, getStocksBySector,
    // quote cache
    getQuotesCache, setQuotesCache, getQuoteCacheByCode,
    // settings
    getSettings, updateSettings,
    // insights (悟道)
    getInsights, saveInsight, deleteInsight,
    // import/export
    exportAll, importAll, clearAll
  };
})();
