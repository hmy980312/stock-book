/* =========================================
   交易策略引擎
   - 左侧交易：抄底式（价值+超跌+分批建仓）
   - 右侧交易：追涨式（趋势+突破+右侧确认）
   - 通用技术指标：MA / RSI / MACD / BOLL
   所有变量名统一英文，结果中文展示
   ========================================= */

var Strategy = (function () {

  /* ---------- 通用工具 ---------- */
  const round = (v, n = 2) => {
    if (v === null || v === undefined || isNaN(v)) return 0;
    const p = Math.pow(10, n);
    return Math.round(Number(v) * p) / p;
  };

  /* ========== 技术指标 ========== */

  // 简单移动平均线
  function MA(closes, period) {
    if (closes.length < period) return null;
    let sum = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      sum += Number(closes[i] || 0);
    }
    return sum / period;
  }

  // RSI (14日默认)
  function RSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // MACD (12, 26, 9)
  function MACD(closes) {
    const EMA = (data, period) => {
      if (data.length < period) return 0;
      const k = 2 / (period + 1);
      let ema = data[0];
      for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
      }
      return ema;
    };
    const ema12 = EMA(closes, 12);
    const ema26 = EMA(closes, 26);
    const dif = ema12 - ema26;
    // dea：最近9个dif的EMA，这里简近似（单周期）
    const dea = dif * 0.2 + (0 || 0);
    const macd = (dif - dea) * 2;
    return { dif, dea, macd };
  }

  // 布林带 (20日, 2倍标准差)
  function BOLL(closes, period = 20, mult = 2) {
    if (closes.length < period) return null;
    const recent = closes.slice(-period).map(Number);
    const mid = recent.reduce((a, b) => a + b, 0) / period;
    const variance = recent.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return {
      mid: round(mid),
      upper: round(mid + mult * std),
      lower: round(mid - mult * std),
      bandWidth: round(2 * mult * std)
    };
  }

  // 偏离度（百分比）
  function BIAS(price, ma) {
    if (!ma || ma === 0) return 0;
    return (price - ma) / ma * 100;
  }

  /* ========== 左侧交易分析 ==========
     输入 params: {
       reasonablePrice,  // 合理估值（元）
       buyFormula,       // 买点公式系数（0.5-0.9，越低越保守）
       oversoldFormula,  // 超跌确认参数（偏离MA20多少%算超跌，-5~-15）
       biasFormula,      // 偏离度警戒（-10~-20）
       positionRatio,    // 单只股票最大仓位比例（10-40）
       takeProfitRatio,  // 止盈比例（15-50）
       stopLossRatio,    // 止损比例（5-15）
       price,            // 当前价
       closes,           // 近期K线收盘价数组
       totalCapital      // 总资金(元)
     }
  */
  function analyzeLeft(params) {
    const {
      reasonablePrice = 0,
      buyFormula = 0.7,
      oversoldFormula = -10,
      biasFormula = -15,
      positionRatio = 25,
      takeProfitRatio = 30,
      stopLossRatio = 8,
      price = 0,
      closes = [],
      totalCapital = 100000
    } = params;

    const priceN = Number(price || 0);
    const rp = Number(reasonablePrice || 0);

    // 计算各均线
    const ma5 = MA(closes, 5) || priceN;
    const ma20 = MA(closes, 20) || priceN;
    const ma60 = MA(closes, 60) || priceN;
    const rsi14 = RSI(closes, 14);
    const boll = BOLL(closes, 20) || { upper: priceN * 1.1, mid: priceN, lower: priceN * 0.9 };
    const bias20 = BIAS(priceN, ma20);
    const macd = MACD(closes);

    // 买点公式：合理估值 * buy系数
    const idealBuyPrice = round(rp * buyFormula);
    // 超跌确认价
    const oversoldPrice = round(ma20 * (1 + oversoldFormula / 100));
    // 偏离度警戒价
    const biasWarnPrice = round(ma20 * (1 + biasFormula / 100));

    // 止盈价 & 止损价
    const takeProfitPrice = round(priceN * (1 + takeProfitRatio / 100));
    const stopLossPrice = round(priceN * (1 - stopLossRatio / 100));

    // 单只股票最大仓位金额
    const maxPositionAmount = round(totalCapital * (positionRatio / 100));

    // 分批建仓（3档）
    const batch = [
      { price: round(idealBuyPrice * 1.05), ratio: 0.35 },
      { price: round(oversoldPrice * 1.02), ratio: 0.35 },
      { price: round(biasWarnPrice * 1.02), ratio: 0.30 }
    ].map(b => ({
      price: b.price,
      ratio: round(b.ratio * 100, 0),
      amount: round(maxPositionAmount * b.ratio / 100),
      shares: Math.floor(maxPositionAmount * b.ratio / 100 / Math.max(1, priceN))
    }));

    // 综合评分（买入倾向 0-100，越高越推荐买）
    let score = 50;
    let reasons = [];

    if (rp > 0 && priceN <= idealBuyPrice) { score += 20; reasons.push('现价低于合理估值买点，进入价值区'); }
    else if (rp > 0 && priceN > rp * 1.1) { score -= 15; reasons.push('现价高于合理估值10%+，暂不具备安全边际'); }

    if (bias20 <= oversoldFormula) { score += 15; reasons.push('MA20偏离度 ' + round(bias20, 1) + '%，已达超跌阈值'); }
    else if (bias20 >= 5) { score -= 10; reasons.push('MA20偏离度 ' + round(bias20, 1) + '%，短期偏热'); }

    if (rsi14 < 30) { score += 15; reasons.push('RSI(14)=' + round(rsi14, 0) + '，进入超卖区'); }
    else if (rsi14 > 70) { score -= 10; reasons.push('RSI(14)=' + round(rsi14, 0) + '，进入超买区'); }

    if (priceN <= boll.lower) { score += 10; reasons.push('股价已触及布林下轨 ' + boll.lower); }
    else if (priceN >= boll.upper) { score -= 10; reasons.push('股价已触及布林上轨 ' + boll.upper); }

    if (macd.macd < 0) { score += 5; reasons.push('MACD柱为负，关注是否缩量见底'); }

    score = Math.max(0, Math.min(100, score));

    let action = '观望';
    let actionColor = '#f39c12';
    if (score >= 75) { action = '建议买入'; actionColor = '#27ae60'; }
    else if (score >= 55) { action = '轻仓试错'; actionColor = '#1abc9c'; }
    else if (score <= 30) { action = '建议卖出'; actionColor = '#e74c3c'; }

    return {
      style: 'left',
      score,
      action,
      actionColor,
      reasons,
      idealBuyPrice,
      oversoldPrice,
      biasWarnPrice,
      takeProfitPrice,
      stopLossPrice,
      maxPositionAmount,
      batch,
      indicators: {
        ma5: round(ma5),
        ma20: round(ma20),
        ma60: round(ma60),
        rsi14: round(rsi14),
        bollUpper: boll.upper,
        bollMid: boll.mid,
        bollLower: boll.lower,
        bias20: round(bias20, 2),
        macdDif: round(macd.dif),
        macdDea: round(macd.dea),
        macdBar: round(macd.macd)
      }
    };
  }

  /* ========== 右侧交易分析 ==========
     输入 params: {
       breakConfirm,     // 突破确认（放量突破前高 %，2-10）
       trendConfirm,     // 趋势确认（站上MA5且MA5>MA20）
       positionRatio,    // 单只股票最大仓位比例（10-40）
       sellTrendBreak,   // 卖出条件（跌破MA20 %，-3~-10）
       price,            // 当前价
       prevHigh,         // 前期高点
       closes,           // 近期K线收盘价数组
       volumes,          // 近期成交量数组
       totalCapital      // 总资金(元)
     }
  */
  function analyzeRight(params) {
    const {
      breakConfirm = 3,
      trendConfirm = true,
      positionRatio = 25,
      sellTrendBreak = -5,
      price = 0,
      prevHigh = 0,
      closes = [],
      volumes = [],
      totalCapital = 100000
    } = params;

    const priceN = Number(price || 0);
    const phN = Number(prevHigh || priceN * 0.95);

    // 计算指标
    const ma5 = MA(closes, 5) || priceN;
    const ma20 = MA(closes, 20) || priceN;
    const ma60 = MA(closes, 60) || priceN;
    const rsi14 = RSI(closes, 14);
    const boll = BOLL(closes, 20) || { upper: priceN * 1.1, mid: priceN, lower: priceN * 0.9 };
    const macd = MACD(closes);

    // 成交量均线（简单近似）
    const avgVol = volumes && volumes.length > 0
      ? volumes.slice(-Math.min(20, volumes.length)).reduce((a, b) => a + Number(b), 0) / Math.min(20, volumes.length)
      : 1;
    const recentVol = volumes && volumes.length > 0 ? Number(volumes[volumes.length - 1]) : avgVol;
    const volRatio = avgVol > 0 ? recentVol / avgVol : 1;

    // 突破价
    const breakPrice = round(phN * (1 + breakConfirm / 100));
    // 止盈：突破价上15%~30%，这里取20%
    const takeProfitPrice = round(breakPrice * 1.20);
    // 止损：跌破MA20 + 附加比例
    const stopLossPrice = round(ma20 * (1 + sellTrendBreak / 100));

    // 单只股票最大仓位金额
    const maxPositionAmount = round(totalCapital * (positionRatio / 100));

    // 右侧加仓分档（趋势确认 - 突破追买 - 回踩再买）
    const batch = [];
    // 档1：趋势确认后建仓40%
    batch.push({
      price: round(Math.max(ma5, ma20) * 1.01),
      ratio: 40,
      amount: round(maxPositionAmount * 0.4),
      shares: Math.floor(maxPositionAmount * 0.4 / Math.max(1, priceN))
    });
    // 档2：突破追买35%
    batch.push({
      price: breakPrice,
      ratio: 35,
      amount: round(maxPositionAmount * 0.35),
      shares: Math.floor(maxPositionAmount * 0.35 / Math.max(1, priceN))
    });
    // 档3：突破后回踩MA5不破再加25%
    batch.push({
      price: round(ma5 * 1.02),
      ratio: 25,
      amount: round(maxPositionAmount * 0.25),
      shares: Math.floor(maxPositionAmount * 0.25 / Math.max(1, priceN))
    });

    // 综合评分（买入倾向 0-100）
    let score = 50;
    const reasons = [];

    if (trendConfirm && priceN > ma5 && ma5 > ma20) { score += 20; reasons.push('已站上MA5且MA5>MA20，多头排列确认'); }
    else if (priceN < ma20) { score -= 20; reasons.push('尚未站上MA20，趋势未明'); }

    if (priceN >= breakPrice) { score += 20; reasons.push('放量突破前高 ' + phN + ' → 突破价 ' + breakPrice + ' 确认'); }
    else if (priceN < phN * 0.98) { score -= 10; reasons.push('尚未触及前高 ' + phN + '，等待突破信号'); }

    if (volRatio >= 1.5) { score += 10; reasons.push('量比 ' + round(volRatio, 1) + '，放量配合，可靠性高'); }
    else if (volRatio < 0.8) { score -= 5; reasons.push('量比 ' + round(volRatio, 1) + '，缩量突破需警惕'); }

    if (rsi14 > 50 && rsi14 < 75) { score += 10; reasons.push('RSI(14)=' + round(rsi14, 0) + '，处于强势区间'); }
    else if (rsi14 > 80) { score -= 10; reasons.push('RSI(14)=' + round(rsi14, 0) + '，短期过热'); }

    if (macd.dif > macd.dea && macd.dif > 0) { score += 10; reasons.push('MACD 金叉且位于零轴上方'); }
    else if (macd.dif < macd.dea) { score -= 5; reasons.push('MACD 死叉，注意短期回调风险'); }

    if (priceN >= boll.mid) { score += 5; reasons.push('位于布林中轨之上，趋势偏多'); }
    else { score -= 5; reasons.push('跌破布林中轨，转弱信号'); }

    score = Math.max(0, Math.min(100, score));

    let action = '观望';
    let actionColor = '#f39c12';
    if (score >= 75) { action = '建议买入'; actionColor = '#27ae60'; }
    else if (score >= 55) { action = '轻仓试错'; actionColor = '#1abc9c'; }
    else if (score <= 30) { action = '建议卖出'; actionColor = '#e74c3c'; }

    return {
      style: 'right',
      score,
      action,
      actionColor,
      reasons,
      breakPrice,
      takeProfitPrice,
      stopLossPrice,
      maxPositionAmount,
      batch,
      indicators: {
        ma5: round(ma5),
        ma20: round(ma20),
        ma60: round(ma60),
        rsi14: round(rsi14),
        bollUpper: boll.upper,
        bollMid: boll.mid,
        bollLower: boll.lower,
        volRatio: round(volRatio, 2),
        macdDif: round(macd.dif),
        macdDea: round(macd.dea),
        macdBar: round(macd.macd)
      }
    };
  }

  /* ========== 导出 ========== */
  return {
    MA, RSI, MACD, BOLL, BIAS,
    analyzeLeft,
    analyzeRight
  };

})();
