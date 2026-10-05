/* The Cows Nest – shop Worker (Cloudflare Workers, no dependencies). Square is the source of truth.

   GET  /products   items from her Square catalog that belong on the website, with stock
   POST /checkout   cart -> Square order (catalog items, so Square sets every price and tax)
                    -> Square-hosted payment link
   GET  /order      ?t=<signed order token>  paid order summary + signed download links
   GET  /download   ?t=<signed file token>   streams a digital product from R2 (7-day links)

   Which items show: in the "Website" category (shop.websiteCategory in data.js) AND in one of
   the categories mapped in shop.categories. The mapping also sets each item's page and rule
   (goods / treat / digital). Digital download files: shop.downloads [{ item, file }].

   env: SITE_URL, ALLOWED_ORIGINS, SQUARE_ENV ("sandbox" | "production"), SQUARE_LOCATION_ID
   secrets: SQUARE_ACCESS_TOKEN, SIGNING_SECRET      bindings: FILES (R2) */

const SQUARE_VERSION = '2024-10-17';
const PRODUCTS_TTL = 60;          // seconds the product list is cached
const DOWNLOAD_DAYS = 7;
const ORDER_LOOKUP_DAYS = 30;
const MAX_QTY = 20;

class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/products' && req.method === 'GET') {
        const { products } = await getCatalog(env);
        return json({ products: products.filter(p => p.visible).map(publicProduct) }, 200, { ...cors, 'Cache-Control': `public, max-age=${PRODUCTS_TTL}` });
      }
      if (url.pathname === '/checkout' && req.method === 'POST') return json(await createCheckout(req, env), 200, cors);
      if (url.pathname === '/order' && req.method === 'GET') return json(await getOrder(url, env), 200, cors);
      if (url.pathname === '/download' && req.method === 'GET') return await download(url, env);
      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      const status = err instanceof UserError ? err.status : 500;
      if (status === 500) console.error(err && err.stack || err);
      return json({ error: status === 500 ? 'Something went wrong on our end. Please try again in a minute.' : err.message }, status, cors);
    }
  }
};

// ---------- helpers ----------
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Cache-Control': 'no-store', ...headers, 'Content-Type': 'application/json; charset=utf-8' }
});
const siteUrl = env => String(env.SITE_URL || '').replace(/\/+$/, '');
const squareBase = env => env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
const norm = s => String(s || '').trim().toLowerCase();

async function square(env, method, path, body) {
  const res = await fetch(`${squareBase(env)}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw new UserError('Not found.', 404);
    throw new Error(`Square ${method} ${path} -> ${res.status}: ${JSON.stringify(out.errors || out)}`);
  }
  return out;
}

async function loadSite(env) {
  const res = await fetch(`${siteUrl(env)}/assets/js/data.js`, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) throw new Error(`data.js fetch failed: ${res.status}`);
  const raw = await res.text();
  return JSON.parse(raw.slice(raw.indexOf('=') + 1, raw.trimEnd().lastIndexOf(';')));
}

// ---------- catalog -> products ----------
let memo = null; // per-isolate cache { at, value }

async function getCatalog(env) {
  if (memo && Date.now() - memo.at < PRODUCTS_TTL * 1000) return memo.value;
  const value = await buildCatalog(env);
  memo = { at: Date.now(), value };
  return value;
}

async function buildCatalog(env) {
  const [site, objects] = await Promise.all([loadSite(env), listCatalog(env)]);
  const shop = site.shop || {};
  const loc = env.SQUARE_LOCATION_ID;
  const images = new Map(), cats = new Map();
  for (const o of objects) {
    if (o.type === 'IMAGE' && o.image_data && o.image_data.url) images.set(o.id, o.image_data.url);
    if (o.type === 'CATEGORY' && o.category_data) cats.set(o.id, o.category_data.name || '');
  }
  const mapping = (shop.categories || []).filter(c => c.square && c.page);
  const websiteCat = norm(shop.websiteCategory);
  const files = new Map((shop.downloads || []).filter(d => d.item && d.file).map(d => [d.item, String(d.file)]));
  const atLocation = o => (o.present_at_all_locations !== false || (o.present_at_location_ids || []).includes(loc)) && !(o.absent_at_location_ids || []).includes(loc);

  const products = [];
  const tracked = [];
  for (const o of objects) {
    if (o.type !== 'ITEM' || !o.item_data || o.is_deleted) continue;
    const d = o.item_data;
    const catIds = [...(d.categories || []).map(c => c.id), d.category_id, d.reporting_category && d.reporting_category.id].filter(Boolean);
    const catNames = new Set(catIds.map(id => norm(cats.get(id))));
    const m = mapping.find(c => catNames.has(norm(c.square)));
    const variations = (d.variations || []).filter(v => !v.is_deleted && v.item_variation_data && atLocation(v)).map(v => {
      const vd = v.item_variation_data;
      const ov = (vd.location_overrides || []).find(x => x.location_id === loc) || {};
      const track = !!(ov.track_inventory ?? vd.track_inventory ?? false);
      if (track) tracked.push(v.id);
      return { id: v.id, name: vd.name || '', price: vd.pricing_type === 'FIXED_PRICING' && vd.price_money ? vd.price_money.amount : null,
        track, soldOut: !!ov.sold_out, stock: null };
    }).filter(v => v.price != null && v.price > 0);   // variable-price items can't be sold online
    products.push({
      id: o.id, name: d.name || '',
      description: (d.description_plaintext || stripHtml(d.description_html) || d.description || '').trim(),
      images: (d.image_ids || []).map(id => images.get(id)).filter(Boolean),
      page: m ? m.page : '', kind: m ? (m.kind || 'goods') : 'goods',
      file: files.get(o.id) || '',
      variations,
      visible: !d.is_archived && atLocation(o) && !!m && (!websiteCat || catNames.has(websiteCat)) && variations.length > 0
    });
  }
  if (tracked.length) {
    const counts = await inventoryCounts(env, tracked);
    for (const p of products) for (const v of p.variations) if (v.track) {
      v.stock = Math.max(0, Math.floor(Number(counts.get(v.id) || 0)));
      if (v.stock <= 0) v.soldOut = true;
    }
  }
  const byVariation = new Map();
  for (const p of products) for (const v of p.variations) byVariation.set(v.id, { p, v });
  return { products, byVariation, shop, site };
}

async function listCatalog(env) {
  const out = [];
  let cursor;
  do {
    const q = new URLSearchParams({ types: 'ITEM,IMAGE,CATEGORY' });
    if (cursor) q.set('cursor', cursor);
    const r = await square(env, 'GET', `/v2/catalog/list?${q}`);
    out.push(...(r.objects || []));
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function inventoryCounts(env, ids) {
  const counts = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    let cursor;
    do {
      const r = await square(env, 'POST', '/v2/inventory/counts/batch-retrieve',
        { catalog_object_ids: ids.slice(i, i + 500), location_ids: [env.SQUARE_LOCATION_ID], states: ['IN_STOCK'], cursor });
      for (const c of r.counts || []) counts.set(c.catalog_object_id, (counts.get(c.catalog_object_id) || 0) + Number(c.quantity || 0));
      cursor = r.cursor;
    } while (cursor);
  }
  return counts;
}

function stripHtml(s) {
  return String(s || '').replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n');
}

const publicProduct = p => ({
  id: p.id, name: p.name, description: p.description, images: p.images, page: p.page, kind: p.kind,
  digitalReady: p.kind !== 'digital' || !!p.file,
  variations: p.variations.map(v => ({ id: v.id, name: v.name, price: v.price, soldOut: v.soldOut, max: v.track ? Math.min(MAX_QTY, v.stock) : MAX_QTY }))
});

// ---------- POST /checkout ----------
async function createCheckout(req, env) {
  let body;
  try { body = await req.json(); } catch { throw new UserError('Bad request.'); }
  const cat = await getCatalog(env);
  const shop = cat.shop;

  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) throw new UserError('Your cart is empty.');
  let physical = false, treat = false, subtotal = 0;
  const merged = new Map();
  for (const it of items) {
    const hit = cat.byVariation.get(String(it && it.variation));
    if (!hit || !hit.p.visible) throw new UserError('Something in your cart is no longer in the shop. Please remove it and try again.');
    const { p, v } = hit;
    const label = p.name + (p.variations.length > 1 ? ` (${v.name})` : '');
    if (v.soldOut) throw new UserError(`${label} just sold out. Please remove it and try again.`);
    if (p.kind === 'digital' && !p.file) throw new UserError(`${p.name} isn't ready to sell yet. Please remove it and try again.`);
    const qty = p.kind === 'digital' ? 1 : Math.floor(Number(it.qty));
    const total = p.kind === 'digital' ? 1 : (merged.get(v.id) || 0) + qty;
    if (!(qty >= 1) || total > MAX_QTY) throw new UserError(`Quantity for ${label} must be between 1 and ${MAX_QTY}.`);
    if (v.track && total > v.stock) throw new UserError(`Only ${v.stock} of ${label} left. Please lower the quantity.`);
    subtotal += v.price * (total - (merged.get(v.id) || 0));
    merged.set(v.id, total);
    if (p.kind !== 'digital') physical = true;
    if (p.kind === 'treat') treat = true;
  }

  const c = body.contact || {};
  const clean = (o, k, n = 200) => String((o || {})[k] || '').trim().slice(0, n);
  let fulfillment = 'digital', fulfillments, serviceCharges;
  if (physical) {
    const name = clean(c, 'name'), email = clean(c, 'email'), phone = normalizePhone(clean(c, 'phone', 40));
    if (!name) throw new UserError('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Please enter a valid email address.');
    if (!phone) throw new UserError('Please enter a 10-digit phone number.');
    const recipient = { display_name: name, email_address: email, phone_number: phone };
    fulfillment = String(body.fulfillment || '');
    if (fulfillment === 'pickup') {
      if (!(shop.pickup && shop.pickup.enabled)) throw new UserError('Local pickup is not available right now.');
      fulfillments = [{ type: 'PICKUP', state: 'PROPOSED', pickup_details: { recipient, schedule_type: 'ASAP' } }];
    } else if (fulfillment === 'ship') {
      if (shop.shipping && shop.shipping.enabled === false) throw new UserError('Shipping is not available right now.');
      const a = body.shipping || {};
      const addr = { address_line_1: clean(a, 'line1'), address_line_2: clean(a, 'line2') || undefined, locality: clean(a, 'city'),
        administrative_district_level_1: clean(a, 'state').toUpperCase(), postal_code: clean(a, 'postal_code', 10), country: 'US' };
      if (!addr.address_line_1 || !addr.locality) throw new UserError('Please fill in your shipping address.');
      if (!/^[A-Z]{2}$/.test(addr.administrative_district_level_1)) throw new UserError('Please use the 2-letter state code, like SC.');
      if (!/^\d{5}(-\d{4})?$/.test(addr.postal_code)) throw new UserError('Please check your ZIP code.');
      if (treat && addr.administrative_district_level_1 !== 'SC') throw new UserError('Sweet treats can only be shipped within South Carolina. Choose local pickup, or remove the treats.');
      fulfillments = [{ type: 'SHIPMENT', state: 'PROPOSED', shipment_details: { recipient: { ...recipient, address: addr } } }];
      const sh = shop.shipping || {};
      const ship = (Number(sh.freeOver) > 0 && subtotal >= Math.round(Number(sh.freeOver) * 100)) ? 0 : Math.max(0, Math.round(Number(sh.flat || 0) * 100));
      if (ship) serviceCharges = [{ name: 'Shipping', amount_money: { amount: ship, currency: 'USD' }, calculation_phase: 'TOTAL_PHASE' }];
    } else {
      throw new UserError('Please choose pickup or shipping.');
    }
  }

  const link = await square(env, 'POST', '/v2/online-checkout/payment-links', {
    idempotency_key: crypto.randomUUID(),
    order: {
      location_id: env.SQUARE_LOCATION_ID,
      reference_id: 'web-' + Date.now().toString(36),
      source: { name: 'thecowsnest.com' },
      line_items: [...merged.entries()].map(([id, qty]) => ({ catalog_object_id: id, quantity: String(qty) })),
      pricing_options: { auto_apply_taxes: true, auto_apply_discounts: false },
      service_charges: serviceCharges,
      fulfillments,
      metadata: { fulfillment }
    },
    checkout_options: {
      allow_tipping: false,
      ask_for_shipping_address: false,
      merchant_support_email: (cat.site.site && cat.site.site.email) || undefined,
      redirect_url: `${siteUrl(env)}/thank-you.html`
    }
  });
  const pl = link.payment_link;
  // Point the redirect at a signed token for this order (Square doesn't append the order id in sandbox).
  const token = await sign(env, { o: pl.order_id });
  await square(env, 'PUT', `/v2/online-checkout/payment-links/${pl.id}`, {
    payment_link: { version: pl.version, checkout_options: { redirect_url: `${siteUrl(env)}/thank-you.html?t=${token}` } }
  });
  return { url: pl.url };
}

function normalizePhone(s) {
  const d = String(s).replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

// ---------- GET /order ----------
async function getOrder(url, env) {
  const t = await verify(env, url.searchParams.get('t'));
  if (!t || !t.o) throw new UserError('Order not found.', 404);
  const { order } = await square(env, 'GET', `/v2/orders/${encodeURIComponent(t.o)}`);
  const paid = order.state !== 'DRAFT' && (order.tenders || []).length > 0 && (!order.net_amount_due_money || order.net_amount_due_money.amount === 0);
  if (!paid) return { status: 'unpaid' };
  if (Date.parse(order.created_at) < Date.now() - ORDER_LOOKUP_DAYS * 86400000) throw new UserError('This order page has expired. Contact us and we will help.', 410);

  const cat = await getCatalog(env);
  const ful = (order.fulfillments || [])[0];
  const rec = ful && (ful.pickup_details || ful.shipment_details || {}).recipient;
  let email = rec && rec.email_address;
  if (!email && order.tenders[0].payment_id) {
    const r = await square(env, 'GET', `/v2/payments/${order.tenders[0].payment_id}`).catch(() => ({}));
    email = r.payment && r.payment.buyer_email_address;
  }
  const downloads = [];
  for (const li of order.line_items || []) {
    const hit = cat.byVariation.get(li.catalog_object_id);
    if (hit && hit.p.kind === 'digital' && hit.p.file) {
      const token = await sign(env, { f: hit.p.file, e: Math.floor(Date.now() / 1000) + DOWNLOAD_DAYS * 86400 });
      downloads.push({ name: hit.p.name, url: `${url.origin}/download?t=${token}` });
    }
  }
  return {
    status: 'paid',
    email: email || '',
    total: order.total_money ? order.total_money.amount : 0,
    fulfillment: (order.metadata && order.metadata.fulfillment) || '',
    items: (order.line_items || []).map(li => ({
      name: li.name + (li.variation_name && li.variation_name !== 'Regular' ? ` (${li.variation_name})` : ''),
      qty: Number(li.quantity), total: li.total_money ? li.total_money.amount : 0
    })),
    downloads
  };
}

// ---------- signing + downloads ----------
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const hmacKey = env => {
  if (!env.SIGNING_SECRET || env.SIGNING_SECRET.length < 32) throw new Error('SIGNING_SECRET missing or too short');
  return crypto.subtle.importKey('raw', enc.encode(env.SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
};
async function sign(env, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)))}`;
}
async function verify(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    if (!await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode(body))) return null;
    return JSON.parse(new TextDecoder().decode(unb64u(body)));
  } catch { return null; }
}

const page = (status, msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>The Cows Nest</title><p style="font:18px/1.5 Georgia,serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${msg}</p>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function download(url, env) {
  const t = await verify(env, url.searchParams.get('t'));
  if (!t || !t.f) return page(403, 'This download link is not valid. Please use the link from your order page.');
  if (Date.now() / 1000 > t.e) return page(410, 'This download link has expired. Please contact us and we will send you a new one.');
  const obj = await env.FILES.get(t.f);
  if (!obj) { console.error('missing R2 object', t.f); return page(404, 'We could not find this file. Please contact us and we will sort it out.'); }
  const name = String(t.f).split('/').pop().replace(/[^\w.\- ]+/g, '_');
  return new Response(obj.body, { headers: {
    'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store',
    ...(obj.size != null ? { 'Content-Length': String(obj.size) } : {}) } });
}

export const _test = { sign, verify, normalizePhone, resetCache: () => { memo = null; } };
