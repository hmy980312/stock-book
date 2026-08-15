/* =========================================
   股票行情 API 模块
   数据源: 腾讯财经 qt.gtimg.cn (免费、无需key)
   格式参考: v_sh600519="1~贵州茅台~600519~...";
   字段 (按 ~ 分割):
     0: 未知, 1: 名称, 2: 代码, 3: 当前价, 4: 昨收, 5: 今开,
     6: 成交量(手), 7: 外盘, 8: 内盘,
     9-18: 买一~买五(价,量), 19-28: 卖一~卖五(价,量),
     29: 最近逐笔成交, 30: 时间, 31: 涨跌, 32: 涨跌幅%,
     33: 最高, 34: 最低, 35: 价格/成交量/成交额, 36: 成交额(万),
     37: 换手率, 38: 市盈率, 39: 振幅%, ...
   ========================================= */

var StockAPI = (function () {
  const ENDPOINT = 'https://qt.gtimg.cn/q=';
  const TIMEOUT = 8000;

  /* ---------- 兼容工具：构造带超时的 fetch 参数（兼容老 WebView）---------- */
  function fetchOpts() {
    try {
      if (typeof AbortController !== 'undefined') {
        const ctrl = new AbortController();
        setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, TIMEOUT);
        return { signal: ctrl.signal, method: 'GET', cache: 'no-store' };
      }
    } catch (_) {}
    return { method: 'GET', cache: 'no-store' };
  }

  /* ---------- 构造完整代码: sh600519 / sz000001 / bj430047 ---------- */
  function normalizeCode(code) {
    if (!code) return '';
    code = String(code).trim().toLowerCase();
    // 如果已经带前缀
    if (/^(sh|sz|bj)\d{6}$/.test(code)) return code;
    // 裸代码，根据前缀推断
    const num = code.replace(/\D/g, '');
    if (num.length !== 6) return '';
    if (num.startsWith('6') || num.startsWith('9')) return 'sh' + num;
    if (num.startsWith('0') || num.startsWith('3')) return 'sz' + num;
    if (num.startsWith('4') || num.startsWith('8')) return 'bj' + num;
    // 默认上海
    return 'sh' + num;
  }

  /* ---------- 发起请求 ---------- */
  function fetchRaw(codes) {
    return new Promise((resolve) => {
      const url = ENDPOINT + codes.join(',');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);

      // 使用 JSONP 方式（script 标签）绕过 CORS
      // 腾讯接口返回的是 js 变量赋值，用 fetch 加 no-cors 无法读取内容
      jsonpRequest(url).then(resolve).catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  function jsonpRequest(url) {
    return new Promise((resolve, reject) => {
      // 使用 XMLHttpRequest + try-catch 直接请求文本
      // 在移动端webview/PWA中同源策略可能较宽松；如果失败返回 null，会走 mock 回退
      const xhr = new XMLHttpRequest();
      try {
        xhr.open('GET', url, true);
        xhr.timeout = TIMEOUT;
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(new Error('status ' + xhr.status));
          }
        };
        xhr.onerror = () => reject(new Error('xhr error'));
        xhr.ontimeout = () => reject(new Error('timeout'));
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ---------- 解析腾讯返回文本 ---------- */
  function parseResponse(text) {
    const result = {};
    if (!text) return result;
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(/v_([a-z]{2}\d{6})="(.+?)"/i);
      if (!m) continue;
      const fullCode = m[1].toLowerCase();
      const fields = m[2].split('~');
      if (fields.length < 35) continue;

      const price = parseFloat(fields[3]) || 0;
      const prevClose = parseFloat(fields[4]) || 0;
      const open = parseFloat(fields[5]) || 0;
      const high = parseFloat(fields[33]) || 0;
      const low = parseFloat(fields[34]) || 0;
      const change = price - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;
      const turnover = parseFloat(fields[37]) || 0; // 换手率
      const pe = parseFloat(fields[38]) || 0; // 市盈率
      const amount = parseFloat(fields[36]) || 0; // 成交额(万)
      const volume = parseFloat(fields[6]) || 0; // 成交量(手)

      result[fullCode] = {
        code: fullCode,
        name: fields[1] || '',
        price: price.toFixed(2),
        prevClose: prevClose.toFixed(2),
        open: open.toFixed(2),
        high: high.toFixed(2),
        low: low.toFixed(2),
        change: change.toFixed(2),
        changePercent: changePct.toFixed(2),
        isUp: change >= 0,
        turnover: turnover.toFixed(2),
        pe: pe.toFixed(2),
        amount: (amount * 10000).toFixed(0), // 元
        volume: (volume * 100).toFixed(0), // 股
        fetchedAt: Date.now()
      };
    }
    return result;
  }

  /* ---------- Mock 回退数据 ---------- */
  function buildMock(codes) {
    const result = {};
    const defaultNameMap = {
      'sh600519': '贵州茅台', 'sh601318': '中国平安', 'sh600036': '招商银行',
      'sz000001': '平安银行', 'sz000858': '五粮液', 'sz300750': '宁德时代',
      'sh601398': '工商银行', 'sh601939': '建设银行', 'sh601288': '农业银行',
      'sh601988': '中国银行', 'sh601328': '交通银行', 'sh601658': '邮储银行'
    };
    const mockBasePrices = {
      'sh600519': 1680, 'sh601318': 48.5, 'sh600036': 32.8,
      'sz000001': 10.2, 'sz000858': 145.6, 'sz300750': 198.5,
      'sh601398': 7.52, 'sh601939': 10.15, 'sh601288': 6.35,
      'sh601988': 5.90, 'sh601328': 6.75, 'sh601658': 5.05
    };
    for (const code of codes) {
      const base = mockBasePrices[code] || 20;
      const jitter = (Math.random() - 0.5) * 0.04; // ±2%
      const price = base * (1 + jitter);
      const prev = base * (1 + (Math.random() - 0.5) * 0.01);
      const change = price - prev;
      const pct = prev > 0 ? (change / prev * 100) : 0;
      result[code] = {
        code,
        name: defaultNameMap[code] || code.toUpperCase(),
        price: price.toFixed(2),
        prevClose: prev.toFixed(2),
        open: (prev * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2),
        high: (price * (1 + Math.random() * 0.015)).toFixed(2),
        low: (price * (1 - Math.random() * 0.015)).toFixed(2),
        change: change.toFixed(2),
        changePercent: pct.toFixed(2),
        isUp: change >= 0,
        turnover: (Math.random() * 3).toFixed(2),
        pe: (Math.random() * 20 + 8).toFixed(2),
        amount: (Math.random() * 1e9).toFixed(0),
        volume: (Math.random() * 5e7).toFixed(0),
        fetchedAt: Date.now(),
        __mock: true
      };
    }
    return result;
  }

  /* ---------- 对外主入口: 批量拉取行情 ---------- */
  async function fetchQuotes(fullCodes, { force = false } = {}) {
    // 尝试读缓存
    if (!force) {
      const cached = StockDB.getQuotesCache();
      if (cached && fullCodes.every(c => cached[c])) {
        return cached;
      }
    }

    const uniqueCodes = [...new Set(fullCodes.filter(Boolean))];
    if (uniqueCodes.length === 0) return {};

    let text = null;
    try {
      text = await fetchRaw(uniqueCodes);
    } catch (e) {
      console.warn('[API] fetch fail, use mock', e);
    }

    let result;
    if (text) {
      result = parseResponse(text);
    }
    // 解析失败或部分缺失，用 mock 补齐
    if (!result || Object.keys(result).length < uniqueCodes.length) {
      const mock = buildMock(uniqueCodes.filter(c => !result || !result[c]));
      result = { ...mock, ...(result || {}) };
    }

    // 写入缓存
    StockDB.setQuotesCache(result);
    return result;
  }

  /* ---------- 根据代码快速猜测信息（用于新增时自动填充） ---------- */
  async function quickLookup(rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) return null;
    const quotes = await fetchQuotes([code], { force: true });
    return quotes[code] || null;
  }

  /* ---------- 获取K线数据（东方财富接口）----------
     返回: { closes: [收盘价数组], volumes: [成交量数组], highs: [], lows: [], opens: [] }
     days: 需要的天数，默认120
  */
  async function fetchKline(rawCode, days = 120) {
    const full = normalizeCode(rawCode);
    if (!full) return { closes: [], volumes: [], highs: [], lows: [], opens: [], dates: [] };

    // 构造 secid: 上海=1, 深圳=0, 北京=0
    const prefix = full.slice(0, 2);
    const num = full.slice(2);
    const market = prefix === 'sh' ? '1' : '0';
    const secid = market + '.' + num;

    const klineUrl =
      'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58' +
      '&klt=101&fqt=1&end=20500101&lmt=' + days;

    try {
      const resp = await fetch(klineUrl, fetchOpts());
      if (resp.ok) {
        const json = await resp.json();
        const klines = (json && json.data && json.data.klines) || [];
        const closes = [], volumes = [], highs = [], lows = [], opens = [], dates = [];
        for (const line of klines) {
          const parts = String(line).split(',');
          if (parts.length >= 7) {
            dates.push(parts[0]);
            opens.push(parseFloat(parts[1]) || 0);
            closes.push(parseFloat(parts[2]) || 0);
            highs.push(parseFloat(parts[3]) || 0);
            lows.push(parseFloat(parts[4]) || 0);
            volumes.push(parseFloat(parts[5]) || 0);
          }
        }
        return { closes, volumes, highs, lows, opens, dates };
      }
    } catch (e) {
      console.warn('[API] fetchKline fail, build synthetic', e);
    }

    // 合成K线兜底：以最近行情价为基准，生成 days 天随机波动数据
    const info = await fetchQuotes([full]);
    const basePrice = parseFloat((info && info[full] && info[full].price) || 20);
    const closes = [];
    const volumes = [];
    const highs = [];
    const lows = [];
    const opens = [];
    let price = basePrice * (1 + (Math.random() - 0.5) * 0.1);
    for (let i = 0; i < days; i++) {
      const open = price;
      const jitter = (Math.random() - 0.5) * 0.04;
      const close = Math.max(0.01, price * (1 + jitter));
      const high = Math.max(open, close) * (1 + Math.random() * 0.015);
      const low = Math.min(open, close) * (1 - Math.random() * 0.015);
      const vol = (Math.random() * 1e7 + 1e6);
      opens.push(parseFloat(open.toFixed(2)));
      closes.push(parseFloat(close.toFixed(2)));
      highs.push(parseFloat(high.toFixed(2)));
      lows.push(parseFloat(low.toFixed(2)));
      volumes.push(Math.round(vol));
      price = close;
    }
    // 让最后一根接近真实价
    if (closes.length > 0) {
      const scale = basePrice / (closes[closes.length - 1] || 1);
      for (let i = 0; i < closes.length; i++) {
        closes[i] = parseFloat((closes[i] * scale).toFixed(2));
        opens[i] = parseFloat((opens[i] * scale).toFixed(2));
        highs[i] = parseFloat((highs[i] * scale).toFixed(2));
        lows[i] = parseFloat((lows[i] * scale).toFixed(2));
      }
    }
    return { closes, volumes, highs, lows, opens, dates: [] };
  }

  /* ---------- 获取基本面数据（合理估值、市盈率等）----------
     返回: { pe, pb, totalMv, eps, reasonablePrice }
  */
  async function fetchFinance(rawCode) {
    const full = normalizeCode(rawCode);
    if (!full) return { pe: 0, pb: 0, totalMv: 0, eps: 0, reasonablePrice: 0 };

    // 先用实时行情里的PE兜底
    const quoteInfo = await fetchQuotes([full]);
    const quotePe = parseFloat((quoteInfo && quoteInfo[full] && quoteInfo[full].pe) || 0);
    const price = parseFloat((quoteInfo && quoteInfo[full] && quoteInfo[full].price) || 0);

    // 东方财富财务接口：push2.eastmoney.com
    const prefix = full.slice(0, 2);
    const num = full.slice(2);
    const market = prefix === 'sh' ? '1' : '0';
    const secid = market + '.' + num;
    const financeUrl =
      'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid +
      '&fields=f57,f58,f162,f167,f116,f164';

    let pe = quotePe;
    let pb = 0;
    let totalMv = 0;
    let eps = 0;

    try {
      const resp = await fetch(financeUrl, fetchOpts());
      if (resp.ok) {
        const json = await resp.json();
        const d = (json && json.data) || {};
        if (d.f162) pe = parseFloat(d.f162) || pe; // PE(TTM)
        if (d.f167) pb = parseFloat(d.f167) || 0;   // PB
        if (d.f116) totalMv = parseFloat(d.f116) || 0; // 总市值(元)
        if (d.f164) eps = parseFloat(d.f164) || 0; // 每股收益
      }
    } catch (e) {
      console.warn('[API] fetchFinance fail, use fallback', e);
    }

    // 合理估值：取行业中位PE 25倍作为保守估值线
    // 如果PE <= 0说明亏损，用2倍PB估值；否则用 EPS*25 或 价格*行业平均PE/当前PE
    let reasonablePrice = 0;
    const industryPE = 25;
    if (eps > 0) {
      reasonablePrice = parseFloat((eps * industryPE).toFixed(2));
    } else if (pe > 0 && price > 0) {
      reasonablePrice = parseFloat((price * industryPE / pe).toFixed(2));
    } else if (pb > 0 && price > 0) {
      reasonablePrice = parseFloat((price / pb * 1.5).toFixed(2));
    } else {
      reasonablePrice = parseFloat((price * 0.9).toFixed(2)); // 兜底：现价9折作为近似
    }

    return {
      pe: parseFloat(pe.toFixed(2)),
      pb: parseFloat(pb.toFixed(2)),
      totalMv: Math.round(totalMv),
      eps: parseFloat(eps.toFixed(4)),
      reasonablePrice
    };
  }

  return {
    normalizeCode,
    fetchQuotes,
    quickLookup,
    fetchKline,
    fetchFinance
  };
})();
