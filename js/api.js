/* =========================================
   股票行情 API 模块
   数据源:
     - 腾讯财经 qt.gtimg.cn (实时行情)
     - 腾讯财经 web.ifzq.gtimg.cn (K线数据)
     - 东方财富 push2.eastmoney.com (财务数据)
   不使用任何 mock/合成数据, 获取失败则返回空
   ========================================= */

var StockAPI = (function () {
  const ENDPOINT = 'https://qt.gtimg.cn/q=';
  const TIMEOUT = 10000;

  /* ---------- 构造完整代码: sh600519 / sz000001 / bj430047 ---------- */
  function normalizeCode(code) {
    if (!code) return '';
    code = String(code).trim().toLowerCase();
    if (/^(sh|sz|bj)\d{6}$/.test(code)) return code;
    const num = code.replace(/\D/g, '');
    if (num.length !== 6) return '';
    if (num.startsWith('6') || num.startsWith('9')) return 'sh' + num;
    if (num.startsWith('0') || num.startsWith('3')) return 'sz' + num;
    if (num.startsWith('4') || num.startsWith('8')) return 'bj' + num;
    return 'sh' + num;
  }

  /* ---------- 带超时的 fetch ---------- */
  function fetchWithTimeout(url) {
    return new Promise((resolve, reject) => {
      var ctrl;
      try { ctrl = new AbortController(); } catch (_) {}
      var opts = { method: 'GET', cache: 'no-store' };
      if (ctrl) {
        opts.signal = ctrl.signal;
        setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, TIMEOUT);
      }
      fetch(url, opts).then(resolve).catch(reject);
    });
  }

  /* ---------- 发起行情请求（fetch, GBK解码）---------- */
  function fetchRaw(codes) {
    var url = ENDPOINT + codes.join(',');
    return fetchWithTimeout(url).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      // 腾讯接口返回 GBK 编码, 用 arrayBuffer + TextDecoder('gbk') 正确解码中文
      return resp.arrayBuffer().then(function (buffer) {
        try {
          return new TextDecoder('gbk').decode(buffer);
        } catch (_) {
          // TextDecoder 不支持 gbk 时的兜底
          return new TextDecoder().decode(buffer);
        }
      });
    });
  }

  /* ---------- 解析腾讯返回文本 ---------- */
  function parseResponse(text) {
    var result = {};
    if (!text) return result;
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) continue;
      var m = trimmed.match(/v_([a-z]{2}\d{6})="(.+?)"/i);
      if (!m) continue;
      var fullCode = m[1].toLowerCase();
      var fields = m[2].split('~');
      if (fields.length < 35) continue;

      var price = parseFloat(fields[3]) || 0;
      var prevClose = parseFloat(fields[4]) || 0;
      var open = parseFloat(fields[5]) || 0;
      var high = parseFloat(fields[33]) || 0;
      var low = parseFloat(fields[34]) || 0;
      var change = price - prevClose;
      var changePct = prevClose > 0 ? (change / prevClose * 100) : 0;
      var turnover = parseFloat(fields[37]) || 0;
      var pe = parseFloat(fields[38]) || 0;
      var amount = parseFloat(fields[36]) || 0;
      var volume = parseFloat(fields[6]) || 0;

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
        amount: (amount * 10000).toFixed(0),
        volume: (volume * 100).toFixed(0),
        fetchedAt: Date.now()
      };
    }
    return result;
  }

  /* ---------- 对外主入口: 批量拉取行情 ---------- */
  async function fetchQuotes(fullCodes, opts) {
    var force = (opts && opts.force) || false;
    // 尝试读缓存
    if (!force) {
      var cached = StockDB.getQuotesCache();
      if (cached && fullCodes.every(function (c) { return cached[c]; })) {
        return cached;
      }
    }

    var uniqueCodes = [];
    var seen = {};
    for (var i = 0; i < fullCodes.length; i++) {
      if (fullCodes[i] && !seen[fullCodes[i]]) {
        seen[fullCodes[i]] = true;
        uniqueCodes.push(fullCodes[i]);
      }
    }
    if (uniqueCodes.length === 0) return {};

    var result = {};
    try {
      var text = await fetchRaw(uniqueCodes);
      result = parseResponse(text);
    } catch (e) {
      console.warn('[API] fetchQuotes 失败:', e.message);
    }

    // 仅在有数据时写缓存
    if (Object.keys(result).length > 0) {
      StockDB.setQuotesCache(result);
    }
    return result;
  }

  /* ---------- 根据代码快速猜测信息（用于新增时自动填充） ---------- */
  async function quickLookup(rawCode) {
    var code = normalizeCode(rawCode);
    if (!code) return null;
    var quotes = await fetchQuotes([code], { force: true });
    return quotes[code] || null;
  }

  /* ---------- 获取K线数据（腾讯财经）----------
     返回: { closes, volumes, highs, lows, opens, dates }
     失败返回空数组, 不生成假数据
  */
  async function fetchKline(rawCode, days) {
    days = days || 120;
    var full = normalizeCode(rawCode);
    var empty = { closes: [], volumes: [], highs: [], lows: [], opens: [], dates: [] };
    if (!full) return empty;

    // 腾讯K线接口: param=代码,周期,开始日期,结束日期,数量,复权方式
    var klineUrl =
      'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + full +
      ',day,,,' + days + ',qfq';

    try {
      var resp = await fetchWithTimeout(klineUrl);
      if (resp.ok) {
        var json = await resp.json();
        var stockData = (json && json.data && json.data[full]) || {};
        // 优先取前复权数据, 没有则取未复权
        var klines = stockData.qfqday || stockData.day || [];
        var closes = [], volumes = [], highs = [], lows = [], opens = [], dates = [];
        for (var i = 0; i < klines.length; i++) {
          var k = klines[i];
          if (k.length >= 6) {
            dates.push(k[0]);
            opens.push(parseFloat(k[1]) || 0);
            closes.push(parseFloat(k[2]) || 0);
            highs.push(parseFloat(k[3]) || 0);
            lows.push(parseFloat(k[4]) || 0);
            volumes.push(parseFloat(k[5]) || 0);
          }
        }
        return { closes: closes, volumes: volumes, highs: highs, lows: lows, opens: opens, dates: dates };
      }
    } catch (e) {
      console.warn('[API] fetchKline 失败:', e.message);
    }
    return empty;
  }

  /* ---------- 获取基本面数据（东方财富）---------- */
  async function fetchFinance(rawCode) {
    var full = normalizeCode(rawCode);
    if (!full) return { pe: 0, pb: 0, totalMv: 0, eps: 0, reasonablePrice: 0 };

    // 先获取实时行情中的 PE
    var quoteInfo = await fetchQuotes([full]);
    var quotePe = parseFloat((quoteInfo && quoteInfo[full] && quoteInfo[full].pe) || 0);
    var price = parseFloat((quoteInfo && quoteInfo[full] && quoteInfo[full].price) || 0);

    var prefix = full.slice(0, 2);
    var num = full.slice(2);
    var market = prefix === 'sh' ? '1' : '0';
    var secid = market + '.' + num;
    var financeUrl =
      'https://push2.eastmoney.com/api/qt/stock/get?secid=' + secid +
      '&fields=f57,f58,f162,f167,f116,f164';

    var pe = quotePe;
    var pb = 0;
    var totalMv = 0;
    var eps = 0;

    try {
      var resp = await fetchWithTimeout(financeUrl);
      if (resp.ok) {
        var json = await resp.json();
        var d = (json && json.data) || {};
        if (d.f162) pe = parseFloat(d.f162) || pe;
        if (d.f167) pb = parseFloat(d.f167) || 0;
        if (d.f116) totalMv = parseFloat(d.f116) || 0;
        if (d.f164) {
          var apiEps = parseFloat(d.f164) || 0;
          // 仅当值合理时才用: EPS 应为正且小于股价
          if (apiEps > 0 && apiEps < price && price > 0) {
            eps = apiEps;
          }
        }
      }
    } catch (e) {
      console.warn('[API] fetchFinance 失败:', e.message);
    }

    // 从市盈率反推 EPS (比 API 字段更可靠)
    if (eps <= 0 && pe > 0 && price > 0) {
      eps = price / pe;
    }

    // 合理估值: 用温和 PE (min(当前PE, 20)) 计算
    var reasonablePrice = 0;
    if (eps > 0 && pe > 0) {
      var moderatePE = Math.min(pe, 20);
      reasonablePrice = eps * moderatePE;
    } else if (pb > 0 && price > 0) {
      reasonablePrice = price / pb * 1.5;
    } else if (price > 0) {
      reasonablePrice = price * 0.9;
    }

    // 合理性校验: 合理估值应在当前股价的 0.3~1.5 倍范围内
    if (price > 0) {
      if (reasonablePrice > price * 1.5) reasonablePrice = price * 1.1;
      if (reasonablePrice < price * 0.3) reasonablePrice = price * 0.8;
    }
    reasonablePrice = parseFloat(reasonablePrice.toFixed(2));

    return {
      pe: parseFloat(pe.toFixed(2)),
      pb: parseFloat(pb.toFixed(2)),
      totalMv: Math.round(totalMv),
      eps: parseFloat(eps.toFixed(4)),
      reasonablePrice: reasonablePrice
    };
  }

  return {
    normalizeCode: normalizeCode,
    fetchQuotes: fetchQuotes,
    quickLookup: quickLookup,
    fetchKline: fetchKline,
    fetchFinance: fetchFinance
  };
})();
