// ==================== 無名牛排 POS Worker V7.0 ====================
// V7.0: 所有商業邏輯統一在 Worker 處理，前端零計算

const DEFAULT_MENU = [
  {
    id: 'cat-1',
    title: '頂級牛排 / Premium Steaks',
    description: '嚴選 Prime 級牛肉，口感絕佳',
    items: [
      { id: 'item-1', name: '肋眼牛排 / Ribeye', price: 1280, description: '油花分布均勻，口感軟嫩', weight: '12oz', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] },
      { id: 'item-2', name: '菲力牛排 / Filet Mignon', price: 1580, description: '最軟嫩的部位，幾乎沒有油脂', weight: '8oz', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] },
      { id: 'item-3', name: '紐約客 / New York Strip', price: 1380, description: '肉質紮實，風味濃郁', weight: '12oz', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] }
    ]
  },
  {
    id: 'cat-2',
    title: '經典主餐 / Classics',
    description: '餐廳招牌推薦',
    items: [
      { id: 'item-4', name: '碳烤豬肋排 / BBQ Ribs', price: 980, description: '慢火碳烤，肉質軟嫩', weight: '全排', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] },
      { id: 'item-5', name: '香煎鮭魚 / Pan-seared Salmon', price: 880, description: '新鮮鮭魚，外酥內嫩', weight: '300g', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] }
    ]
  },
  {
    id: 'cat-3',
    title: '板腱牛排+炸雞或炸魚套餐 / Chuck Tender Combo',
    description: '板腱牛排搭配炸雞或炸魚，超值組合',
    items: [
      { id: 'item-combo-1', name: '板腱牛排+炸雞或炸魚套餐 17OZ', price: 299, description: '3OZ板腱牛排 + 4OZ炸雞或炸魚', weight: '17OZ', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] },
      { id: 'item-combo-2', name: '板腱牛排+炸雞或炸魚套餐 10OZ', price: 399, description: '6OZ板腱牛排 + 4OZ炸雞或炸魚', weight: '10OZ', isAvailable: true, isHidden: false, isHoverInfoEnabled: true, customizations: {}, customizationOrder: [] }
    ]
  }
];

const DEFAULT_ADDONS = [];
const DEFAULT_OPTIONS = {};
const DEFAULT_GROUP_META = {};
const FALLBACK_ADMIN_PASSWORD = 'admin123';
const TAX_RATE = 0.05; // 5% 營業稅 — 全系統唯一定義點，前端不持有此值

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}
function errResponse(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}

async function kvGet(KV, key, fallback = null) {
  try { const val = await KV.get(key, 'json'); return val !== null ? val : fallback; }
  catch (e) { return fallback; }
}
async function kvSet(KV, key, value) { await KV.put(key, JSON.stringify(value)); }

async function ensureInit(KV) {
  const menu = await kvGet(KV, 'config:menu');
  if (!menu) {
    await Promise.all([
      kvSet(KV, 'config:menu', DEFAULT_MENU),
      kvSet(KV, 'config:addons', DEFAULT_ADDONS),
      kvSet(KV, 'config:options', DEFAULT_OPTIONS),
      kvSet(KV, 'config:groupMeta', DEFAULT_GROUP_META),
      kvSet(KV, 'orders:index', []),
      kvSet(KV, 'snapshots:index', []),
      kvSet(KV, 'auth:tokens', [])
    ]);
  }
}

async function addOrderToIndex(KV, orderId) {
  const index = await kvGet(KV, 'orders:index', []);
  if (!index.includes(orderId)) { index.push(orderId); await kvSet(KV, 'orders:index', index); }
}
async function getAllOrders(KV) {
  const index = await kvGet(KV, 'orders:index', []);
  const orders = await Promise.all(index.map(id => kvGet(KV, `order:${id}`)));
  return orders.filter(Boolean);
}
async function getAllSnapshots(KV) {
  const index = await kvGet(KV, 'snapshots:index', []);
  const snaps = await Promise.all(index.map(id => kvGet(KV, `snapshot:${id}`)));
  return snaps.filter(Boolean);
}
async function addSnapshotToIndex(KV, snapId) {
  const index = await kvGet(KV, 'snapshots:index', []);
  if (!index.includes(snapId)) { index.push(snapId); await kvSet(KV, 'snapshots:index', index); }
}
async function removeSnapshotFromIndex(KV, snapId) {
  const index = await kvGet(KV, 'snapshots:index', []);
  await kvSet(KV, 'snapshots:index', index.filter(id => id !== snapId));
}
async function validateToken(KV, token) {
  if (!token) return false;
  const tokens = await kvGet(KV, 'auth:tokens', []);
  return tokens.includes(token);
}
async function addToken(KV, token) {
  const tokens = await kvGet(KV, 'auth:tokens', []);
  await kvSet(KV, 'auth:tokens', [...tokens, token].slice(-100));
}

function mergeSettings(cur, patch) {
  let merged = { ...cur, ...patch };
  if (patch.kiosk_config && cur.kiosk_config) {
    const ck = cur.kiosk_config, sk = patch.kiosk_config;
    merged.kiosk_config = {
      ...ck, ...sk,
      featureToggles: { ...(ck.featureToggles || {}), ...(sk.featureToggles || {}) },
      content: { ...(ck.content || {}), ...(sk.content || {}) },
      visualSettings: { ...(ck.visualSettings || {}), ...(sk.visualSettings || {}) },
      layoutConfig: { ...(ck.layoutConfig || {}), ...(sk.layoutConfig || {}) }
    };
  }
  return merged;
}

// ==================== 核心商業邏輯（全系統唯一計算來源）====================

/**
 * 計算單品金額
 * 選項費用：每份 × 份數；加購費用：全單共用，不隨份數倍增
 */
function calculateItemPrice(item, quantity, selections, addons) {
  let optionsPerUnit = 0;
  if (selections) {
    Object.values(selections).forEach(group => {
      if (Array.isArray(group)) group.forEach(opt => {
        if (opt && opt.price) optionsPerUnit += opt.price * (opt.quantity || 1);
      });
    });
  }
  const unitPriceWithExtras = Math.round(item.price + optionsPerUnit);
  let addonsTotal = 0;
  if (addons) addons.forEach(a => { if (a && a.price) addonsTotal += a.price * (a.quantity || 1); });
  const totalPrice = Math.round(unitPriceWithExtras * quantity + addonsTotal);
  return { unitPriceWithExtras, totalPrice };
}

/**
 * 計算購物車合計（含稅、找零面額）
 */
function calculateCartTotals(items) {
  const subtotal = Math.round(items.reduce((acc, it) => acc + (Number(it.totalPrice) || 0), 0));
  const taxAmount = Math.round(subtotal * TAX_RATE);
  const finalTotal = subtotal + taxAmount;
  const bill = finalTotal <= 500 ? 500 : (finalTotal <= 1000 ? 1000 : Math.ceil(finalTotal / 1000) * 1000);
  return { subtotal, taxAmount, finalTotal, bill };
}

async function requireAuth(request, KV) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!await validateToken(KV, token)) return errResponse('未授權', 401);
  return null;
}

// ==================== Router ====================

export default {
  async fetch(request, env) {
    const KV = env.POS_DB;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;

    // 健康檢查
    if (path === '/api/health') return jsonResponse({ status: 'ok', version: '7.0', taxRate: TAX_RATE, time: new Date().toISOString() });

    // 公開菜單設定
    if (path === '/api/config' && request.method === 'GET') {
      await ensureInit(KV);
      const [menu, addons, options, groupMeta, settings] = await Promise.all([
        kvGet(KV, 'config:menu', []), kvGet(KV, 'config:addons', []), kvGet(KV, 'config:options', {}),
        kvGet(KV, 'config:groupMeta', {}), kvGet(KV, 'config:settings', {})
      ]);
      return jsonResponse({ success: true, menu, addons, options, groupMeta, settings });
    }

    // ===== 商業計算 API =====

    // POST /api/calculate/item  →  計算單品金額
    if (path === '/api/calculate/item' && request.method === 'POST') {
      try {
        const { item, quantity, selections, addons } = await request.json();
        if (!item || item.price === undefined) return errResponse('缺少品項資料');
        return jsonResponse({ success: true, ...calculateItemPrice(item, quantity || 1, selections || {}, addons || []) });
      } catch (e) { return errResponse(e.message, 500); }
    }

    // POST /api/calculate/cart  →  計算購物車合計（含稅、找零）
    if (path === '/api/calculate/cart' && request.method === 'POST') {
      try {
        const { items } = await request.json();
        if (!Array.isArray(items)) return errResponse('items 必須為陣列');
        return jsonResponse({ success: true, ...calculateCartTotals(items) });
      } catch (e) { return errResponse(e.message, 500); }
    }

    // POST /api/calculate  →  舊版相容端點
    if (path === '/api/calculate' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.item) {
          const ir = calculateItemPrice(body.item, body.quantity || 1, body.selections || {}, body.addons || []);
          const cr = calculateCartTotals([{ totalPrice: ir.totalPrice }]);
          return jsonResponse({ success: true, ...ir, ...cr, total: cr.finalTotal });
        }
        if (body.items) return jsonResponse({ success: true, ...calculateCartTotals(body.items) });
        return errResponse('缺少 item 或 items 參數');
      } catch (e) { return errResponse(e.message, 500); }
    }

    // ===== 訂單 =====

    if (path === '/api/orders' && request.method === 'POST') {
      try {
        await ensureInit(KV);
        const orderData = await request.json();
        if (!orderData.items || !Array.isArray(orderData.items)) return errResponse('無效的訂單格式');
        // Worker 重新計算，覆蓋前端傳入金額，保證資料一致性
        const totals = calculateCartTotals(orderData.items);
        const id = orderData.id || `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const order = {
          createdAt: new Date().toISOString(), status: '待確認',
          ...orderData, id,
          subtotal: totals.subtotal, taxAmount: totals.taxAmount,
          totalWithTax: totals.finalTotal, totalPrice: totals.finalTotal, bill: totals.bill
        };
        await kvSet(KV, `order:${id}`, order);
        await addOrderToIndex(KV, id);
        return jsonResponse({ success: true, order });
      } catch (e) { return errResponse(e.message, 500); }
    }

    // ===== 管理員 =====

    if (path === '/api/admin/login' && request.method === 'POST') {
      try {
        const { password } = await request.json();
        if (password === (env.ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD)) {
          const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
          await addToken(KV, token);
          return jsonResponse({ success: true, token });
        }
        return jsonResponse({ success: false, error: '密碼錯誤' }, 401);
      } catch (e) { return errResponse(e.message, 500); }
    }

    if (path === '/api/admin/config' && request.method === 'GET') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      await ensureInit(KV);
      const [menu, addons, options, groupMeta, settings] = await Promise.all([
        kvGet(KV, 'config:menu', []), kvGet(KV, 'config:addons', []), kvGet(KV, 'config:options', {}),
        kvGet(KV, 'config:groupMeta', {}), kvGet(KV, 'config:settings', {})
      ]);
      return jsonResponse({ success: true, menu, addons, options, groupMeta, settings });
    }

    if (path === '/api/admin/config/menu' && request.method === 'POST') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      try {
        const { menu, addons, options, groupMeta } = await request.json();
        const writes = [kvSet(KV, 'config:menu', menu || []), kvSet(KV, 'config:addons', addons || []), kvSet(KV, 'config:options', options || {})];
        if (groupMeta !== undefined) writes.push(kvSet(KV, 'config:groupMeta', groupMeta));
        await Promise.all(writes);
        return jsonResponse({ success: true });
      } catch (e) { return errResponse(e.message, 500); }
    }

    if (path === '/api/admin/config/settings' && request.method === 'POST') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      try {
        const patch = await request.json();
        const cur = await kvGet(KV, 'config:settings', {});
        await kvSet(KV, 'config:settings', mergeSettings(cur, patch));
        return jsonResponse({ success: true });
      } catch (e) { return errResponse(e.message, 500); }
    }

    if (path === '/api/admin/orders' && request.method === 'GET') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      return jsonResponse({ success: true, orders: await getAllOrders(KV) });
    }

    const orderUpdateMatch = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (orderUpdateMatch && request.method === 'PUT') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      try {
        const order = await kvGet(KV, `order:${orderUpdateMatch[1]}`);
        if (!order) return errResponse('訂單不存在', 404);
        const { status } = await request.json();
        order.status = status;
        await kvSet(KV, `order:${orderUpdateMatch[1]}`, order);
        return jsonResponse({ success: true, order });
      } catch (e) { return errResponse(e.message, 500); }
    }

    if (path === '/api/admin/stats' && request.method === 'GET') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      const all = await getAllOrders(KV);
      const valid = all.filter(o => o.status !== '取消' && o.status !== '已取消' && o.status !== 'cancelled');
      const itemMap = {};
      valid.forEach(o => (o.items || []).forEach(it => {
        if (!it || !it.item) return;
        const id = it.item.id || it.item.name;
        if (!itemMap[id]) itemMap[id] = { name: it.item.name, q: 0, r: 0 };
        itemMap[id].q += (it.quantity || 1); itemMap[id].r += (it.totalPrice || 0);
      }));
      return jsonResponse({
        success: true,
        totalRevenue: valid.reduce((s, o) => s + (o.subtotal || 0), 0),
        orderCount: valid.length,
        popularItems: Object.entries(itemMap).map(([id, s]) => ({ id, name: s.name, quantity: s.q, revenue: s.r })).sort((a, b) => b.revenue - a.revenue),
        salesTrend: [], sauceRankings: [], addonRankings: []
      });
    }

    if (path === '/api/admin/snapshots' && request.method === 'GET') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      return jsonResponse({ success: true, snapshots: await getAllSnapshots(KV) });
    }

    if (path === '/api/admin/snapshots' && request.method === 'POST') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      try {
        const snap = await request.json();
        const size = (JSON.stringify(snap.data || {}).length * 2 / (1024 * 1024)).toFixed(2) + 'MB';
        await kvSet(KV, `snapshot:${snap.id}`, { ...snap, size });
        await addSnapshotToIndex(KV, snap.id);
        return jsonResponse({ success: true });
      } catch (e) { return errResponse(e.message, 500); }
    }

    const snapDeleteMatch = path.match(/^\/api\/admin\/snapshots\/([^/]+)$/);
    if (snapDeleteMatch && request.method === 'DELETE') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      await KV.delete(`snapshot:${snapDeleteMatch[1]}`);
      await removeSnapshotFromIndex(KV, snapDeleteMatch[1]);
      return jsonResponse({ success: true });
    }

    if (path === '/api/admin/snapshots' && request.method === 'DELETE') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      const index = await kvGet(KV, 'snapshots:index', []);
      await Promise.all(index.map(id => KV.delete(`snapshot:${id}`)));
      await kvSet(KV, 'snapshots:index', []);
      return jsonResponse({ success: true });
    }

    if (path === '/api/admin/reset' && request.method === 'POST') {
      const authErr = await requireAuth(request, KV); if (authErr) return authErr;
      try {
        const { menu, addons, options, groupMeta, config } = await request.json();
        const allOrders = await kvGet(KV, 'orders:index', []);
        const allSnaps = await kvGet(KV, 'snapshots:index', []);
        await Promise.all([
          kvSet(KV, 'config:menu', menu || DEFAULT_MENU),
          kvSet(KV, 'config:addons', addons || DEFAULT_ADDONS),
          kvSet(KV, 'config:options', options || DEFAULT_OPTIONS),
          kvSet(KV, 'config:groupMeta', groupMeta || DEFAULT_GROUP_META),
          kvSet(KV, 'config:settings', config ? { kiosk_config: config } : {}),
          kvSet(KV, 'orders:index', []),
          kvSet(KV, 'snapshots:index', []),
          kvSet(KV, 'auth:tokens', []),
          ...allOrders.map(id => KV.delete(`order:${id}`)),
          ...allSnaps.map(id => KV.delete(`snapshot:${id}`))
        ]);
        return jsonResponse({ success: true });
      } catch (e) { return errResponse(e.message, 500); }
    }

    return jsonResponse({ error: 'Not Found', path }, 404);
  }
};
