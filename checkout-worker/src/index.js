/* The Cows Nest – shop Worker (Cloudflare Workers, no dependencies). Square is the source of truth.

   GET  /products   items from her Square catalog that belong on the website, with stock
   POST /checkout   cart -> Square order (catalog items, so Square sets every price and tax)
                    -> Square-hosted payment link
   GET  /order      ?t=<signed order token>  paid order summary + signed download links
   GET  /download   ?t=<signed file token>   streams a digital product from R2 (7-day links)
   POST /subscribe  email -> Square customer list ("Join the herd")
   POST /square-webhook  Square payment events -> emails her each paid website order

   Which items show: in the "Website" category (shop.websiteCategory in data.js) AND in one of
   the categories mapped in shop.categories. The mapping also sets each item's page and rule
   (goods / treat / digital). Digital download files: shop.downloads [{ item, file }].

   Shipping size: an item's size comes from a Square category listed in shop.shipping.sizes
   ("Ship: Envelope", "Ship: Small box", "Ship: Large box"). Shipping for an order = price of
   the biggest size in it + shop.shipping.extraItem for each item after the first. Items with no
   size use shop.shipping.flat. Free when the subtotal reaches shop.shipping.freeOver.

   env: SITE_URL, ALLOWED_ORIGINS, SQUARE_ENV ("sandbox" | "production"), SQUARE_LOCATION_ID
   secrets: SQUARE_ACCESS_TOKEN, SIGNING_SECRET, SQUARE_WEBHOOK_KEY
   bindings: FILES (R2), ORDER_MAIL (Cloudflare send_email)
   env for order emails: ORDER_EMAIL_TO, ORDER_EMAIL_FROM, WEBHOOK_URL */

const SQUARE_VERSION = '2024-10-17';
const PRODUCTS_TTL = 60;          // seconds the product list is cached
const DOWNLOAD_DAYS = 7;
const ORDER_LOOKUP_DAYS = 30;
const MAX_QTY = 20;
// Lower 48 states + DC (no Alaska, Hawaii, territories or military APO/FPO)
const LOWER48 = new Set(('AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY ' +
  'NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '));

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
      if (url.pathname === '/subscribe' && req.method === 'POST') return json(await subscribe(req, env), 200, cors);
      if (url.pathname === '/square-webhook' && req.method === 'POST') return await squareWebhook(req, env);
      if (url.pathname === '/order' && req.method === 'GET') return json(await getOrder(url, env), 200, cors);
      if (url.pathname === '/download' && req.method === 'GET') return await download(url, env);
      if (url.pathname.startsWith('/admin/')) return json(await admin(req, url, env), 200, cors);
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
  const h = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
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
  const [site, objects, stored] = await Promise.all([loadSite(env), listCatalog(env), listFiles(env)]);
  const shop = site.shop || {};
  const loc = env.SQUARE_LOCATION_ID;
  const images = new Map(), cats = new Map();
  for (const o of objects) {
    if (o.type === 'IMAGE' && o.image_data && o.image_data.url) images.set(o.id, o.image_data.url);
    if (o.type === 'CATEGORY' && o.category_data) cats.set(o.id, o.category_data.name || '');
  }
  const mapping = (shop.categories || []).filter(c => c.square && c.page);
  const sizes = shipSizes(shop);
  const websiteCat = norm(shop.websiteCategory);
  // files uploaded from the editor (R2: downloads/<item id>/<name>) win over older data.js entries
  const files = new Map((shop.downloads || []).filter(d => d.item && d.file).map(d => [d.item, String(d.file)]));
  for (const [item, f] of stored) files.set(item, f.key);
  const atLocation = o => (o.present_at_all_locations !== false || (o.present_at_location_ids || []).includes(loc)) && !(o.absent_at_location_ids || []).includes(loc);

  const products = [];
  const tracked = [];
  for (const o of objects) {
    if (o.type !== 'ITEM' || !o.item_data || o.is_deleted) continue;
    const d = o.item_data;
    const catIds = [...(d.categories || []).map(c => c.id), d.category_id, d.reporting_category && d.reporting_category.id].filter(Boolean);
    const catNames = new Set(catIds.map(id => norm(cats.get(id))));
    const m = mapping.find(c => catNames.has(norm(c.square)));
    const size = sizes.find(z => catNames.has(norm(z.square)));
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
      ship: size ? size.label : '',
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
  id: p.id, name: p.name, description: p.description, images: p.images, page: p.page, kind: p.kind, ship: p.ship,
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
  const shipLines = [];
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
    if (p.kind !== 'digital') { physical = true; shipLines.push({ ship: p.ship, qty }); }
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
      if (shop.shipping && shop.shipping.lower48Only !== false && !LOWER48.has(addr.administrative_district_level_1))
        throw new UserError('Sorry, we only ship within the lower 48 states. Choose local pickup, or use an address in the lower 48.');
      if (treat && addr.administrative_district_level_1 !== 'SC') throw new UserError('Sweet treats can only be shipped within South Carolina. Choose local pickup, or remove the treats.');
      fulfillments = [{ type: 'SHIPMENT', state: 'PROPOSED', shipment_details: { recipient: { ...recipient, address: addr } } }];
      const ship = shippingCost(shop, shipLines, subtotal);
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

// Same rule as shop.js shows in the cart. Returns cents.
function shipSizes(shop) {
  const sh = shop.shipping || {};
  return (Array.isArray(sh.sizes) ? sh.sizes : []).filter(z => z && z.square && z.label);
}
function shippingCost(shop, lines, subtotal) {
  const sh = shop.shipping || {};
  const cents = n => Math.max(0, Math.round((Number(n) || 0) * 100));
  const count = lines.reduce((t, l) => t + l.qty, 0);
  if (!count) return 0;
  if (Number(sh.freeOver) > 0 && subtotal >= cents(sh.freeOver)) return 0;
  const sizes = shipSizes(shop);
  const priceOf = label => { const z = sizes.find(x => x.label === label); return z ? cents(z.price) : cents(sh.flat); };
  const biggest = Math.max(...lines.map(l => priceOf(l.ship)));
  return biggest + (count - 1) * cents(sh.extraItem);
}

function normalizePhone(s) {
  const d = String(s).replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

// ---------- POST /subscribe ----------
async function subscribe(req, env) {
  let body;
  try { body = await req.json(); } catch { throw new UserError('Bad request.'); }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Please enter a valid email address.');
  const found = await square(env, 'POST', '/v2/customers/search', {
    query: { filter: { email_address: { exact: email } } }, limit: 1
  });
  if (!(found.customers && found.customers.length)) {
    await square(env, 'POST', '/v2/customers', {
      idempotency_key: crypto.randomUUID(),
      email_address: email,
      note: 'Joined the herd on thecowsnest.com'
    });
  }
  return { ok: true };
}

// ---------- POST /square-webhook: email her when a website order is paid ----------
// Square Developer Dashboard -> Webhooks: URL https://shop.thecowsnest.com/square-webhook,
// events payment.created + payment.updated. Its signature key -> secret SQUARE_WEBHOOK_KEY.
async function squareWebhook(req, env) {
  const body = await req.text();
  if (!env.SQUARE_WEBHOOK_KEY) { console.error('SQUARE_WEBHOOK_KEY is not set'); return new Response('not set up', { status: 503 }); }
  const url = env.WEBHOOK_URL || 'https://shop.thecowsnest.com/square-webhook';
  if (!await squareSignatureOk(env.SQUARE_WEBHOOK_KEY, url + body, req.headers.get('x-square-hmacsha256-signature')))
    return new Response('bad signature', { status: 403 });
  let ev;
  try { ev = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
  const pay = ev && ev.data && ev.data.object && ev.data.object.payment;
  if (pay && pay.status === 'COMPLETED' && pay.order_id) await notifyOrder(env, pay.order_id, pay);
  return new Response('ok');
}

async function squareSignatureOk(key, payload, sig) {
  if (!sig) return false;
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mine = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(payload)))));
  if (mine.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function notifyOrder(env, orderId, pay) {
  const { order } = await square(env, 'GET', `/v2/orders/${encodeURIComponent(orderId)}`);
  if (!order || !String(order.reference_id || '').startsWith('web-')) return;   // in-person sale, not the website
  if (order.metadata && order.metadata.notified) return;                          // already emailed
  const { subject, text } = orderEmail(order, pay);
  await sendMail(env, subject, text);
  try {    // remember it was sent, so Square's repeat events don't email twice
    await square(env, 'PUT', `/v2/orders/${encodeURIComponent(orderId)}`, {
      idempotency_key: crypto.randomUUID(),
      order: { location_id: order.location_id, version: order.version, metadata: { ...(order.metadata || {}), notified: new Date().toISOString() } }
    });
  } catch (e) { console.error('could not mark order notified', orderId, e && e.message); }
}

const usd = m => '$' + (((m && m.amount) || 0) / 100).toFixed(2);

function orderEmail(order, pay) {
  const ful = (order.fulfillments || [])[0];
  const how = (order.metadata && order.metadata.fulfillment) || (ful ? (ful.type === 'SHIPMENT' ? 'ship' : 'pickup') : 'digital');
  const d = ful && (ful.shipment_details || ful.pickup_details) || {};
  const r = d.recipient || {};
  const a = r.address || {};
  const name = r.display_name || '';
  const email = r.email_address || (pay && pay.buyer_email_address) || '';
  const label = { ship: 'SHIP IT', pickup: 'LOCAL PICKUP', digital: 'Digital download' }[how] || how;
  const L = [];
  L.push(`New website order: ${label}`, '');
  for (const li of order.line_items || [])
    L.push(`  ${li.quantity} x ${li.name}${li.variation_name && li.variation_name !== 'Regular' ? ` (${li.variation_name})` : ''}   ${usd(li.total_money)}`);
  L.push('');
  if (order.total_service_charge_money && order.total_service_charge_money.amount) L.push(`Shipping charged: ${usd(order.total_service_charge_money)}`);
  if (order.total_tax_money && order.total_tax_money.amount) L.push(`Sales tax: ${usd(order.total_tax_money)}`);
  L.push(`TOTAL PAID: ${usd(order.total_money)}`, '');
  if (how === 'ship') {
    L.push('SHIP TO:', `  ${name}`, `  ${a.address_line_1 || ''}`);
    if (a.address_line_2) L.push(`  ${a.address_line_2}`);
    L.push(`  ${a.locality || ''}, ${a.administrative_district_level_1 || ''} ${a.postal_code || ''}`, '');
  } else if (how === 'pickup') {
    L.push(`PICKUP FOR: ${name}`, 'Text them when it is ready.', '');
  }
  if (r.phone_number) L.push(`Phone: ${r.phone_number}`);
  if (email) L.push(`Email: ${email}`);
  L.push('', `Square order: ${order.id}`, `Website order: ${order.reference_id}`, '',
    how === 'ship' ? 'Buy the label in Pirate Ship (the order comes in from Square), or open it in Square:' : 'See it in Square:',
    'https://app.squareup.com/dashboard/orders/overview');
  const subject = `New order: ${how === 'ship' ? 'Ship to' : how === 'pickup' ? 'Pickup for' : 'Download for'} ${name || email || 'a customer'} - ${usd(order.total_money)}`;
  return { subject, text: L.join('\n') };
}

async function sendMail(env, subject, text) {
  if (!env.ORDER_MAIL || !env.ORDER_EMAIL_TO) { console.error('Order email is not set up (ORDER_MAIL / ORDER_EMAIL_TO). Not sent:', subject); return; }
  const from = env.ORDER_EMAIL_FROM || 'orders@thecowsnest.com', to = env.ORDER_EMAIL_TO;
  try {
    await env.ORDER_MAIL.send({ from, to, subject, text });
  } catch (first) {
    // older binding style: a raw message
    const { EmailMessage } = await import('cloudflare:email');
    const b64 = t => btoa(String.fromCharCode(...enc.encode(t)));
    const body = b64(text).replace(/.{76}/g, '$&\r\n');
    const raw = [`From: The Cows Nest website <${from}>`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@thecowsnest.com>`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
    try { await env.ORDER_MAIL.send(new EmailMessage(from, to, raw)); }
    catch (second) { throw new Error(`Order email failed: ${first && first.message} / ${second && second.message}`); }
  }
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

// ---------- digital download files (uploaded from the editor) ----------
const FILE_PREFIX = 'downloads/';
const MAX_UPLOAD = 95 * 1024 * 1024;

async function listFiles(env) {
  const out = new Map();
  if (!env.FILES) return out;
  let cursor;
  do {
    const r = await env.FILES.list({ prefix: FILE_PREFIX, cursor });
    for (const o of r.objects) {
      const [, item, ...rest] = o.key.split('/');
      if (item && rest.length) out.set(item, { key: o.key, name: rest.join('/'), size: o.size, uploaded: o.uploaded });
    }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}

// Only a device connected for publishing may manage files: the same GitHub key must be
// able to push to the website's repo.
const adminOk = new Map(); // token hash -> expiry
async function checkAdmin(req, env) {
  const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok) throw new UserError('Connect this device first (Settings \u2192 Connect this device).', 401);
  const hash = b64u(await crypto.subtle.digest('SHA-256', enc.encode(tok)));
  if ((adminOk.get(hash) || 0) > Date.now()) return;
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || 'run-n-play/thecowsnest'}`, {
    headers: { 'Authorization': `Bearer ${tok}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'cowsnest-shop' } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !(j.permissions && (j.permissions.push || j.permissions.admin)))
    throw new UserError('This device\u2019s publishing key can\u2019t manage files. Ask Russell to check it.', 403);
  adminOk.set(hash, Date.now() + 10 * 60 * 1000);
}

async function admin(req, url, env) {
  await checkAdmin(req, env);
  if (!env.FILES) throw new UserError('File storage isn\u2019t switched on yet. Russell needs to turn on R2.', 503);
  const item = url.searchParams.get('item') || '';
  const needItem = () => { if (!/^[A-Za-z0-9]{6,64}$/.test(item)) throw new UserError('Unknown item.'); };
  const clear = async () => { const old = (await listFiles(env)).get(item); if (old) await env.FILES.delete(old.key); };

  if (url.pathname === '/admin/files' && req.method === 'GET') {
    return { files: [...(await listFiles(env))].map(([it, f]) => ({ item: it, name: f.name, size: f.size, uploaded: f.uploaded })) };
  }
  if (url.pathname === '/admin/file' && req.method === 'PUT') {
    needItem();
    const name = String(url.searchParams.get('name') || '').split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) throw new UserError('That file needs a name with an ending like .pdf or .zip.');
    const len = Number(req.headers.get('Content-Length') || 0);
    if (!len) throw new UserError('That file is empty.');
    if (len > MAX_UPLOAD) throw new UserError('That file is too big (over 95 MB). Try zipping it or splitting it up.');
    await clear();
    const key = `${FILE_PREFIX}${item}/${name}`;
    const body = len <= 25 * 1024 * 1024 ? await req.arrayBuffer() : req.body;
    await env.FILES.put(key, body, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' } });
    memo = null;
    return { item, name, size: len };
  }
  if (url.pathname === '/admin/file' && req.method === 'DELETE') {
    needItem(); await clear(); memo = null;
    return { item, removed: true };
  }
  if (url.pathname === '/admin/file-link' && req.method === 'GET') {
    needItem();
    const f = (await listFiles(env)).get(item);
    if (!f) throw new UserError('No file for that item yet.', 404);
    const token = await sign(env, { f: f.key, e: Math.floor(Date.now() / 1000) + 600 });
    return { url: `${url.origin}/download?t=${token}` };
  }
  throw new UserError('Not found.', 404);
}

const page = (status, msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>The Cows Nest</title><p style="font:18px/1.5 Georgia,serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${msg}</p>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function download(url, env) {
  const t = await verify(env, url.searchParams.get('t'));
  if (!t || !t.f) return page(403, 'This download link is not valid. Please use the link from your order page.');
  if (Date.now() / 1000 > t.e) return page(410, 'This download link has expired. Please contact us and we will send you a new one.');
  if (!env.FILES) return page(503, 'Downloads are not available right now. Please contact us and we will send your file.');
  const obj = await env.FILES.get(t.f);
  if (!obj) { console.error('missing R2 object', t.f); return page(404, 'We could not find this file. Please contact us and we will sort it out.'); }
  const name = String(t.f).split('/').pop().replace(/[^\w.\- ]+/g, '_');
  return new Response(obj.body, { headers: {
    'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store',
    ...(obj.size != null ? { 'Content-Length': String(obj.size) } : {}) } });
}

export const _test = { sign, verify, normalizePhone, shippingCost, squareSignatureOk, orderEmail, resetCache: () => { memo = null; } };
