// Offline test: node test.mjs   (mocks data.js, Square API and R2)
import worker, { _test } from './src/index.js';
import assert from 'node:assert/strict';

const LOC = 'LOC1';
const SITE = { site: { email: 'hello@thecowsnest.com' }, shop: {
  websiteCategory: 'Website',
  categories: [{ label: 'Handmade Goods', page: 'handmade-goods', square: 'Handmade', kind: 'goods' },
               { label: 'Sweet Treats', page: 'sweet-treats', square: 'Sweet Treats', kind: 'treat' },
               { label: 'Digital', page: 'digital-downloads', square: 'Digital', kind: 'digital' }],
  downloads: [{ item: 'ITEM_PDF', file: 'coloring.pdf' }],
  pickup: { enabled: true, note: 'We text you.' }, shipping: { enabled: true, flat: 8, freeOver: 75 } } };
const v = (id, name, amount, extra = {}) => ({ type: 'ITEM_VARIATION', id, present_at_all_locations: true,
  item_variation_data: { name, pricing_type: 'FIXED_PRICING', price_money: { amount, currency: 'USD' }, ...extra } });
const item = (id, name, cats, variations, extra = {}) => ({ type: 'ITEM', id, present_at_all_locations: true,
  item_data: { name, description_plaintext: name + ' desc', categories: cats.map(c => ({ id: c })), image_ids: ['IMG1'], variations, ...extra } });
const CATALOG = [
  { type: 'CATEGORY', id: 'C_WEB', category_data: { name: 'Website' } },
  { type: 'CATEGORY', id: 'C_HAND', category_data: { name: 'Handmade' } },
  { type: 'CATEGORY', id: 'C_TREAT', category_data: { name: 'Sweet Treats' } },
  { type: 'CATEGORY', id: 'C_DIG', category_data: { name: 'Digital' } },
  { type: 'IMAGE', id: 'IMG1', image_data: { url: 'https://items-images.square/img1.jpg' } },
  item('ITEM_MUG', 'Cow Mug', ['C_WEB', 'C_HAND'], [v('V_MUG_S', 'Small', 1800), v('V_MUG_L', 'Large', 2400, { track_inventory: true })]),
  item('ITEM_PIE', 'Blueberry Pie', ['C_WEB', 'C_TREAT'], [v('V_PIE', 'Regular', 2250)]),
  item('ITEM_PDF', 'Coloring Pages', ['C_WEB', 'C_DIG'], [v('V_PDF', 'Regular', 500)]),
  item('ITEM_MARKET', 'Market Only Jam', ['C_TREAT'], [v('V_JAM', 'Regular', 800)]),                       // not in Website
  item('ITEM_SOLD', 'Sold Wreath', ['C_WEB', 'C_HAND'], [v('V_SOLD', 'Regular', 3000, { location_overrides: [{ location_id: LOC, sold_out: true }] })]),
  item('ITEM_VAR', 'Custom Order', ['C_WEB', 'C_HAND'], [{ ...v('V_VAR', 'Regular', 0), item_variation_data: { name: 'Regular', pricing_type: 'VARIABLE_PRICING' } }]),
  item('ITEM_ARCH', 'Old', ['C_WEB', 'C_HAND'], [v('V_ARCH', 'Regular', 100)], { is_archived: true }),
  item('ITEM_PDF2', 'No File PDF', ['C_WEB', 'C_DIG'], [v('V_PDF2', 'Regular', 500)])
];
let created, updated, stock = { V_MUG_L: '3' }, orderPaid = true;
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const body = init.body ? JSON.parse(init.body) : null;
  if (url === 'https://thecowsnest.com/assets/js/data.js') return new Response(`window.CN_DATA = ${JSON.stringify(SITE)};`);
  assert.ok(url.startsWith('https://connect.squareupsandbox.com/'), url);
  assert.equal(init.headers.Authorization, 'Bearer sq_test');
  const p = url.replace('https://connect.squareupsandbox.com', '');
  if (p.startsWith('/v2/catalog/list')) {
    // paginate in two pages to prove cursor handling
    const page2 = p.includes('cursor=');
    return Response.json(page2 ? { objects: CATALOG.slice(6) } : { objects: CATALOG.slice(0, 6), cursor: 'NEXT' });
  }
  if (p === '/v2/inventory/counts/batch-retrieve') return Response.json({ counts: body.catalog_object_ids.filter(id => stock[id]).map(id => ({ catalog_object_id: id, quantity: stock[id], state: 'IN_STOCK' })) });
  if (p === '/v2/online-checkout/payment-links' && init.method === 'POST') {
    created = body;
    return Response.json({ payment_link: { id: 'PL1', version: 1, order_id: 'ORDER1', url: 'https://square.link/u/abc' } });
  }
  if (p === '/v2/online-checkout/payment-links/PL1' && init.method === 'PUT') { updated = body; return Response.json({ payment_link: {} }); }
  if (p === '/v2/orders/ORDER1') return Response.json({ order: { id: 'ORDER1', state: orderPaid ? 'OPEN' : 'DRAFT', created_at: new Date().toISOString(),
    tenders: orderPaid ? [{ payment_id: 'PAY1' }] : [], net_amount_due_money: { amount: 0 }, total_money: { amount: 2300 }, metadata: { fulfillment: 'pickup' },
    fulfillments: [{ type: 'PICKUP', pickup_details: { recipient: { email_address: 'a@b.com' } } }],
    line_items: [{ name: 'Cow Mug', variation_name: 'Small', quantity: '1', total_money: { amount: 1800 }, catalog_object_id: 'V_MUG_S' },
                 { name: 'Coloring Pages', variation_name: 'Regular', quantity: '1', total_money: { amount: 500 }, catalog_object_id: 'V_PDF' }] } });
  throw new Error('unexpected ' + init.method + ' ' + p);
};
const env = { SITE_URL: 'https://thecowsnest.com', ALLOWED_ORIGINS: 'https://thecowsnest.com', SQUARE_ENV: 'sandbox', SQUARE_LOCATION_ID: LOC,
  SQUARE_ACCESS_TOKEN: 'sq_test', SIGNING_SECRET: 's'.repeat(40),
  FILES: { get: async k => k === 'coloring.pdf' ? { body: 'PDF!', size: 4, httpMetadata: { contentType: 'application/pdf' } } : null } };
const get = path => worker.fetch(new Request('https://w.dev' + path, { headers: { Origin: 'https://thecowsnest.com' } }), env);
const post = body => worker.fetch(new Request('https://w.dev/checkout', { method: 'POST', headers: { Origin: 'https://thecowsnest.com' }, body: JSON.stringify(body) }), env);
let pass = 0; const ok = n => { pass++; console.log('  ✓', n); };
const contact = { name: 'Jo Smith', email: 'jo@example.com', phone: '(864) 555-1212' };

// products
let r = await get('/products'); let out = await r.json();
const names = out.products.map(p => p.name).sort();
assert.deepEqual(names, ['Blueberry Pie', 'Coloring Pages', 'Cow Mug', 'No File PDF', 'Sold Wreath']);
const mug = out.products.find(p => p.id === 'ITEM_MUG');
assert.equal(mug.page, 'handmade-goods'); assert.equal(mug.images[0], 'https://items-images.square/img1.jpg');
assert.deepEqual(mug.variations.map(x => [x.name, x.price, x.max, x.soldOut]), [['Small', 1800, 20, false], ['Large', 2400, 3, false]]);
assert.equal(out.products.find(p => p.id === 'ITEM_SOLD').variations[0].soldOut, true);
assert.equal(out.products.find(p => p.id === 'ITEM_PIE').kind, 'treat');
assert.equal(out.products.find(p => p.id === 'ITEM_PDF2').digitalReady, false);
assert.match(r.headers.get('cache-control'), /max-age=60/);
ok('products: Website + mapped category only; archived, variable-price, market-only excluded; stock + sold-out; pagination');

// checkout pickup
r = await post({ items: [{ variation: 'V_MUG_S', qty: 2 }, { variation: 'V_MUG_S', qty: 1 }, { variation: 'V_PDF', qty: 9 }], fulfillment: 'pickup', contact });
out = await r.json(); assert.equal(r.status, 200, JSON.stringify(out)); assert.equal(out.url, 'https://square.link/u/abc');
assert.deepEqual(created.order.line_items, [{ catalog_object_id: 'V_MUG_S', quantity: '3' }, { catalog_object_id: 'V_PDF', quantity: '1' }]);
assert.equal(created.order.location_id, LOC); assert.equal(created.order.pricing_options.auto_apply_taxes, true);
assert.equal(created.order.fulfillments[0].type, 'PICKUP');
assert.deepEqual(created.order.fulfillments[0].pickup_details.recipient, { display_name: 'Jo Smith', email_address: 'jo@example.com', phone_number: '+18645551212' });
assert.equal(created.order.service_charges, undefined);
assert.ok(!JSON.stringify(created).includes('base_price_money'), 'never sends prices; Square prices from catalog');
assert.match(updated.payment_link.checkout_options.redirect_url, /^https:\/\/thecowsnest\.com\/thank-you\.html\?t=/);
ok('pickup checkout: catalog line items merged, Square prices + taxes, recipient, signed redirect');

// shipping
r = await post({ items: [{ variation: 'V_MUG_S', qty: 1 }], fulfillment: 'ship', contact, shipping: { line1: '1 Main', city: 'Atlanta', state: 'ga', postal_code: '30301' } });
assert.equal(r.status, 200); assert.equal(created.order.fulfillments[0].shipment_details.recipient.address.administrative_district_level_1, 'GA');
assert.equal(created.order.service_charges[0].amount_money.amount, 800);
r = await post({ items: [{ variation: 'V_MUG_L', qty: 3 }, { variation: 'V_MUG_S', qty: 1 }], fulfillment: 'ship', contact, shipping: { line1: '1', city: 'C', state: 'SC', postal_code: '29630' } });
assert.equal(r.status, 200); assert.equal(created.order.service_charges, undefined); // 3*24 + 18 = 90 >= 75 -> free
ok('shipping: flat fee as service charge, free over threshold');

const bad = async (body, re, status = 400) => { const res = await post(body); const o = await res.json(); assert.equal(res.status, status, JSON.stringify(o)); assert.match(o.error, re); };
const ship = st => ({ line1: '1', city: 'C', state: st, postal_code: '30301' });
await bad({ items: [{ variation: 'V_PIE', qty: 1 }], fulfillment: 'ship', contact, shipping: ship('GA') }, /South Carolina/);
await bad({ items: [{ variation: 'V_SOLD', qty: 1 }], fulfillment: 'pickup', contact }, /sold out/);
await bad({ items: [{ variation: 'V_JAM', qty: 1 }], fulfillment: 'pickup', contact }, /no longer/);
await bad({ items: [{ variation: 'V_ARCH', qty: 1 }], fulfillment: 'pickup', contact }, /no longer/);
await bad({ items: [{ variation: 'V_MUG_L', qty: 4 }], fulfillment: 'pickup', contact }, /Only 3/);
await bad({ items: [{ variation: 'V_PDF2', qty: 1 }] }, /isn't ready/);
await bad({ items: [{ variation: 'V_PIE', qty: 1 }], fulfillment: 'pickup', contact: { ...contact, phone: '123' } }, /phone/);
await bad({ items: [{ variation: 'V_PIE', qty: 1 }], fulfillment: 'pickup', contact: { ...contact, email: 'x' } }, /email/);
await bad({ items: [{ variation: 'V_PIE', qty: 1 }], contact }, /pickup or shipping/);
await bad({ items: [] }, /empty/);
ok('rules: SC-only treats, sold out, not on website, archived, stock limit, digital w/o file, contact, fulfillment');
r = await post({ items: [{ variation: 'V_PDF', qty: 1 }] }); assert.equal(r.status, 200); assert.equal(created.order.fulfillments, undefined);
ok('digital-only: no contact or fulfillment needed');

// order + download
const t = new URL(updated.payment_link.checkout_options.redirect_url).searchParams.get('t');
r = await get('/order?t=' + encodeURIComponent(t)); out = await r.json();
assert.equal(out.status, 'paid'); assert.equal(out.email, 'a@b.com'); assert.equal(out.items[0].name, 'Cow Mug (Small)'); assert.equal(out.items[1].name, 'Coloring Pages');
assert.equal(out.downloads.length, 1);
const dl = await worker.fetch(new Request(out.downloads[0].url), env);
assert.equal(dl.status, 200); assert.equal(await dl.text(), 'PDF!');
ok('thank-you: signed order token -> paid summary + working download');
orderPaid = false; r = await get('/order?t=' + encodeURIComponent(t)); assert.equal((await r.json()).status, 'unpaid'); orderPaid = true;
assert.equal((await get('/order?t=forged.token')).status, 404);
assert.equal((await get('/order?t=' + encodeURIComponent(await _test.sign({ SIGNING_SECRET: 'x'.repeat(40) }, { o: 'ORDER1' })))).status, 404);
assert.equal((await worker.fetch(new Request('https://w.dev/download?t=' + await _test.sign(env, { f: 'coloring.pdf', e: 1 })), env)).status, 410);
ok('unpaid orders, forged/wrong-key tokens and expired downloads rejected');
console.log(`\n${pass} checks passed`);
