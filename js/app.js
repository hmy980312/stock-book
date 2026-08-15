/* =========================================
   我的股票本 - 主应用逻辑（治愈粉色版）
   ========================================= */

const QUOTES = [
  { author: '沃伦·巴菲特', text: '投资的秘诀在于：当别人贪婪时恐惧，当别人恐惧时贪婪。' },
  { author: '沃伦·巴菲特', text: '复利是世界第八大奇迹，复利比原子弹更具威力。' },
  { author: '沃伦·巴菲特', text: '如果你不愿意持有一只股票十年，那你就不应该持有它十分钟。' },
  { author: '本杰明·格雷厄姆', text: '市场短期是投票器，长期是称重器。' },
  { author: '本杰明·格雷厄姆', text: '安全边际是投资成功的基石。' },
  { author: '查理·芒格', text: '要得到你想要的东西，最可靠的方法就是让自己配得上它。' },
  { author: '彼得·林奇', text: '投资你了解的公司，投资你喜欢的产品。' },
  { author: '约翰·博格', text: '投资成功的秘诀在于：保持简单，坚持到底。' },
  { author: '菲利普·费雪', text: '买好公司，并且长期持有。' },
  { author: '大卫·斯文森', text: '多元化投资是免费的午餐。' }
];

var app = (function () {
  /* ---------- 状态 ---------- */
  const state = {
    activeTab: 'stocks',
    currentSectorFilter: 'all',
    currentStockId: null,
    currentSectorId: null,
    selectedEmoji: '🏦',
    selectedColor: '#1a73e8',
    quoteMap: {},
    refreshTimer: null,
    countdownTimer: null,
    countdownSeconds: 300,
    deferredPrompt: null,
    _initFired: false,
    // 交易策略相关
    strategy: {
      style: null,           // 'left' or 'right'
      stockId: null,         // 选中的股票id
      stockCode: null,       // 完整代码
      kline: { closes: [], volumes: [], highs: [], lows: [], opens: [], dates: [] },
      finance: { pe: 0, pb: 0, eps: 0, totalMv: 0, reasonablePrice: 0 }
    },
    // 悟道(Insight)相关
    insight: {
      editingId: null,
      selectedMood: '🧘',
      searchKeyword: '',
      moodFilter: 'all'
    }
  };

  /* ==================== 启动 ==================== */
  function init() {
    if (state._initFired) return;
    state._initFired = true;
    try {
      // 启动页名言
      const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      const sq = document.getElementById('splashQuote');
      if (sq) sq.textContent = '「' + q.text + '」—— ' + q.author;

      // 默认板块（防空：StockDB 未加载全时跳过）
      if (typeof StockDB !== 'undefined' && typeof StockDB.ensureDefaultSectors === 'function') {
        StockDB.ensureDefaultSectors();
      }

      // 绑定事件
      bindEvents();

      // 读取缓存行情 + 初次渲染
      state.quoteMap = (StockDB && StockDB.getQuotesCache && StockDB.getQuotesCache()) || {};
      renderAll();

      // 首次刷新
      Promise.resolve().then(() => refreshAllQuotes()).then(() => {
        setTimeout(hideSplash, 300);
      }).catch(() => {});
      setTimeout(hideSplash, 1800); // 最长展示1.8s

      // 自动刷新
      try { setupAutoRefresh(); } catch (e) { console.warn('autoRefresh init fail', e); }

      // PWA 安装提示
      try { setupInstallPrompt(); } catch (e) { console.warn('install prompt init fail', e); }

      // URL参数
      try {
        const url = new URL(location.href);
        if (url.searchParams.get('action') === 'add') {
          setTimeout(openAddStockModal, 600);
        }
      } catch (e) { /* ignore URL parse errors */ }
    } catch (e) {
      console.error('[app.init] FATAL ERROR:', e);
      // 展示到页面上，不要白白屏
      try { hideSplash(); } catch (_) {}
      try {
        document.body.insertAdjacentHTML('afterbegin',
          '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fff0f5;padding:20px">' +
            '<div style="max-width:480px;text-align:center;color:#c0392b">' +
              '<div style="font-size:48px;margin-bottom:12px">⚠️</div>' +
              '<div style="font-size:18px;font-weight:700;margin-bottom:8px">启动遇到小问题</div>' +
              '<div style="font-size:13px;white-space:pre-wrap;font-family:monospace">' +
                (e && e.message ? e.message : String(e)) +
              '</div>' +
            '</div>' +
          '</div>');
      } catch (_) {}
    }
  }

  function hideSplash() {
    const s = document.getElementById('splash');
    if (s && !s.classList.contains('hide')) s.classList.add('hide');
  }

  /* ==================== 事件绑定 ==================== */
  function bindEvents() {
    // Tab
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // 顶部按钮
    document.getElementById('refreshBtn').addEventListener('click', () => refreshAllQuotes(true));
    document.getElementById('addStockBtn').addEventListener('click', openAddStockModal);

    // 板块筛选（事件委托）
    document.getElementById('sectorFilter').addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-tag')) {
        document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        state.currentSectorFilter = e.target.dataset.sector;
        renderStockList();
      }
    });

    // 股票列表点击（事件委托）
    document.getElementById('stockList').addEventListener('click', (e) => {
      const card = e.target.closest('.stock-card');
      if (card && card.dataset.id) {
        openDetailModal(card.dataset.id);
      }
    });

    // 安装提示
    document.getElementById('dismissInstall').addEventListener('click', () => {
      document.getElementById('installPrompt').classList.add('hidden');
    });
    document.getElementById('installBtn').addEventListener('click', installApp);

    // 设置 - 刷新间隔
    document.getElementById('refreshInterval').addEventListener('change', (e) => {
      StockDB.updateSettings({ refreshInterval: parseInt(e.target.value, 10) || 0 });
      setupAutoRefresh();
    });

    // 设置 - 导入
    document.getElementById('importFile').addEventListener('change', handleImport);

    // Emoji 选择
    document.querySelectorAll('#emojiPicker .emoji-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#emojiPicker .emoji-opt').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        state.selectedEmoji = el.textContent;
      });
    });

    // 颜色选择
    document.querySelectorAll('#colorPicker .color-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#colorPicker .color-opt').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        state.selectedColor = el.style.background;
      });
    });

    // 悟道 - 心情选择（弹窗里）
    document.querySelectorAll('#moodPicker .mood-opt').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#moodPicker .mood-opt').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        state.insight.selectedMood = el.dataset.val || el.textContent.trim().charAt(0) || '🧘';
      });
    });

    // 悟道 - 搜索
    document.getElementById('insightSearch').addEventListener('input', (e) => {
      state.insight.searchKeyword = (e.target.value || '').trim();
      renderInsightList();
    });

    // 悟道 - 心情筛选
    document.getElementById('insightMoodFilter').addEventListener('click', (e) => {
      const chip = e.target.closest('.mood-chip');
      if (!chip) return;
      document.querySelectorAll('#insightMoodFilter .mood-chip').forEach(x => x.classList.remove('active'));
      chip.classList.add('active');
      state.insight.moodFilter = chip.dataset.mood;
      renderInsightList();
    });

    // 悟道 - 列表事件委托（编辑/删除）
    document.getElementById('insightList').addEventListener('click', (e) => {
      const card = e.target.closest('.insight-card');
      if (!card) return;
      if (e.target.closest('.insight-del')) {
        confirmDeleteInsight(card.dataset.id);
        return;
      }
      if (e.target.closest('.insight-edit')) {
        openEditInsightModal(card.dataset.id);
        return;
      }
    });
  }

  /* ==================== Tab 切换 ==================== */
  function switchTab(name) {
    state.activeTab = name;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'dashboard') renderDashboard();
    if (name === 'sectors') renderSectorList();
    if (name === 'strategy') renderStrategyStockList();
    if (name === 'insights') { renderInsightStockOptions(); renderInsightList(); }
  }

  /* ==================== 渲染 ==================== */
  function renderAll() {
    renderSectorFilter();
    renderStockList();
    renderStatsBar();
    renderDashboard();
    renderSectorList();
    renderInsightStockOptions();
    renderInsightList();
    document.getElementById('refreshInterval').value = StockDB.getSettings().refreshInterval;
  }

  function renderSectorFilter() {
    const box = document.getElementById('sectorFilter');
    const sectors = StockDB.getSectors();
    const stocks = StockDB.getStocks();
    const stockCountBySector = {};
    stocks.forEach(s => {
      stockCountBySector[s.sectorId || 'none'] = (stockCountBySector[s.sectorId || 'none'] || 0) + 1;
    });

    const tags = [`<span class="filter-tag ${state.currentSectorFilter === 'all' ? 'active' : ''}" data-sector="all">全部 ${stocks.length}</span>`];
    sectors.forEach(sec => {
      const n = stockCountBySector[sec.id] || 0;
      tags.push(`<span class="filter-tag ${state.currentSectorFilter === sec.id ? 'active' : ''}" data-sector="${sec.id}" style="border-color:${sec.color}">${sec.icon} ${sec.name} ${n}</span>`);
    });
    if (stockCountBySector['none']) {
      tags.push(`<span class="filter-tag ${state.currentSectorFilter === 'none' ? 'active' : ''}" data-sector="none">📦 未分类 ${stockCountBySector['none']}</span>`);
    }
    box.innerHTML = tags.join('');
  }

  function renderStatsBar() {
    const stocks = getFilteredStocksWithQuote();
    let up = 0, down = 0;
    let totalPL = 0;

    stocks.forEach(s => {
      const change = parseFloat(s.quote?.change || 0);
      if (change > 0) up++;
      else if (change < 0) down++;
      const shares = parseInt(s.shares || 0, 10);
      totalPL += shares * change;
    });

    document.getElementById('statCount').textContent = stocks.length;
    const upEl = document.getElementById('statUp');
    const downEl = document.getElementById('statDown');
    upEl.textContent = up;
    upEl.className = 'stat-value ' + (up > 0 ? 'up' : '');
    downEl.textContent = down;
    downEl.className = 'stat-value ' + (down > 0 ? 'down' : '');
    const totalEl = document.getElementById('statTotal');
    totalEl.textContent = formatMoney(totalPL);
    totalEl.className = 'stat-value ' + (totalPL > 0 ? 'up' : totalPL < 0 ? 'down' : '');
  }

  function renderStockList() {
    const box = document.getElementById('stockList');
    const stocks = getFilteredStocksWithQuote();

    if (stocks.length === 0) {
      box.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🌸</div>
          <p class="empty-text">${state.currentSectorFilter === 'all' ? '还没记下任何股票哦 ~ 🌷' : '这个板块还空空的 🍃'}</p>
          <button class="btn btn-primary" onclick="app.openAddStockModal()">${state.currentSectorFilter === 'all' ? '＋ 添加我的第一只股票' : '＋ 给这个板块加股票'}</button>
        </div>`;
      renderStatsBar();
      return;
    }

    // 按涨跌幅排序
    stocks.sort((a, b) => parseFloat(b.quote?.changePercent || 0) - parseFloat(a.quote?.changePercent || 0));

    const sectors = StockDB.getSectors();
    const sectorMap = Object.fromEntries(sectors.map(s => [s.id, s]));

    box.innerHTML = stocks.map(s => {
      const q = s.quote || {};
      const price = q.price || '--';
      const change = q.change || '0.00';
      const changePct = q.changePercent || '0.00';
      const isUp = parseFloat(change) >= 0;
      const sector = sectorMap[s.sectorId];
      const sectorBadge = sector
        ? `<span class="sector-badge" style="background:${sector.color}22;color:${sector.color}">${sector.icon} ${sector.name}</span>`
        : '<span class="sector-badge" style="background:#f0f0f0;color:#999">未分类</span>';

      const shares = parseInt(s.shares || 0, 10);
      const cost = parseFloat(s.cost || 0);
      const marketValue = shares * parseFloat(price || 0);
      const costValue = shares * cost;
      const pl = marketValue - costValue;

      return `
      <div class="stock-card ${isUp ? 'up' : 'down'}" data-id="${s.id}">
        <div class="stock-header">
          <div class="stock-info">
            <div>
              ${sectorBadge}
            </div>
            <div style="margin-left:8px">
              <div class="stock-name">${escapeHtml(s.name)}</div>
              <div class="stock-code">${s.code}</div>
            </div>
          </div>
          <div class="change-box ${isUp ? 'up' : 'down'}">
            <span class="change-price">${price}</span>
            <span class="change-percent">${isUp ? '+' : ''}${changePct}%</span>
          </div>
        </div>
        <div class="stock-metrics">
          <div class="metric">
            <div class="metric-label">涨跌额</div>
            <div class="metric-value ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${change}</div>
          </div>
          <div class="metric">
            <div class="metric-label">持仓</div>
            <div class="metric-value">${formatInt(shares)}</div>
          </div>
          <div class="metric">
            <div class="metric-label">市值</div>
            <div class="metric-value">${formatShortMoney(marketValue)}</div>
          </div>
          <div class="metric">
            <div class="metric-label">盈亏</div>
            <div class="metric-value ${pl > 0 ? 'up' : pl < 0 ? 'down' : ''}">${pl > 0 ? '+' : ''}${formatShortMoney(pl)}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    renderStatsBar();
  }

  function renderDashboard() {
    const stocks = getFilteredStocksWithQuote('all');
    let marketValue = 0, costValue = 0, todayPL = 0, totalPL = 0, sumPct = 0, count = 0;
    const bySector = {};
    const sectors = StockDB.getSectors();
    const sectorMap = Object.fromEntries(sectors.map(s => [s.id, s]));
    sectors.forEach(s => bySector[s.id] = { sector: s, marketValue: 0, pl: 0, count: 0 });
    if (!bySector['']) bySector[''] = { sector: { id: '', name: '未分类', icon: '📦', color: '#999' }, marketValue: 0, pl: 0, count: 0 };

    stocks.forEach(s => {
      const q = s.quote || {};
      const shares = parseInt(s.shares || 0, 10);
      const cost = parseFloat(s.cost || 0);
      const price = parseFloat(q.price || 0);
      const change = parseFloat(q.change || 0);
      const mv = shares * price;
      const cv = shares * cost;
      marketValue += mv;
      costValue += cv;
      todayPL += shares * change;
      totalPL += (mv - cv);
      if (q.changePercent !== undefined) {
        sumPct += parseFloat(q.changePercent || 0);
        count++;
      }
      const key = s.sectorId || '';
      if (!bySector[key]) bySector[key] = { sector: { id: key, name: '未分类', icon: '📦', color: '#999' }, marketValue: 0, pl: 0, count: 0 };
      bySector[key].marketValue += mv;
      bySector[key].pl += shares * change;
      bySector[key].count += 1;
    });

    const avgPct = count > 0 ? (sumPct / count).toFixed(2) : '0.00';
    document.getElementById('dashMarketValue').textContent = formatMoney(marketValue);
    const todayEl = document.getElementById('dashTodayPL');
    todayEl.textContent = (todayPL > 0 ? '+' : '') + formatMoney(todayPL);
    todayEl.style.color = todayPL > 0 ? 'var(--up)' : todayPL < 0 ? 'var(--down)' : 'var(--text)';
    const totalEl = document.getElementById('dashTotalPL');
    totalEl.textContent = (totalPL > 0 ? '+' : '') + formatMoney(totalPL);
    totalEl.style.color = totalPL > 0 ? 'var(--up)' : totalPL < 0 ? 'var(--down)' : 'var(--text)';
    const avgEl = document.getElementById('dashAvgChange');
    avgEl.textContent = (parseFloat(avgPct) > 0 ? '+' : '') + avgPct + '%';
    avgEl.style.color = parseFloat(avgPct) > 0 ? 'var(--up)' : parseFloat(avgPct) < 0 ? 'var(--down)' : 'var(--text)';

    // 板块分布
    const maxMV = Math.max(1, ...Object.values(bySector).map(x => x.marketValue));
    const chartBox = document.getElementById('sectorChart');
    const sectorBars = Object.entries(bySector).filter(([_, v]) => v.count > 0).map(([id, v]) => {
      const pct = v.marketValue / maxMV * 100;
      return `
        <div class="sector-bar">
          <div class="sector-bar-header">
            <div class="sector-bar-name">
              <span>${v.sector.icon}</span>
              <span>${v.sector.name}</span>
              <span style="color:var(--text-light);font-weight:400">(${v.count}只)</span>
            </div>
            <div>
              <strong style="color:var(--text)">${formatShortMoney(v.marketValue)}</strong>
              <span style="color:${v.pl > 0 ? 'var(--up)' : v.pl < 0 ? 'var(--down)' : 'var(--text-light)'};margin-left:8px">
                ${v.pl > 0 ? '+' : ''}${formatShortMoney(v.pl)}
              </span>
            </div>
          </div>
          <div class="sector-bar-track">
            <div class="sector-bar-fill" style="width:${pct.toFixed(1)}%;background:${v.sector.color}"></div>
          </div>
        </div>`;
    }).join('');
    chartBox.innerHTML = sectorBars || '<div style="text-align:center;padding:20px;color:var(--text-light)">暂无数据</div>';

    // 涨跌榜
    const sortedByChange = [...stocks].sort((a, b) => parseFloat(b.quote?.changePercent || 0) - parseFloat(a.quote?.changePercent || 0));
    const top5 = sortedByChange.slice(0, 5);
    const bottom5 = sortedByChange.slice().reverse().slice(0, 5);
    document.getElementById('topGainers').innerHTML = renderRanking(top5, true);
    document.getElementById('topLosers').innerHTML = renderRanking(bottom5.filter(s => parseFloat(s.quote?.changePercent || 0) < 0), false);
  }

  function renderRanking(list, isUp) {
    if (list.length === 0) return '<div style="text-align:center;padding:14px;color:var(--text-light);font-size:12px">暂无数据</div>';
    return list.map((s, i) => {
      const pct = parseFloat(s.quote?.changePercent || 0);
      const cls = isUp ? 'up' : 'down';
      return `
        <div class="ranking-item">
          <div>
            <span class="rank-num">${i + 1}</span>
            <span style="font-weight:500">${escapeHtml(s.name)}</span>
          </div>
          <span class="${cls}" style="font-weight:600">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>
        </div>`;
    }).join('');
  }

  function renderSectorList() {
    const box = document.getElementById('sectorList');
    const sectors = StockDB.getSectors();
    const stocks = StockDB.getStocks();
    const quotes = state.quoteMap;
    const sectorMap = Object.fromEntries(sectors.map(s => [s.id, { ...s, stocks: [], mv: 0, pl: 0, up: 0, down: 0 }]));
    const uncategorized = { id: '', name: '未分类', icon: '📦', color: '#999', stocks: [], mv: 0, pl: 0, up: 0, down: 0 };

    stocks.forEach(s => {
      const q = quotes[s.code] || {};
      const shares = parseInt(s.shares || 0, 10);
      const price = parseFloat(q.price || 0);
      const change = parseFloat(q.change || 0);
      const container = s.sectorId && sectorMap[s.sectorId] ? sectorMap[s.sectorId] : uncategorized;
      container.stocks.push(s);
      container.mv += shares * price;
      container.pl += shares * change;
      if (change > 0) container.up++;
      else if (change < 0) container.down++;
    });

    const allSectors = [...Object.values(sectorMap)];
    if (uncategorized.stocks.length > 0) allSectors.push(uncategorized);

    box.innerHTML = allSectors.map(sec => {
      const stockItems = sec.stocks.map(s => {
        const q = quotes[s.code] || {};
        const price = q.price || '--';
        const pct = parseFloat(q.changePercent || 0);
        const isUp = pct >= 0;
        return `
          <div class="sector-mini-stock">
            <div>
              <strong>${escapeHtml(s.name)}</strong>
              <span style="color:var(--text-light);margin-left:6px;font-size:11px">${s.code}</span>
            </div>
            <div style="text-align:right">
              <div style="font-weight:600">${price}</div>
              <div style="font-size:11px" class="${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${pct.toFixed(2)}%</div>
            </div>
          </div>`;
      }).join('');

      const idAttr = sec.id ? `data-id="${sec.id}"` : '';
      const actions = sec.id ? `
        <div class="sector-actions">
          <button class="action-btn" onclick="event.stopPropagation();app.openEditSectorModal('${sec.id}')">编辑</button>
          <button class="action-btn danger" onclick="event.stopPropagation();app.confirmDeleteSector('${sec.id}','${escapeHtml(sec.name)}')">删除</button>
        </div>` : '';

      return `
        <div class="sector-card" style="border-left-color:${sec.color}">
          <div class="sector-card-header">
            <div class="sector-card-title">
              <div class="sector-icon" style="background:${sec.color}22">${sec.icon}</div>
              <div>
                <div class="sector-name">${escapeHtml(sec.name)}</div>
                <div class="sector-stats">${sec.stocks.length} 只 · 上涨 ${sec.up} · 下跌 ${sec.down}</div>
              </div>
            </div>
            ${actions}
          </div>
          <div class="sector-summary">
            <div class="metric">
              <div class="metric-label">板块市值</div>
              <div class="metric-value">${formatShortMoney(sec.mv)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">今日盈亏</div>
              <div class="metric-value ${sec.pl > 0 ? 'up' : sec.pl < 0 ? 'down' : ''}">${sec.pl > 0 ? '+' : ''}${formatShortMoney(sec.pl)}</div>
            </div>
            <div class="metric">
              <div class="metric-label">占比</div>
              <div class="metric-value">${computeWeight(sec.mv)}</div>
            </div>
          </div>
          ${sec.stocks.length > 0 ? `<div class="sector-mini-stocks">${stockItems}</div>` : ''}
        </div>`;
    }).join('') || `<div class="empty-state">
      <div class="empty-icon">🎀</div>
      <p class="empty-text">还没创建板块呢，先建一个属于你的分类吧 💕</p>
    </div>`;

    // 填充板块下拉选项 (新增股票弹窗)
    const sel = document.getElementById('stockSector');
    sel.innerHTML = '<option value="">-- 选择板块 --</option>' + sectors.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');
  }

  /* ==================== 行情刷新 ==================== */
  async function refreshAllQuotes(force = false) {
    const stocks = StockDB.getStocks();
    if (stocks.length === 0) {
      updateTimeDisplay();
      return;
    }
    const codes = stocks.map(s => s.code);
    try {
      const quotes = await StockAPI.fetchQuotes(codes, { force });
      state.quoteMap = { ...state.quoteMap, ...quotes };
      renderAll();
    } catch (e) {
      console.warn('refresh fail', e);
    }
    updateTimeDisplay();
    resetCountdown();
  }

  async function refreshOneStock() {
    const s = StockDB.getStocks().find(x => x.id === state.currentStockId);
    if (!s) return;
    const quotes = await StockAPI.fetchQuotes([s.code], { force: true });
    state.quoteMap = { ...state.quoteMap, ...quotes };
    renderAll();
    openDetailModal(s.id);
    toast('已刷新');
  }

  function updateTimeDisplay() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('updateTime').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function setupAutoRefresh() {
    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
    if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
    const sec = StockDB.getSettings().refreshInterval || 0;
    if (sec <= 0) {
      document.getElementById('refreshHint') && (document.getElementById('refreshHint').textContent = '自动刷新: 关闭');
      return;
    }
    state.countdownSeconds = sec;
    state.refreshTimer = setInterval(() => refreshAllQuotes(true), sec * 1000);
    state.countdownTimer = setInterval(() => {
      state.countdownSeconds--;
      if (state.countdownSeconds <= 0) state.countdownSeconds = sec;
      const m = Math.floor(state.countdownSeconds / 60);
      const ss = state.countdownSeconds % 60;
      const hint = document.getElementById('refreshHint');
      if (hint) hint.textContent = '自动刷新: ' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }, 1000);
  }

  function resetCountdown() {
    const sec = StockDB.getSettings().refreshInterval || 0;
    if (sec > 0) state.countdownSeconds = sec;
  }

  /* ==================== 股票 增/删/改 弹窗 ==================== */
  let editingStockId = null;

  function openAddStockModal() {
    editingStockId = null;
    document.getElementById('stockModalTitle').textContent = '添加自选股';
    document.getElementById('stockMarket').value = 'sh';
    document.getElementById('stockCode').value = '';
    document.getElementById('stockName').value = '';
    document.getElementById('stockSector').value = '';
    document.getElementById('stockShares').value = '';
    document.getElementById('stockCost').value = '';
    document.getElementById('stockNote').value = '';
    document.getElementById('stockModal').classList.remove('hidden');
  }

  function openEditStockModal(id) {
    const s = StockDB.getStocks().find(x => x.id === id);
    if (!s) return;
    editingStockId = id;
    document.getElementById('stockModalTitle').textContent = '编辑股票';
    const m = /^(sh|sz|bj)(\d{6})$/.exec(s.code || '');
    document.getElementById('stockMarket').value = m ? m[1] : 'sh';
    document.getElementById('stockCode').value = m ? m[2] : s.code;
    document.getElementById('stockName').value = s.name || '';
    document.getElementById('stockSector').value = s.sectorId || '';
    document.getElementById('stockShares').value = s.shares || '';
    document.getElementById('stockCost').value = s.cost || '';
    document.getElementById('stockNote').value = s.note || '';
    document.getElementById('stockModal').classList.remove('hidden');
  }

  function closeStockModal() {
    document.getElementById('stockModal').classList.add('hidden');
  }

  async function quickFetchFromCode() {
    const market = document.getElementById('stockMarket').value;
    const codeNum = document.getElementById('stockCode').value.trim();
    if (!/^\d{6}$/.test(codeNum)) { toast('请输入6位股票代码'); return; }
    toast('查询中...');
    const full = market + codeNum;
    const info = await StockAPI.quickLookup(full);
    if (info) {
      if (info.name) document.getElementById('stockName').value = info.name;
      if (info.__mock) toast('当前网络受限，已返回示例数据');
      else toast('已填充: ' + info.name);
    } else {
      toast('未查询到该代码信息，请手动填写');
    }
  }

  function saveStock() {
    const market = document.getElementById('stockMarket').value;
    const codeNum = document.getElementById('stockCode').value.trim();
    const name = document.getElementById('stockName').value.trim();
    const sectorId = document.getElementById('stockSector').value;
    const shares = document.getElementById('stockShares').value.trim();
    const cost = document.getElementById('stockCost').value.trim();
    const note = document.getElementById('stockNote').value.trim();

    if (!/^\d{6}$/.test(codeNum)) { toast('请输入6位数字代码'); return; }
    if (!name) { toast('请输入股票名称'); return; }

    const fullCode = market + codeNum;

    // 检查重复
    const existing = StockDB.getStocks();
    if (!editingStockId && existing.some(s => s.code === fullCode)) {
      toast('该股票已存在');
      return;
    }

    const stock = {
      code: fullCode,
      name,
      sectorId,
      shares: shares || 0,
      cost: cost || 0,
      note
    };
    if (editingStockId) stock.id = editingStockId;
    StockDB.saveStock(stock);

    // 触发一次行情刷新
    StockAPI.fetchQuotes([fullCode], { force: true }).then(q => {
      state.quoteMap = { ...state.quoteMap, ...q };
      renderAll();
    });
    renderAll();
    closeStockModal();
    toast(editingStockId ? '已修改~ 💕' : '记好啦 🌸');
  }

  /* ==================== 板块 弹窗 ==================== */
  let editingSectorId = null;

  function openAddSectorModal() {
    editingSectorId = null;
    document.getElementById('sectorModalTitle').textContent = '新建板块';
    document.getElementById('sectorName').value = '';
    // 默认
    state.selectedEmoji = '🏦';
    state.selectedColor = '#1a73e8';
    syncPickerUI();
    document.getElementById('sectorModal').classList.remove('hidden');
  }

  function openEditSectorModal(id) {
    const sec = StockDB.getSectors().find(s => s.id === id);
    if (!sec) return;
    editingSectorId = id;
    document.getElementById('sectorModalTitle').textContent = '编辑板块';
    document.getElementById('sectorName').value = sec.name;
    state.selectedEmoji = sec.icon;
    state.selectedColor = sec.color;
    syncPickerUI();
    document.getElementById('sectorModal').classList.remove('hidden');
  }

  function closeSectorModal() {
    document.getElementById('sectorModal').classList.add('hidden');
  }

  function syncPickerUI() {
    document.querySelectorAll('#emojiPicker .emoji-opt').forEach(el => {
      el.classList.toggle('active', el.textContent === state.selectedEmoji);
    });
    document.querySelectorAll('#colorPicker .color-opt').forEach(el => {
      el.classList.toggle('active', colorsEqual(el.style.background, state.selectedColor));
    });
  }

  function colorsEqual(a, b) {
    // 简单比较：RGB vs Hex，为简化直接比较字符化结果
    const toHex = (c) => {
      if (c.startsWith('#')) return c.toLowerCase();
      const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return c;
      return '#' + [1, 2, 3].map(i => parseInt(m[i], 10).toString(16).padStart(2, '0')).join('');
    };
    return toHex(a) === toHex(b);
  }

  function saveSector() {
    const name = document.getElementById('sectorName').value.trim();
    if (!name) { toast('请输入板块名称'); return; }
    const sector = { name, icon: state.selectedEmoji, color: state.selectedColor };
    if (editingSectorId) sector.id = editingSectorId;
    StockDB.saveSector(sector);
    renderAll();
    closeSectorModal();
    toast(editingSectorId ? '板块已修改~ 🌿' : '分类建好啦 🎀');
  }

  function confirmDeleteSector(id, name) {
    if (!confirm(`真的要移除板块「${name}」吗？\n该板块下的股票会被放回「未分类」哦~`)) return;
    StockDB.deleteSector(id);
    renderAll();
    toast('板块已移除 🌼');
  }

  /* ==================== 股票详情 ==================== */
  function openDetailModal(id) {
    const s = StockDB.getStocks().find(x => x.id === id);
    if (!s) return;
    state.currentStockId = id;
    const sectors = StockDB.getSectors();
    const sec = sectors.find(x => x.id === s.sectorId);
    const q = state.quoteMap[s.code] || {};
    const price = q.price || '--';
    const change = parseFloat(q.change || 0);
    const pct = parseFloat(q.changePercent || 0);
    const isUp = change >= 0;
    const shares = parseInt(s.shares || 0, 10);
    const cost = parseFloat(s.cost || 0);
    const mv = shares * parseFloat(price || 0);
    const cv = shares * cost;
    const pl = mv - cv;
    const plPct = cv > 0 ? (pl / cv * 100).toFixed(2) : '0.00';
    const todayPL = shares * change;

    const bg = sec ? sec.color : '#1a73e8';
    document.getElementById('detailTitle').textContent = (sec ? sec.icon + ' ' : '') + s.name;

    document.getElementById('detailBody').innerHTML = `
      <div class="detail-price-section" style="background:linear-gradient(135deg, ${bg} 0%, ${lighten(bg)} 100%)">
        <div class="price">${price}</div>
        <div class="change-line">
          ${isUp ? '▲' : '▼'} ${isUp ? '+' : ''}${q.change || '0.00'}
          &nbsp;&nbsp;${isUp ? '+' : ''}${q.changePercent || '0.00'}%
          ${q.__mock ? '<span style="opacity:0.7;font-size:12px;margin-left:8px">(示例数据)</span>' : ''}
        </div>
      </div>

      <div class="detail-grid">
        <div class="detail-item">
          <div class="label">股票代码</div>
          <div class="value">${s.code.toUpperCase()}</div>
        </div>
        <div class="detail-item">
          <div class="label">所属板块</div>
          <div class="value">${sec ? sec.icon + ' ' + sec.name : '未分类'}</div>
        </div>
        <div class="detail-item">
          <div class="label">持仓数量</div>
          <div class="value">${formatInt(shares)} 股</div>
        </div>
        <div class="detail-item">
          <div class="label">成本价</div>
          <div class="value">${cost > 0 ? '¥' + cost.toFixed(2) : '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">总市值</div>
          <div class="value">${formatMoney(mv)}</div>
        </div>
        <div class="detail-item">
          <div class="label">今日盈亏</div>
          <div class="value ${todayPL > 0 ? 'up' : todayPL < 0 ? 'down' : ''}">${todayPL > 0 ? '+' : ''}${formatMoney(todayPL)}</div>
        </div>
        <div class="detail-item">
          <div class="label">累计盈亏</div>
          <div class="value ${pl > 0 ? 'up' : pl < 0 ? 'down' : ''}">${pl > 0 ? '+' : ''}${formatMoney(pl)}</div>
        </div>
        <div class="detail-item">
          <div class="label">收益率</div>
          <div class="value ${parseFloat(plPct) > 0 ? 'up' : parseFloat(plPct) < 0 ? 'down' : ''}">${parseFloat(plPct) > 0 ? '+' : ''}${plPct}%</div>
        </div>
      </div>

      <div class="detail-grid">
        <div class="detail-item">
          <div class="label">今开</div>
          <div class="value">${q.open || '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">昨收</div>
          <div class="value">${q.prevClose || '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">最高</div>
          <div class="value up">${q.high || '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">最低</div>
          <div class="value down">${q.low || '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">换手率</div>
          <div class="value">${q.turnover ? q.turnover + '%' : '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">市盈率</div>
          <div class="value">${q.pe ? q.pe : '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">成交额</div>
          <div class="value">${q.amount ? formatShortMoney(parseFloat(q.amount)) : '--'}</div>
        </div>
        <div class="detail-item">
          <div class="label">成交量</div>
          <div class="value">${q.volume ? formatShortCount(parseFloat(q.volume)) + '股' : '--'}</div>
        </div>
      </div>

      ${s.note ? `
        <div class="detail-note">
          <div class="label">📝 备注</div>
          <div>${escapeHtml(s.note)}</div>
        </div>` : ''}
    `;
    document.getElementById('detailModal').classList.remove('hidden');
  }

  function closeDetailModal() {
    document.getElementById('detailModal').classList.add('hidden');
  }

  function editCurrentStock() {
    closeDetailModal();
    openEditStockModal(state.currentStockId);
  }

  function deleteCurrentStock() {
    const s = StockDB.getStocks().find(x => x.id === state.currentStockId);
    if (!s) return;
    if (!confirm(`舍得删掉「${s.name}」吗？它会从本本里消失哦~`)) return;
    StockDB.deleteStock(s.id);
    closeDetailModal();
    renderAll();
    toast('移除啦 🍂');
  }

  /* ==================== 导入导出 ==================== */
  function exportData() {
    const data = StockDB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `我的股票本备份_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出到下载目录');
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!confirm('导入将合并到现有数据（同ID覆盖），是否继续？')) return;
        StockDB.importAll(data);
        renderAll();
        toast('导入成功');
      } catch (err) {
        toast('文件格式错误');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function clearAllData() {
    if (!confirm('⚠️ 要把本本里的内容都擦掉吗？擦了就找不回来啦！')) return;
    if (!confirm('最后确认一次：所有股票、板块、设置都会消失哦！（抱紧）')) return;
    StockDB.clearAll();
    location.reload();
  }

  /* ==================== PWA 安装 ==================== */
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      const ip = document.getElementById('installPrompt');
      if (ip) ip.classList.remove('hidden');
    });
  }

  async function installApp() {
    if (!state.deferredPrompt) {
      toast('请使用安卓 Chrome 浏览器打开，或在菜单中选择「添加到主屏幕」');
      return;
    }
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('installPrompt').classList.add('hidden');
    }
    state.deferredPrompt = null;
  }

  /* ==================== 交易策略模块 ==================== */

  // 步骤1：选择交易风格
  function selectTradeStyle(style) {
    state.strategy.style = style;
    document.getElementById('styleCardLeft').classList.toggle('active', style === 'left');
    document.getElementById('styleCardRight').classList.toggle('active', style === 'right');
    // 显示步骤2
    document.getElementById('stepPickStock').style.display = 'block';
    // 重置后续步骤
    document.getElementById('stepParams').style.display = 'none';
    document.getElementById('stepResult').style.display = 'none';
    document.getElementById('leftParams').style.display = style === 'left' ? 'block' : 'none';
    document.getElementById('rightParams').style.display = style === 'right' ? 'block' : 'none';
    // 重置参数默认值
    if (style === 'left') {
      document.getElementById('param_buyFormula').value = 0.70;
      document.getElementById('param_oversoldFormula').value = -10;
      document.getElementById('param_biasFormula').value = -15;
      document.getElementById('param_positionRatio').value = 25;
      document.getElementById('param_takeProfitRatio').value = 30;
      document.getElementById('param_stopLossRatio').value = 8;
      document.getElementById('param_totalCapital').value = 100000;
    } else {
      document.getElementById('param_breakConfirm').value = 3;
      document.getElementById('param_trendConfirm').value = 'true';
      document.getElementById('param_positionRatio_r').value = 25;
      document.getElementById('param_sellTrendBreak').value = -5;
      document.getElementById('param_totalCapital_r').value = 100000;
    }
    state.strategy.stockId = null;
    state.strategy.stockCode = null;
    renderStrategyStockList();
  }

  // 步骤2：渲染可选股票
  function renderStrategyStockList() {
    if (!state.strategy.style) return; // 还没选风格，不用渲染
    const box = document.getElementById('stockPickList');
    const stocks = StockDB.getStocks();
    if (stocks.length === 0) {
      box.innerHTML = `
        <div class="empty-state" style="padding:20px 10px">
          <div class="empty-icon" style="font-size:32px">📭</div>
          <p class="empty-text">还没有添加自选股，先去添加吧 💕</p>
          <button class="btn btn-primary btn-sm" onclick="app.openAddStockModal()">+ 添加股票</button>
        </div>`;
      return;
    }
    const sectors = StockDB.getSectors();
    const sectorMap = Object.fromEntries(sectors.map(s => [s.id, s]));
    const quotes = state.quoteMap;
    box.innerHTML = stocks.map(s => {
      const q = quotes[s.code] || {};
      const sec = sectorMap[s.sectorId];
      const price = q.price || '--';
      const pct = parseFloat(q.changePercent || 0);
      const isUp = pct >= 0;
      const active = state.strategy.stockId === s.id ? 'active' : '';
      return `
        <div class="stock-pick-item ${active}" onclick="app.selectStrategyStock('${s.id}')">
          <div>
            <div style="font-weight:600">${escapeHtml(s.name)} <span style="color:var(--text-light);font-weight:400;font-size:12px">${s.code}</span></div>
            <div style="font-size:12px;margin-top:2px">${sec ? sec.icon + ' ' + sec.name : '未分类'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:600">${price}</div>
            <div style="font-size:12px" class="${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${pct.toFixed(2)}%</div>
          </div>
        </div>`;
    }).join('');
  }

  // 步骤2-选中股票 → 显示步骤3
  function selectStrategyStock(id) {
    const s = StockDB.getStocks().find(x => x.id === id);
    if (!s) return;
    state.strategy.stockId = id;
    state.strategy.stockCode = s.code;
    renderStrategyStockList();
    document.getElementById('stepParams').style.display = 'block';
    document.getElementById('stepResult').style.display = 'none';
    // 自动填部分数据
    const quote = state.quoteMap[s.code] || {};
    if (state.strategy.style === 'right') {
      // 前高默认 = max(120日最高价, 昨收1.1倍)，先不填，让用户点自动填充
    }
    toast('已选：' + s.name + '，点「✨自动填充」更省心');
  }

  // 自动填充参数：拉K线和基本面
  async function autoFillStrategyParams() {
    if (!state.strategy.stockCode) { toast('请先选择一只股票'); return; }
    const code = state.strategy.stockCode;
    toast('正在获取K线与财务数据...');
    try {
      const [kline, finance] = await Promise.all([
        StockAPI.fetchKline(code, 120),
        StockAPI.fetchFinance(code)
      ]);
      state.strategy.kline = kline;
      state.strategy.finance = finance;

      const closes = kline.closes || [];
      const priceN = closes.length > 0 ? closes[closes.length - 1] : 0;

      if (state.strategy.style === 'left') {
        document.getElementById('param_reasonablePrice').value = finance.reasonablePrice || priceN * 0.9;
        document.getElementById('param_totalCapital').value = document.getElementById('param_totalCapital').value || 100000;
        // 其他默认值保持
      } else {
        // 前高：120日最高价
        const highs = kline.highs || [];
        const prevHigh = highs.length > 0 ? Math.max(...highs.map(Number).filter(v => v > 0)) : (priceN * 1.05);
        document.getElementById('param_prevHigh').value = prevHigh.toFixed(2);
        document.getElementById('param_totalCapital_r').value = document.getElementById('param_totalCapital_r').value || 100000;
      }
      toast('✅ 参数已自动填充，点「🎯开始分析」查看结论');
    } catch (e) {
      console.warn(e);
      toast('自动填充失败，请手动输入');
    }
  }

  // 执行策略
  async function runStrategy() {
    if (!state.strategy.stockCode) { toast('请先选择股票'); return; }
    const code = state.strategy.stockCode;

    // 如果K线还没拉过，先拉
    const needsKline = !state.strategy.kline || !state.strategy.kline.closes || state.strategy.kline.closes.length === 0;
    if (needsKline) {
      try {
        state.strategy.kline = await StockAPI.fetchKline(code, 120);
        state.strategy.finance = await StockAPI.fetchFinance(code);
      } catch (e) {
        console.warn(e);
      }
    }

    const closes = (state.strategy.kline && state.strategy.kline.closes) || [];
    const volumes = (state.strategy.kline && state.strategy.kline.volumes) || [];
    const finance = state.strategy.finance || {};
    const priceN = closes.length > 0 ? closes[closes.length - 1] :
                   parseFloat((state.quoteMap[code] && state.quoteMap[code].price) || 0);

    let result;
    if (state.strategy.style === 'left') {
      const params = {
        reasonablePrice: parseFloat(document.getElementById('param_reasonablePrice').value || finance.reasonablePrice || priceN * 0.9),
        buyFormula: parseFloat(document.getElementById('param_buyFormula').value || 0.70),
        oversoldFormula: parseFloat(document.getElementById('param_oversoldFormula').value || -10),
        biasFormula: parseFloat(document.getElementById('param_biasFormula').value || -15),
        positionRatio: parseFloat(document.getElementById('param_positionRatio').value || 25),
        takeProfitRatio: parseFloat(document.getElementById('param_takeProfitRatio').value || 30),
        stopLossRatio: parseFloat(document.getElementById('param_stopLossRatio').value || 8),
        price: priceN,
        closes,
        totalCapital: parseFloat(document.getElementById('param_totalCapital').value || 100000)
      };
      result = Strategy.analyzeLeft(params);
    } else {
      const params = {
        breakConfirm: parseFloat(document.getElementById('param_breakConfirm').value || 3),
        trendConfirm: document.getElementById('param_trendConfirm').value !== 'false',
        positionRatio: parseFloat(document.getElementById('param_positionRatio_r').value || 25),
        sellTrendBreak: parseFloat(document.getElementById('param_sellTrendBreak').value || -5),
        price: priceN,
        prevHigh: parseFloat(document.getElementById('param_prevHigh').value || priceN * 1.05),
        closes,
        volumes,
        totalCapital: parseFloat(document.getElementById('param_totalCapital_r').value || 100000)
      };
      result = Strategy.analyzeRight(params);
    }

    document.getElementById('stepResult').style.display = 'block';
    renderStrategyResult(result, code, priceN);
    toast('✅ 分析完成');
  }

  function renderStrategyResult(result, code, priceN) {
    const box = document.getElementById('resultContent');
    const s = StockDB.getStocks().find(x => x.code === code);
    const name = s ? s.name : code;

    const ind = result.indicators || {};

    const indicatorsHtml = `
      <div class="result-grid">
        <div class="result-item"><div class="ri-label">MA5</div><div class="ri-value">${ind.ma5 || '--'}</div></div>
        <div class="result-item"><div class="ri-label">MA20</div><div class="ri-value">${ind.ma20 || '--'}</div></div>
        <div class="result-item"><div class="ri-label">MA60</div><div class="ri-value">${ind.ma60 || '--'}</div></div>
        <div class="result-item"><div class="ri-label">RSI(14)</div><div class="ri-value ${ind.rsi14 > 70 ? 'up' : ind.rsi14 < 30 ? 'down' : ''}">${ind.rsi14 || '--'}</div></div>
        <div class="result-item"><div class="ri-label">布林上轨</div><div class="ri-value">${ind.bollUpper || '--'}</div></div>
        <div class="result-item"><div class="ri-label">布林中轨</div><div class="ri-value">${ind.bollMid || '--'}</div></div>
        <div class="result-item"><div class="ri-label">布林下轨</div><div class="ri-value">${ind.bollLower || '--'}</div></div>
        ${result.style === 'left' ? `
          <div class="result-item"><div class="ri-label">MA20偏离度</div><div class="ri-value ${ind.bias20 < -10 ? 'down' : ind.bias20 > 5 ? 'up' : ''}">${ind.bias20 != null ? ind.bias20 + '%' : '--'}</div></div>
        ` : `
          <div class="result-item"><div class="ri-label">量比(今/20日均)</div><div class="ri-value">${ind.volRatio || '--'}</div></div>
        `}
        <div class="result-item"><div class="ri-label">MACD柱</div><div class="ri-value ${(ind.macdBar||0) > 0 ? 'up' : 'down'}">${ind.macdBar || '--'}</div></div>
      </div>`;

    const priceTargets = result.style === 'left' ? `
      <div class="target-grid">
        <div class="target-card buy"><div class="t-label">⭐ 合理买点</div><div class="t-value">¥${result.idealBuyPrice || '--'}</div></div>
        <div class="target-card buy2"><div class="t-label">🌙 超跌抄底价</div><div class="t-value">¥${result.oversoldPrice || '--'}</div></div>
        <div class="target-card buy3"><div class="t-label">💎 极端捡漏价</div><div class="t-value">¥${result.biasWarnPrice || '--'}</div></div>
        <div class="target-card sell"><div class="t-label">🎯 止盈价</div><div class="t-value">¥${result.takeProfitPrice || '--'}</div></div>
        <div class="target-card stop"><div class="t-label">🛑 止损价</div><div class="t-value">¥${result.stopLossPrice || '--'}</div></div>
      </div>` : `
      <div class="target-grid">
        <div class="target-card buy"><div class="t-label">⚡ 突破买入价</div><div class="t-value">¥${result.breakPrice || '--'}</div></div>
        <div class="target-card sell"><div class="t-label">🎯 止盈价</div><div class="t-value">¥${result.takeProfitPrice || '--'}</div></div>
        <div class="target-card stop"><div class="t-label">🛑 止损价(跌破MA20)</div><div class="t-value">¥${result.stopLossPrice || '--'}</div></div>
      </div>`;

    const batchHtml = `
      <div style="margin-top:16px">
        <h4 style="margin:0 0 10px 0;font-size:14px">📦 分批建仓计划 (单股最大 ¥${formatMoney(result.maxPositionAmount || 0)})</h4>
        <table class="plan-table" style="width:100%;font-size:13px;border-collapse:collapse">
          <thead>
            <tr style="background:#f8f3f6">
              <th style="padding:8px;text-align:left;border-bottom:1px solid #eee">档位</th>
              <th style="padding:8px;text-align:right;border-bottom:1px solid #eee">买入价</th>
              <th style="padding:8px;text-align:right;border-bottom:1px solid #eee">仓位占比</th>
              <th style="padding:8px;text-align:right;border-bottom:1px solid #eee">投入金额</th>
              <th style="padding:8px;text-align:right;border-bottom:1px solid #eee">约股数</th>
            </tr>
          </thead>
          <tbody>
            ${(result.batch || []).map((b, i) => `
              <tr>
                <td style="padding:8px;border-bottom:1px solid #f0e9ec">第 ${i + 1} 档</td>
                <td style="padding:8px;text-align:right;border-bottom:1px solid #f0e9ec">¥${b.price || '--'}</td>
                <td style="padding:8px;text-align:right;border-bottom:1px solid #f0e9ec">${b.ratio}%</td>
                <td style="padding:8px;text-align:right;border-bottom:1px solid #f0e9ec">${formatShortMoney(b.amount || 0)}</td>
                <td style="padding:8px;text-align:right;border-bottom:1px solid #f0e9ec">${formatInt(b.shares || 0)}股</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    const reasonsHtml = (result.reasons && result.reasons.length > 0) ? `
      <div style="margin-top:16px">
        <h4 style="margin:0 0 10px 0;font-size:14px">📝 判断依据</h4>
        <ul class="reasons-list" style="margin:0;padding-left:20px">
          ${result.reasons.map(r => `<li style="padding:4px 0;font-size:13px;color:var(--text)">${r}</li>`).join('')}
        </ul>
      </div>` : '';

    box.innerHTML = `
      <div class="verdict-card" style="background:linear-gradient(135deg, ${result.actionColor}22 0%, #fff 100%);border-left:4px solid ${result.actionColor};padding:16px;border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:12px;color:var(--text-light)">${name} · ${code.toUpperCase()} · 当前价 ¥${priceN || '--'}</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:${result.actionColor}">${result.action}</div>
          </div>
          <div class="score-circle" style="
            width:64px;height:64px;border-radius:50%;
            background:conic-gradient(${result.actionColor} ${result.score * 3.6}deg, #f0e9ec 0);
            display:flex;align-items:center;justify-content:center;">
            <div style="width:50px;height:50px;border-radius:50%;background:white;display:flex;align-items:center;justify-content:center;font-weight:700;color:${result.actionColor};font-size:18px">${result.score}</div>
          </div>
        </div>
      </div>

      <div style="margin-top:16px">
        <h4 style="margin:0 0 10px 0;font-size:14px">📊 技术指标快照</h4>
        ${indicatorsHtml}
      </div>

      <div style="margin-top:16px">
        <h4 style="margin:0 0 10px 0;font-size:14px">🎯 关键价位</h4>
        ${priceTargets}
      </div>

      ${batchHtml}
      ${reasonsHtml}
    `;
  }

  /* ==================== 工具 ==================== */
  function getFilteredStocksWithQuote(filterSector) {
    const sid = filterSector !== undefined ? filterSector : state.currentSectorFilter;
    const stocks = sid === 'all' ? StockDB.getStocks()
      : sid === 'none' ? StockDB.getStocks().filter(s => !s.sectorId)
      : StockDB.getStocks().filter(s => s.sectorId === sid);
    return stocks.map(s => ({ ...s, quote: state.quoteMap[s.code] || StockDB.getQuoteCacheByCode(s.code) }));
  }

  function computeWeight(v) {
    const stocks = StockDB.getStocks();
    const quotes = state.quoteMap;
    let total = 0;
    stocks.forEach(s => {
      total += parseInt(s.shares || 0, 10) * parseFloat(quotes[s.code]?.price || 0);
    });
    if (total <= 0) return '0%';
    return (v / total * 100).toFixed(1) + '%';
  }

  function toast(msg, duration = 1800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), duration);
  }

  function formatMoney(v) {
    if (v === null || v === undefined || isNaN(v)) return '¥0.00';
    const n = Number(v);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return sign + '¥' + abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatShortMoney(v) {
    if (!v && v !== 0) return '0';
    const n = Math.abs(Number(v));
    const sign = Number(v) < 0 ? '-' : '';
    if (n >= 1e8) return sign + (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return sign + (n / 1e4).toFixed(2) + '万';
    return sign + n.toFixed(2);
  }

  function formatShortCount(v) {
    if (!v) return '0';
    const n = Math.abs(Number(v));
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return Math.round(n).toString();
  }

  function formatInt(v) {
    const n = parseInt(v, 10) || 0;
    return n.toLocaleString('zh-CN');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function lighten(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    let r = parseInt(m[1].slice(0, 2), 16);
    let g = parseInt(m[1].slice(2, 4), 16);
    let b = parseInt(m[1].slice(4, 6), 16);
    r = Math.min(255, Math.round(r + (255 - r) * 0.35));
    g = Math.min(255, Math.round(g + (255 - g) * 0.35));
    b = Math.min(255, Math.round(b + (255 - b) * 0.35));
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  /* ==================== 悟道 (Insight) 模块 ==================== */
  function renderInsightStockOptions() {
    // 把所有股票填入"关联股票"下拉
    try {
      const sel = document.getElementById('insightStock');
      if (!sel) return;
      const cur = sel.value || '';
      const stocks = StockDB.getStocks();
      const opts = ['<option value="">-- 不关联 --</option>'];
      stocks.forEach(s => {
        opts.push(`<option value="${s.id}">${escapeHtml(s.name || '')} (${escapeHtml(s.code || '')})</option>`);
      });
      sel.innerHTML = opts.join('');
      sel.value = cur;
    } catch (e) { console.warn('renderInsightStockOptions fail', e); }
  }

  function renderInsightList() {
    try {
      const box = document.getElementById('insightList');
      if (!box) return;
      let all = StockDB.getInsights();
      // 已按updatedAt倒序

      // 心情筛选
      if (state.insight.moodFilter && state.insight.moodFilter !== 'all') {
        all = all.filter(x => (x.mood || '') === state.insight.moodFilter);
      }

      // 关键词搜索
      const kw = state.insight.searchKeyword;
      if (kw) {
        const lower = kw.toLowerCase();
        const stockMap = Object.fromEntries(StockDB.getStocks().map(s => [s.id, s]));
        all = all.filter(x => {
          const hay = [
            x.title, x.content, x.tags && x.tags.join ? x.tags.join(' ') : (x.tags || ''),
            x.stockId ? ((stockMap[x.stockId] && stockMap[x.stockId].name) || '') + ' ' + ((stockMap[x.stockId] && stockMap[x.stockId].code) || '') : ''
          ].join(' ').toLowerCase();
          return hay.indexOf(lower) >= 0;
        });
      }

      if (all.length === 0) {
        box.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">💡</div>
            <p class="empty-text" style="font-size:15px;font-weight:500">
              ${kw ? '没有找到匹配的悟道，换个关键词试试 🌸' : '还没有任何悟道笔记'}
            </p>
            <p class="empty-text" style="margin-top:4px;font-size:13px">记录下你对市场的思考、对交易的复盘</p>
            <button class="btn btn-primary" onclick="app.openAddInsightModal()" style="margin-top:12px">✍️ 写下第一条悟道</button>
          </div>`;
        return;
      }

      const stockMap = Object.fromEntries(StockDB.getStocks().map(s => [s.id, s]));
      const sectors = StockDB.getSectors();
      const sectorMap = Object.fromEntries(sectors.map(s => [s.id, s]));

      const now = Date.now();
      box.innerHTML = all.map(x => {
        const ts = x.updatedAt || x.createdAt || now;
        const dateStr = formatDateTime(ts);
        const diff = now - ts;
        let timeTag;
        if (diff < 60 * 1000) timeTag = '刚刚';
        else if (diff < 3600 * 1000) timeTag = Math.floor(diff / 60000) + ' 分钟前';
        else if (diff < 86400 * 1000) timeTag = Math.floor(diff / 3600000) + ' 小时前';
        else if (diff < 7 * 86400 * 1000) timeTag = Math.floor(diff / 86400000) + ' 天前';
        else timeTag = dateStr.split(' ')[0];

        const mood = x.mood || '🧘';
        const stock = x.stockId ? stockMap[x.stockId] : null;
        const sector = stock && stock.sectorId ? sectorMap[stock.sectorId] : null;
        const tags = Array.isArray(x.tags) ? x.tags : [];
        const content = x.content || '';
        const preview = content.length > 120 ? content.slice(0, 120) + '...' : content;

        const stockBadge = stock ? `
          <span class="insight-stock-badge" style="${sector ? `border-color:${sector.color}` : ''}">
            🎯 ${escapeHtml(stock.name || '')} ${escapeHtml(stock.code || '')}
          </span>` : '';

        const tagsHtml = tags.map(t => `<span class="insight-tag">#${escapeHtml(String(t))}</span>`).join('');

        return `
          <div class="insight-card" data-id="${x.id}" data-mood="${mood}">
            <div class="insight-head">
              <div class="insight-mood-emoji">${mood}</div>
              <div class="insight-head-info">
                <div class="insight-title">${escapeHtml(x.title || '（无题）')}</div>
                <div class="insight-meta">
                  <span class="insight-time" title="${dateStr}">🕒 ${timeTag}</span>
                  ${stockBadge}
                </div>
              </div>
              <div class="insight-actions">
                <button class="insight-edit" title="编辑" onclick="event.stopPropagation();">✏️</button>
                <button class="insight-del" title="删除" onclick="event.stopPropagation();">🗑️</button>
              </div>
            </div>
            <div class="insight-content">${escapeHtml(preview).replace(/\n/g, '<br>')}</div>
            ${tagsHtml ? `<div class="insight-tags">${tagsHtml}</div>` : ''}
          </div>`;
      }).join('');
    } catch (e) {
      console.error('renderInsightList FAIL', e);
    }
  }

  function openAddInsightModal() {
    state.insight.editingId = null;
    document.getElementById('insightModalTitle').textContent = '✍️ 写下我的悟道';
    document.getElementById('insightTitle').value = '';
    document.getElementById('insightContent').value = '';
    document.getElementById('insightTags').value = '';
    state.insight.selectedMood = '🧘';
    document.querySelectorAll('#moodPicker .mood-opt').forEach(x => {
      x.classList.toggle('active', (x.dataset.val || '') === '🧘');
    });
    renderInsightStockOptions();
    document.getElementById('insightStock').value = '';
    document.getElementById('insightModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('insightTitle').focus(), 50);
  }

  function openEditInsightModal(id) {
    const all = StockDB.getInsights();
    const entry = all.find(x => x.id === id);
    if (!entry) return;
    state.insight.editingId = id;
    document.getElementById('insightModalTitle').textContent = '🔧 编辑悟道';
    document.getElementById('insightTitle').value = entry.title || '';
    document.getElementById('insightContent').value = entry.content || '';
    document.getElementById('insightTags').value = (entry.tags || []).join(', ');
    state.insight.selectedMood = entry.mood || '🧘';
    document.querySelectorAll('#moodPicker .mood-opt').forEach(x => {
      x.classList.toggle('active', (x.dataset.val || '') === state.insight.selectedMood);
    });
    renderInsightStockOptions();
    document.getElementById('insightStock').value = entry.stockId || '';
    document.getElementById('insightModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('insightTitle').focus(), 50);
  }

  function closeInsightModal() {
    state.insight.editingId = null;
    document.getElementById('insightModal').classList.add('hidden');
  }

  function saveInsight() {
    const title = (document.getElementById('insightTitle').value || '').trim();
    const content = (document.getElementById('insightContent').value || '').trim();
    if (!title && !content) {
      toast('至少填写标题或正文哦 💕');
      return;
    }
    const stockId = document.getElementById('insightStock').value || '';
    const tagsStr = document.getElementById('insightTags').value || '';
    const tags = tagsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);

    const payload = {
      title: title || '（无题）',
      content: content,
      mood: state.insight.selectedMood || '🧘',
      stockId: stockId || undefined,
      tags: tags.length ? tags : undefined
    };
    if (state.insight.editingId) payload.id = state.insight.editingId;

    const saved = StockDB.saveInsight(payload);
    toast(state.insight.editingId ? '悟道已更新 💕' : '悟道已保存 🌸');
    closeInsightModal();
    renderInsightStockOptions();
    renderInsightList();
  }

  function confirmDeleteInsight(id) {
    if (!confirm('确定要删除这条悟道吗？（删除后无法恢复）')) return;
    StockDB.deleteInsight(id);
    toast('已删除');
    renderInsightList();
  }

  function formatDateTime(ts) {
    try {
      const d = new Date(ts);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch (e) { return ''; }
  }

  /* ==================== 对外接口 ==================== */
  return {
    init,
    // modal
    openAddStockModal, openEditStockModal, closeStockModal,
    openAddSectorModal, openEditSectorModal, closeSectorModal,
    openDetailModal, closeDetailModal,
    saveStock, saveSector,
    confirmDeleteSector,
    editCurrentStock, deleteCurrentStock, refreshOneStock,
    quickFetchFromCode,
    // import/export
    exportData, clearAllData,
    // 交易策略
    selectTradeStyle,
    selectStrategyStock,
    autoFillStrategyParams,
    runStrategy,
    // 悟道
    openAddInsightModal, openEditInsightModal, closeInsightModal,
    saveInsight, confirmDeleteInsight
  };
})();

document.addEventListener('DOMContentLoaded', app.init);
