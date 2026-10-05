/* The Cows Nest – storefront.
   Products come from her Square catalog through the shop Worker (shop.checkoutUrl in data.js).
   The cart lives in this browser. Square sets every price and tax at checkout; nothing typed
   into this page can change what gets charged. */
(function () {
  'use strict';
  if (window.__cnShop) return; window.__cnShop = true;

  const KEY = 'cn-cart-v2';
  const FORM_KEY = 'cn-checkout';
  const CN = () => window.CN || {};
  const data = () => CN().data || window.CN_DATA || {};
  const shop = () => data().shop || {};
  const api = () => String(shop().checkoutUrl || '').replace(/\/+$/, '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paras = s => (CN().paras ? CN().paras(s) : `<p>${esc(s)}</p>`);
  const money = cents => '$' + ((Number(cents) || 0) / 100).toFixed(2);
  const KIND_NOTE = {
    treat: 'Sweet treats are for local pickup or shipping within South Carolina only.',
    digital: 'Instant download right after you pay.'
  };

  // ---------- products (fetched once per page) ----------
  let productsPromise = null;
  function loadProducts() {
    if (!api()) return Promise.resolve(null);
    if (!productsPromise) {
      productsPromise = fetch(api() + '/products').then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
        .then(j => { const m = new Map(); for (const p of j.products || []) m.set(p.id, p); return m; })
        .catch(err => { console.error('products', err); productsPromise = null; return 'error'; });
    }
    return productsPromise;
  }
  const findVariation = (map, vid) => {
    for (const p of map.values()) { const v = p.variations.find(x => x.id === vid); if (v) return { p, v }; }
    return null;
  };
  const priceText = p => {
    const live = p.variations.filter(v => !v.soldOut);
    const prices = (live.length ? live : p.variations).map(v => v.price);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    return lo === hi ? money(lo) : `From ${money(lo)}`;
  };
  const allSold = p => p.variations.every(v => v.soldOut);
  const notReady = p => p.kind === 'digital' && !p.digitalReady;

  // ---------- storage ----------
  const read = (store, key, fallback) => { try { const v = JSON.parse(store.getItem(key)); return v ?? fallback; } catch { return fallback; } };
  const write = (store, key, v) => { try { store.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } };
  let memCart = null;
  const loadCart = () => { const c = memCart || read(localStorage, KEY, []); return Array.isArray(c) ? c.filter(l => l && l.variation && l.qty > 0) : []; };
  const saveCart = c => { memCart = c; write(localStorage, KEY, c); refreshCart(); };
  const form = Object.assign({ fulfillment: '', name: '', email: '', phone: '', line1: '', line2: '', city: '', state: 'SC', postal: '' }, read(sessionStorage, FORM_KEY, {}));
  const saveForm = () => write(sessionStorage, FORM_KEY, form);

  function updateHeader() {
    const n = loadCart().reduce((t, l) => t + l.qty, 0);
    document.querySelectorAll('.account-links a[href="cart.html"]').forEach(a => {
      const t = [...a.childNodes].reverse().find(x => x.nodeType === 3);
      if (t) t.textContent = `Cart (${n})`;
    });
  }

  // ---------- product grids ----------
  async function fillGrid(el) {
    const section = el.closest('[data-shop-section]');
    const map = await loadProducts();
    const empty = el.dataset.empty;
    let list = map && map !== 'error' ? [...map.values()] : [];
    if (el.dataset.category && el.dataset.category !== 'all') list = list.filter(p => p.page === el.dataset.category);
    if (Number(el.dataset.limit) > 0) list = list.slice(0, Number(el.dataset.limit));
    if (!list.length) {
      const msg = CN().preview
        ? (!api() ? 'Products will show here once the shop is connected to Square.' : map === 'error' ? 'Could not reach the shop right now.' : 'No products in this category yet. Add them in Square with the Website category.')
        : empty;
      if (msg) { el.outerHTML = `<p class="cn-empty">${esc(msg)}</p>`; }
      else if (section) section.hidden = true;
      return;
    }
    if (section) section.hidden = false;
    el.innerHTML = list.map(p => `<a class="cn-product-card" href="product.html?id=${encodeURIComponent(p.id)}">${p.images[0]
      ? `<img src="${esc(p.images[0])}" alt="" width="600" height="600" loading="lazy">` : '<span class="cn-noimg" aria-hidden="true"></span>'}<span class="cn-pc-name">${esc(p.name)}</span><span class="cn-pc-price">${allSold(p) ? '<span class="cn-badge">Sold out</span>' : esc(priceText(p))}</span></a>`).join('\n');
  }

  // ---------- product page ----------
  function setMeta(desc) { const m = document.querySelector('meta[name="description"]'); if (m) m.content = desc; }

  async function fillProduct(el) {
    const map = await loadProducts();
    const id = CN().productId || new URLSearchParams(location.search).get('id');
    const p = map && map !== 'error' ? map.get(id) : null;
    if (!p) {
      el.innerHTML = map === 'error'
        ? '<p class="cn-empty">The shop could not be reached right now. Please refresh in a minute.</p>'
        : (CN().preview && !id ? '<p class="cn-empty">Each product page fills in from Square. Open a product on the live site to see one.</p>'
          : '<h1 class="section-title">We couldn\u2019t find that item</h1><p class="cn-empty">It may have sold out or been taken down.</p><p style="text-align:center"><a class="btn" href="shop.html">Back to the shop</a></p>');
      return;
    }
    if (!CN().preview) { document.title = `${p.name} | The Cows Nest`; setMeta(p.description.replace(/\s+/g, ' ').slice(0, 155)); }
    const cat = (shop().categories || []).find(c => c.page === p.page);
    const crumbs = ['<a href="index.html">Home</a>', '<a href="shop.html">Shop Online</a>'];
    if (cat) crumbs.push(`<a href="${esc(cat.page)}.html">${esc(cat.label)}</a>`);
    crumbs.push(`<span aria-current="page">${esc(p.name)}</span>`);
    const sold = allSold(p), blocked = sold || notReady(p);
    const firstOk = p.variations.find(v => !v.soldOut) || p.variations[0];
    const multi = p.variations.length > 1;
    el.innerHTML = `
  <nav class="breadcrumb" aria-label="Breadcrumb">${crumbs.join(' / ')}</nav>
  <div class="cn-product-grid">
    <div class="cn-gallery-main">
      ${p.images.length ? `<img class="cn-main-img" src="${esc(p.images[0])}" alt="${esc(p.name)}" width="1200" height="1200">` : '<span class="cn-noimg" aria-hidden="true"></span>'}
      ${p.images.length > 1 ? `<div class="cn-thumbs">${p.images.map((im, n) => `<button type="button" data-cn-thumb="${esc(im)}" aria-label="Show picture ${n + 1}"><img src="${esc(im)}" alt="" width="120" height="120" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div class="cn-product-info">
      <h1>${esc(p.name)}</h1>
      <p class="cn-price" data-price>${sold ? '<span class="cn-badge">Sold out</span>' : money(firstOk.price)}</p>
      ${paras(p.description)}
      <form class="cn-add" data-cn-add="${esc(p.id)}" novalidate>
        ${multi ? `<label for="cn-var">Choose</label>
        <select id="cn-var" name="variation">${p.variations.map(v => `<option value="${esc(v.id)}"${v.soldOut ? ' disabled' : ''}${v === firstOk ? ' selected' : ''}>${esc(v.name)}, ${money(v.price)}${v.soldOut ? ' (sold out)' : ''}</option>`).join('')}</select>`
        : `<input type="hidden" name="variation" value="${esc(firstOk.id)}">`}
        ${p.kind === 'digital' ? '' : `<label for="cn-qty">Quantity</label>
        <input id="cn-qty" name="qty" type="number" min="1" max="${firstOk.max}" value="1" inputmode="numeric">`}
        <button class="btn" type="submit"${blocked ? ' disabled' : ''}>${sold ? 'Sold out' : notReady(p) ? 'Available soon' : 'Add to cart'}</button>
        <p class="cn-add-note" role="status"></p>
      </form>
      ${KIND_NOTE[p.kind] ? `<p class="cn-kind-note">${KIND_NOTE[p.kind]}</p>` : ''}
    </div>
  </div>`;
  }

  // variation change -> price + max qty
  document.addEventListener('change', async e => {
    const sel = e.target.closest && e.target.closest('form[data-cn-add] select[name="variation"]');
    if (!sel) return;
    const map = await loadProducts(); const hit = map && map !== 'error' && findVariation(map, sel.value);
    if (!hit) return;
    const f = sel.form;
    f.closest('.cn-product-info').querySelector('[data-price]').textContent = money(hit.v.price);
    const q = f.querySelector('[name="qty"]'); if (q) { q.max = hit.v.max; if (+q.value > hit.v.max) q.value = hit.v.max; }
  });

  // add to cart
  document.addEventListener('submit', async e => {
    const f = e.target.closest && e.target.closest('form[data-cn-add]');
    if (!f) return;
    e.preventDefault();
    if (CN().preview) return;
    const note = f.querySelector('.cn-add-note');
    const map = await loadProducts();
    const hit = map && map !== 'error' && findVariation(map, f.elements.variation.value);
    if (!hit || hit.v.soldOut || notReady(hit.p)) { note.textContent = 'Sorry, this item is not available.'; return; }
    const cart = loadCart();
    const line = cart.find(l => l.variation === hit.v.id);
    const had = line ? line.qty : 0;
    const want = hit.p.kind === 'digital' ? 1 : Math.max(1, parseInt(f.elements.qty && f.elements.qty.value, 10) || 1);
    const qty = hit.p.kind === 'digital' ? 1 : Math.min(hit.v.max, had + want);
    if (qty < 1) { note.textContent = 'Sorry, this one just sold out.'; return; }
    if (line) line.qty = qty; else cart.push({ variation: hit.v.id, qty });
    saveCart(cart);
    note.innerHTML = (hit.p.kind === 'digital' && had ? 'Already in your cart. '
      : qty - had < want ? `Only ${hit.v.max} available, so your cart has ${qty}. ` : 'Added to your cart. ') + '<a href="cart.html">View cart</a>';
  });

  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-cn-thumb]');
    if (!b) return;
    const main = b.closest('.cn-gallery-main').querySelector('.cn-main-img');
    if (main) main.src = b.dataset.cnThumb;
  });

  // ---------- cart ----------
  function summarize(map) {
    const lines = loadCart().map(l => {
      const hit = map && map !== 'error' ? findVariation(map, l.variation) : null;
      const ok = !!(hit && !hit.v.soldOut && !notReady(hit.p) && l.qty <= hit.v.max);
      return { ...l, p: hit && hit.p, v: hit && hit.v, ok };
    });
    const ok = lines.filter(l => l.ok);
    const subtotal = ok.reduce((t, l) => t + l.v.price * l.qty, 0);
    const physical = ok.some(l => l.p.kind !== 'digital');
    const treat = ok.some(l => l.p.kind === 'treat');
    const s = shop();
    const canPickup = !!(s.pickup && s.pickup.enabled);
    const canShip = !(s.shipping && s.shipping.enabled === false);
    if (!physical) form.fulfillment = '';
    else if (!form.fulfillment || (form.fulfillment === 'pickup' && !canPickup) || (form.fulfillment === 'ship' && !canShip))
      form.fulfillment = canPickup ? 'pickup' : canShip ? 'ship' : '';
    const sh = s.shipping || {};
    const shipCost = form.fulfillment === 'ship' ? ((Number(sh.freeOver) > 0 && subtotal >= Math.round(Number(sh.freeOver) * 100)) ? 0 : Math.round((Number(sh.flat) || 0) * 100)) : 0;
    return { lines, ok, subtotal, physical, treat, canPickup, canShip, shipCost };
  }

  async function renderCart(el) {
    if (!loadCart().length) {
      el.innerHTML = '<p class="cn-empty">Your cart is empty.</p><p style="text-align:center"><a class="btn" href="shop.html">Go shopping</a></p>';
      return;
    }
    const map = await loadProducts();
    if (map === 'error' || map === null) {
      el.innerHTML = `<p class="cn-empty">${map === null ? "Online checkout isn't open yet. Please contact us to order." : 'The shop could not be reached right now. Please refresh in a minute.'}</p>`;
      return;
    }
    const c = summarize(map);
    const s = shop();
    const field = (k, label, attrs = '') => `<label for="cn-${k}">${label}</label><input id="cn-${k}" data-form="${k}" value="${esc(form[k])}" ${attrs}>`;
    const gone = l => !l.p ? 'No longer available' : l.v.soldOut ? 'Sold out' : notReady(l.p) ? 'Not available yet' : `Only ${l.v.max} left`;
    el.innerHTML = `
<div class="cn-cart-lines">
${c.lines.map((l, i) => `  <div class="cn-line${l.ok ? '' : ' is-gone'}">
    ${l.p && l.p.images[0] ? `<img src="${esc(l.p.images[0])}" alt="" width="80" height="80">` : '<span class="cn-noimg" aria-hidden="true"></span>'}
    <div class="cn-line-name">${l.p ? `<a href="product.html?id=${encodeURIComponent(l.p.id)}">${esc(l.p.name)}</a>${l.p.variations.length > 1 ? `<small>${esc(l.v.name)}</small>` : ''}` : 'Item no longer in the shop'}
      ${l.ok ? '' : `<span class="cn-badge">${gone(l)}</span>`}</div>
    ${l.p && l.p.kind !== 'digital' && !l.v.soldOut ? `<input type="number" min="1" max="${l.v.max}" value="${l.qty}" data-qty="${i}" aria-label="Quantity" inputmode="numeric">` : '<span></span>'}
    <span class="cn-line-total">${l.ok ? money(l.v.price * l.qty) : ''}</span>
    <button type="button" class="cn-link" data-remove="${i}">Remove</button>
  </div>`).join('\n')}
</div>
<div class="cn-cart-side">
  ${c.physical ? `<fieldset class="cn-fulfill"><legend>How would you like to get your order?</legend>
    ${c.canPickup ? `<label><input type="radio" name="cn-ful" value="pickup"${form.fulfillment === 'pickup' ? ' checked' : ''}> Local pickup (free)</label>` : ''}
    ${c.canShip ? `<label><input type="radio" name="cn-ful" value="ship"${form.fulfillment === 'ship' ? ' checked' : ''}> Ship to me</label>` : ''}
  </fieldset>
  ${form.fulfillment === 'pickup' && s.pickup && s.pickup.note ? `<p class="cn-note">${esc(s.pickup.note)}</p>` : ''}
  <div class="cn-address">
    ${field('name', 'Full name', 'autocomplete="name"')}
    ${field('email', 'Email', 'type="email" autocomplete="email"')}
    ${field('phone', 'Phone', 'type="tel" autocomplete="tel"')}
    ${form.fulfillment === 'ship' ? `
    ${field('line1', 'Street address', 'autocomplete="address-line1"')}
    ${field('line2', 'Apartment, suite (optional)', 'autocomplete="address-line2"')}
    <div class="cn-row">
      <div>${field('city', 'City', 'autocomplete="address-level2"')}</div>
      <div>${field('state', 'State', 'autocomplete="address-level1" maxlength="2"')}</div>
      <div>${field('postal', 'ZIP code', 'autocomplete="postal-code" inputmode="numeric" maxlength="10"')}</div>
    </div>
    ${c.treat ? '<p class="cn-note">Sweet treats can only be shipped to South Carolina addresses.</p>' : ''}
    ${s.shipping && s.shipping.note ? `<p class="cn-note">${esc(s.shipping.note)}</p>` : ''}` : ''}
  </div>` : '<p class="cn-note">Your downloads will be ready right after you pay.</p>'}
  <dl class="cn-totals">
    <dt>Subtotal</dt><dd>${money(c.subtotal)}</dd>
    ${form.fulfillment === 'ship' ? `<dt>Shipping</dt><dd>${c.shipCost ? money(c.shipCost) : 'Free'}</dd>` : ''}
    <dt>Total before tax</dt><dd><strong>${money(c.subtotal + c.shipCost)}</strong></dd>
  </dl>
  ${s.taxNote ? `<p class="cn-note">${esc(s.taxNote)}</p>` : ''}
  <button type="button" class="btn cn-checkout" data-checkout>Check out</button>
  <p class="cn-cart-msg" role="alert"></p>
  <p class="cn-secure">Payment is handled securely by Square. We never see your card number.</p>
</div>`;
  }

  function cartError(el, msg) { const m = el.querySelector('.cn-cart-msg'); if (m) m.textContent = msg; }

  function validate(c) {
    if (c.ok.length !== c.lines.length) return 'Please remove or fix the items marked in your cart.';
    if (!c.ok.length) return 'Your cart is empty.';
    if (!c.physical) return '';
    if (!form.fulfillment) return 'Please choose pickup or shipping.';
    if (!form.name.trim()) return 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Please enter a valid email address.';
    const digits = form.phone.replace(/\D/g, '');
    if (!(digits.length === 10 || (digits.length === 11 && digits[0] === '1'))) return 'Please enter a 10-digit phone number.';
    if (form.fulfillment === 'ship') {
      for (const [k, label] of [['line1', 'your street address'], ['city', 'your city'], ['state', 'your state'], ['postal', 'your ZIP code']])
        if (!String(form[k]).trim()) return `Please enter ${label}.`;
      if (!/^[A-Za-z]{2}$/.test(form.state.trim())) return 'Please use the 2-letter state code, like SC.';
      if (!/^\d{5}(-\d{4})?$/.test(form.postal.trim())) return 'Please check your ZIP code.';
      if (c.treat && form.state.trim().toUpperCase() !== 'SC') return 'Sweet treats can only be shipped within South Carolina. Choose local pickup, or remove the treats.';
    }
    return '';
  }

  async function checkout(el, btn) {
    const map = await loadProducts();
    const c = summarize(map);
    const problem = validate(c);
    if (problem) { cartError(el, problem); return; }
    btn.disabled = true; btn.textContent = 'Opening secure checkout…'; cartError(el, '');
    try {
      const res = await fetch(api() + '/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: c.ok.map(l => ({ variation: l.variation, qty: l.qty })),
          fulfillment: form.fulfillment || 'digital',
          contact: c.physical ? { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() } : null,
          shipping: form.fulfillment === 'ship' ? { line1: form.line1.trim(), line2: form.line2.trim(), city: form.city.trim(), state: form.state.trim().toUpperCase(), postal_code: form.postal.trim() } : null
        })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || 'Checkout could not be started. Please try again.');
      location.href = out.url;
    } catch (err) {
      cartError(el, err.message === 'Failed to fetch' ? 'Could not reach checkout. Check your connection and try again.' : err.message);
      btn.disabled = false; btn.textContent = 'Check out';
    }
  }

  function bindCart(el) {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.qty != null) {
        const cart = loadCart(); const i = +t.dataset.qty;
        if (cart[i]) { cart[i].qty = Math.min(Number(t.max) || 20, Math.max(1, parseInt(t.value, 10) || 1)); saveCart(cart); }
      } else if (t.name === 'cn-ful') { form.fulfillment = t.value; saveForm(); renderCart(el); }
    });
    el.addEventListener('input', e => { const k = e.target.dataset.form; if (k) { form[k] = e.target.value; saveForm(); } });
    el.addEventListener('click', e => {
      const r = e.target.closest('[data-remove]');
      if (r) { const cart = loadCart(); cart.splice(+r.dataset.remove, 1); saveCart(cart); return; }
      const b = e.target.closest('[data-checkout]');
      if (b && !CN().preview) checkout(el, b);
    });
  }

  // ---------- thank-you page ----------
  async function renderOrder(el) {
    if (el.dataset.loaded) return;
    el.dataset.loaded = '1';
    const t = new URLSearchParams(location.search).get('t');
    const s = shop();
    const contact = (data().site || {}).email;
    const help = contact ? ` If something looks wrong, email <a href="mailto:${esc(contact)}">${esc(contact)}</a>.` : '';
    if (!t || !api()) { el.innerHTML = `<p class="cn-empty">There's no order to show here.${help}</p>`; return; }
    try {
      const res = await fetch(`${api()}/order?t=${encodeURIComponent(t)}`);
      const o = await res.json();
      if (!res.ok) throw new Error(o.error || 'Order not found.');
      if (o.status !== 'paid') { el.innerHTML = `<p class="cn-empty">We haven't received payment for this order yet. If you just paid, refresh this page in a minute.${help}</p>`; delete el.dataset.loaded; return; }
      memCart = []; write(localStorage, KEY, []); updateHeader();
      const ful = o.fulfillment === 'pickup' ? `<p>${esc((s.pickup && s.pickup.note) || "We'll be in touch when your order is ready to pick up.")}</p>`
        : o.fulfillment === 'ship' ? `<p>We'll ship your order soon.${s.shipping && s.shipping.note ? ' ' + esc(s.shipping.note) : ''}</p>` : '';
      el.innerHTML = `
<p class="cn-order-lead">A receipt is on its way to <strong>${esc(o.email || 'your email')}</strong>.</p>
<ul class="cn-order-items">${o.items.map(i => `<li><span>${esc(i.name)}${i.qty > 1 ? ` × ${i.qty}` : ''}</span><span>${money(i.total)}</span></li>`).join('')}</ul>
<p class="cn-order-total">Total paid: <strong>${money(o.total)}</strong></p>
${ful}
${o.downloads && o.downloads.length ? `<h2>Your downloads</h2>
<ul class="cn-downloads">${o.downloads.map(d => `<li><a class="btn btn-small" href="${esc(d.url)}">Download ${esc(d.name)}</a></li>`).join('')}</ul>
<p class="cn-note">Download links work for 7 days. Bookmark this page so you can come back to it.</p>` : ''}
<p class="cn-note">${help.trim()}</p>`;
    } catch (err) {
      el.innerHTML = `<p class="cn-empty">${esc(err.message === 'Failed to fetch' ? 'We could not load your order right now. Your payment is safe; please refresh in a minute.' : err.message)}${help}</p>`;
    }
  }

  // ---------- wiring ----------
  function refreshCart() {
    updateHeader();
    document.querySelectorAll('[data-shop="cart"]').forEach(el => { bindCart(el); renderCart(el); });
  }
  function refresh() {
    refreshCart();
    document.querySelectorAll('[data-shop="grid"]').forEach(fillGrid);
    document.querySelectorAll('[data-shop="product"]').forEach(fillProduct);
    document.querySelectorAll('[data-shop="order"]').forEach(renderOrder);
  }
  document.addEventListener('cn:rendered', refresh);
  window.addEventListener('storage', e => { if (e.key === KEY) { memCart = null; refreshCart(); } });
  window.addEventListener('pageshow', ev => { if (ev.persisted) { memCart = null; productsPromise = null; refresh(); } });
  refresh();
})();
