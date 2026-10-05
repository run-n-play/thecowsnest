/* The Cows Nest – website editor.
   Reads ../assets/js/data.js, edits it in the browser (draft kept in IndexedDB),
   previews with ../index.html?cnpreview=1, and exports a zip:
     assets/js/data.js, assets/img/uploads/*, and shells for any new pages.
   Unzip at the repo root and commit. */
(() => {
  'use strict';

  // ---------- small helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const clone = o => JSON.parse(JSON.stringify(o));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  let uid = 0;
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  }
  const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  function toast(msg, ms = 4500) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- draft storage (IndexedDB holds JSON + image blobs) ----------
  const idb = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('cn-admin', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('kv', mode); const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    }));
    return {
      get: k => tx('readonly', s => s.get(k)),
      set: (k, v) => tx('readwrite', s => s.put(v, k)),
      del: k => tx('readwrite', s => s.delete(k))
    };
  })();

  // ---------- state ----------
  let LIVE = null;          // data.js as published
  let data = null;          // working copy
  let pending = {};         // new image path -> Blob
  let urls = {};            // new image path -> object URL
  let dirty = false;        // edited since last download
  let hasDraft = false;
  let view = { kind: 'page', slug: 'index' };
  let openSection = null;
  let previewReady = false;

  // ---------- field builders ----------
  const F = {
    text: (k, l, hint) => ({ t: 'text', k, l, hint }),
    area: (k, l, hint) => ({ t: 'area', k, l, hint }),
    link: (k, l = 'Goes to', hint = 'Pick a page from the list, or paste a full web address.') => ({ t: 'link', k, l, hint }),
    img: (k, l, o = {}) => ({ t: 'image', k, l, ...o }),
    money: (k, l, hint) => ({ t: 'money', k, l, hint }),
    number: (k, l, hint) => ({ t: 'number', k, l, hint }),
    check: (k, l, hint) => ({ t: 'check', k, l, hint }),
    heading: l => ({ t: 'heading', l })
  };
  const NEWLINE = 'Press Enter to start a new line.';
  const PARAS = 'Leave a blank line between paragraphs.';
  const ALT = 'Describe the picture in a few words. Screen readers read this aloud.';
  const LINK_ITEM = { t: 'group', fields: [F.text('label', 'Words'), F.link('href')] };
  const newLink = () => ({ label: 'New link', href: 'index.html' });

  // Each section type: friendly name, short explanation, fields, and a starter copy.
  const catOptions = () => ((data.shop && data.shop.categories) || []).map(c => [c.page, c.label]);
  const TYPES = {
    'product-grid': {
      name: 'Product grid', blurb: 'Shows products as picture cards that open each product. Pick one category, or all products.',
      title: s => s.title || (s.category === 'all' || !s.category ? 'All products' : ((catOptions().find(c => c[0] === s.category) || [])[1] || s.category)),
      fields: [
        F.text('title', 'Heading', 'Leave empty for no heading.'),
        { t: 'select', k: 'category', l: 'Which products', options: () => [['all', 'All products'], ...catOptions()] },
        F.number('limit', 'How many to show', '0 shows all of them.'),
        F.text('emptyText', 'Words to show when there are no products yet', 'Leave empty to show nothing at all.')
      ],
      make: () => ({ type: 'product-grid', title: '', category: 'all', limit: 0, emptyText: '' })
    },
    'product-detail': {
      system: true, name: 'Product details', blurb: 'The pictures, price, description and Add to cart button. It fills in by itself from Square for whichever product a shopper opens.',
      title: () => '', fields: [], make: () => ({ type: 'product-detail' })
    },
    cart: {
      system: true, name: 'Shopping cart', blurb: 'The cart and Check out button. Pickup and shipping choices come from Pickup, shipping & categories.',
      title: () => '', fields: [], make: () => ({ type: 'cart' })
    },
    'order-confirmation': {
      system: true, name: 'Order details', blurb: 'After someone pays, this shows what they bought, pickup or shipping info, and their download links.',
      title: () => '', fields: [], make: () => ({ type: 'order-confirmation' })
    },
    'page-hero': {
      name: 'Page banner', blurb: 'The page name and short line at the top. The "Home / …" trail above it fills in by itself from the menu.',
      title: s => s.heading,
      fields: [F.text('heading', 'Page name'), F.area('lede', 'Short line under it')],
      make: () => ({ type: 'page-hero', heading: 'New page', lede: '' })
    },
    'coming-soon': {
      name: 'Coming soon box', blurb: 'The "this page is coming soon" card. Delete it once the page has real content.',
      title: s => s.title,
      fields: [
        F.img('image', 'Picture', { max: 400 }),
        F.text('title', 'Heading'), F.area('text', 'Words'),
        { t: 'list', k: 'buttons', l: 'Buttons', itemName: 'button',
          item: { t: 'group', fields: [F.text('label', 'Button words'), F.link('link'),
            { t: 'select', k: 'style', l: 'Button look', options: [['solid', 'Filled in'], ['outline', 'Outline only']] }] },
          make: () => ({ label: 'New button', link: 'index.html', style: 'solid' }) }
      ],
      make: () => ({ type: 'coming-soon', image: 'assets/img/icon-bird.jpg', title: 'This page is coming soon',
        text: "We're still setting this part of the nest up. In the meantime, have a look around the rest of the shop.",
        buttons: [{ label: 'Back to home', link: 'index.html', style: 'solid' }, { label: 'Contact us', link: 'contact.html', style: 'outline' }] })
    },
    hero: {
      name: 'Welcome banner', blurb: 'The big banner at the top of the home page.',
      title: s => s.name,
      fields: [
        F.text('welcome', 'Small words above the name'),
        F.text('name', 'Big name'),
        F.area('text', 'Welcome words', PARAS),
        { t: 'list', k: 'buttons', l: 'Buttons', itemName: 'button',
          item: { t: 'group', fields: [F.text('label', 'Button words'), F.link('link'),
            { t: 'select', k: 'style', l: 'Button look', options: [['solid', 'Filled in'], ['outline', 'Outline only']] }] },
          make: () => ({ label: 'New button', link: 'index.html', style: 'solid' }) },
        F.img('image', 'Main picture', { max: 1400 }),
        F.text('imageAlt', 'Describe the picture', ALT),
        F.area('bubble1', 'Speech bubble 1', NEWLINE),
        F.area('bubble2', 'Speech bubble 2', NEWLINE)
      ],
      make: () => ({ type: 'hero', welcome: 'Welcome to', name: 'The Cows Nest', text: '', buttons: [], image: '', imageAlt: '', bubble1: '', bubble2: '' })
    },
    'category-cards': {
      name: 'Category cards', blurb: 'A row of small picture cards that each link to a page.',
      title: s => s.title,
      fields: [
        F.text('title', 'Heading'),
        { t: 'list', k: 'items', l: 'Cards', itemName: 'card',
          item: { t: 'group', fields: [F.text('title', 'Card heading'), F.text('text', 'Small words under it'),
            F.img('image', 'Picture', { ratio: 126 / 101, width: 600 }), F.link('link', 'Card goes to')] },
          make: () => ({ title: 'New card', text: '', image: '', link: 'shop.html' }) }
      ],
      make: () => ({ type: 'category-cards', title: 'New cards', items: [] })
    },
    'visit-cards': {
      name: 'Place cards', blurb: 'Bigger cards with words, a button and a picture, like the stand and booth.',
      title: s => s.title,
      fields: [
        F.text('title', 'Heading'),
        { t: 'list', k: 'items', l: 'Cards', itemName: 'card',
          item: { t: 'group', fields: [F.text('title', 'Card heading'), F.area('text', 'Words'),
            F.img('image', 'Picture', { ratio: 150 / 146, width: 600 }),
            F.text('buttonLabel', 'Button words', 'Leave empty for no button.'), F.link('link', 'Button goes to')] },
          make: () => ({ title: 'New card', text: '', image: '', buttonLabel: 'Learn more', link: 'index.html' }) }
      ],
      make: () => ({ type: 'visit-cards', title: 'New cards', items: [] })
    },
    'daisy-pip': {
      name: 'Daisy & Pip + sign-up', blurb: 'The row of three boxes: Meet Daisy & Pip, Conversations, and Join the herd.',
      title: s => s.meetTitle,
      fields: [
        F.heading('Meet Daisy & Pip box'),
        F.text('meetTitle', 'Heading'), F.area('meetText', 'Words'),
        F.text('meetButton', 'Button words'), F.link('meetLink', 'Button goes to'),
        F.img('meetImage', 'Picture', { max: 500 }), F.text('meetImageAlt', 'Describe the picture', ALT),
        F.heading('Conversations box'),
        F.area('chatTitle', 'Heading', NEWLINE), F.area('chatText', 'Words'),
        F.text('chatButton', 'Button words'), F.link('chatLink', 'Button goes to'),
        F.img('chatImage', 'Picture', { max: 400 }), F.text('chatImageAlt', 'Describe the picture', ALT),
        F.heading('Sign-up box'),
        F.text('signupTitle', 'Heading'), F.area('signupText', 'Words'), F.text('signupButton', 'Button words')
      ],
      make: () => ({ type: 'daisy-pip', meetTitle: 'Meet Daisy & Pip', meetText: '', meetButton: '', meetLink: 'daisy-and-pip.html', meetImage: '', meetImageAlt: '',
        chatTitle: 'Conversations\nOver the Picket Fence', chatText: '', chatButton: '', chatLink: 'conversations.html', chatImage: '', chatImageAlt: '',
        signupTitle: 'Join the herd!', signupText: '', signupButton: 'Sign me up!' })
    },
    instagram: {
      name: 'Instagram photos', blurb: 'A strip of square photos that link to Instagram posts.',
      title: s => s.title,
      fields: [
        F.text('title', 'Heading'),
        { t: 'list', k: 'items', l: 'Photos', itemName: 'photo',
          item: { t: 'group', fields: [F.img('image', 'Photo', { ratio: 125 / 118, width: 600 }),
            F.text('link', 'Instagram post web address', 'Open the post on Instagram, copy the address bar, paste it here.')] },
          make: () => ({ image: '', link: '#' }) }
      ],
      make: () => ({ type: 'instagram', title: 'Follow along on Instagram', items: [] })
    },
    trust: {
      name: 'Promise icons', blurb: 'The strip of small icons near the bottom (Handmade in small batches, and so on).',
      title: s => (s.items || []).map(i => String(i.text || '').split('\n')[0]).join(', '),
      fields: [
        { t: 'list', k: 'items', l: 'Icons', itemName: 'icon',
          item: { t: 'group', fields: [F.img('icon', 'Icon', { max: 200 }), F.area('text', 'Words', NEWLINE)] },
          make: () => ({ icon: '', text: '' }) }
      ],
      make: () => ({ type: 'trust', items: [] })
    },
    text: {
      name: 'Heading and words', blurb: 'A plain block of writing.',
      title: s => s.title,
      fields: [
        F.text('title', 'Heading', 'Leave empty for no heading.'),
        F.area('text', 'Words', PARAS),
        { t: 'select', k: 'align', l: 'Line up the words', options: [['left', 'On the left'], ['center', 'In the middle']] }
      ],
      make: () => ({ type: 'text', title: 'New heading', text: '', align: 'left' })
    },
    'image-text': {
      name: 'Picture with words', blurb: 'A picture on one side, words and a button on the other.',
      title: s => s.title,
      fields: [
        F.text('title', 'Heading'), F.area('text', 'Words', PARAS),
        F.img('image', 'Picture', { ratio: 4 / 3, width: 1200 }), F.text('imageAlt', 'Describe the picture', ALT),
        { t: 'select', k: 'side', l: 'Picture goes on the', options: [['left', 'Left'], ['right', 'Right']] },
        F.text('buttonLabel', 'Button words', 'Leave empty for no button.'), F.link('link', 'Button goes to')
      ],
      make: () => ({ type: 'image-text', title: 'New heading', text: '', image: '', imageAlt: '', side: 'left', buttonLabel: '', link: '' })
    },
    gallery: {
      name: 'Photo gallery', blurb: 'A grid of square photos with optional captions.',
      title: s => s.title,
      fields: [
        F.text('title', 'Heading', 'Leave empty for no heading.'),
        { t: 'list', k: 'items', l: 'Photos', itemName: 'photo',
          item: { t: 'group', fields: [F.img('image', 'Photo', { ratio: 1, width: 900 }), F.text('caption', 'Caption', 'Also used to describe the photo for screen readers.')] },
          make: () => ({ image: '', caption: '' }) }
      ],
      make: () => ({ type: 'gallery', title: '', items: [] })
    }
  };

  const KINDS = [
    ['goods', 'Handmade item: shipping anywhere, or local pickup'],
    ['treat', 'Sweet treat: local pickup, or shipping within South Carolina only'],
    ['digital', 'Digital download: shopper gets a download link right after paying']
  ];
  const SHOP_FIELDS = [
    { t: 'group', k: 'pickup', l: 'Local pickup', fields: [F.check('enabled', 'Offer local pickup'),
      F.area('note', 'What pickup shoppers should know', 'Shown in the cart and on the thank-you page.')] },
    { t: 'group', k: 'shipping', l: 'Shipping', fields: [F.check('enabled', 'Offer shipping'),
      F.money('flat', 'Shipping price per order'),
      F.money('freeOver', 'Free shipping when the order is at least', 'Put 0 to never make shipping free.'),
      F.area('note', 'Shipping note', 'For example: Orders ship within 3 to 5 business days.')] },
    F.area('taxNote', 'Note under the cart total (optional)', 'Square adds sales tax at checkout using the tax settings in your Square account.'),
    F.text('websiteCategory', 'Square category that puts an item on the website', 'An item only shows on the website when it has this category in Square, plus one of the categories below.'),
    { t: 'list', k: 'categories', l: 'Categories', hint: 'Match each Square category to a page on this website, and pick its pickup and shipping rule.', itemName: 'category',
      item: { t: 'group', fields: [
        F.text('square', 'Category name in Square', 'Spelled the same as in Square (capital letters don\u2019t matter).'),
        F.text('label', 'Name on the website'),
        { t: 'select', k: 'page', l: 'Its page', options: () => slugs().map(sl => [sl, `${pageLabel(sl)} (${pageFile(sl)})`]) },
        { t: 'select', k: 'kind', l: 'Pickup and shipping rule', options: KINDS }] },
      make: () => ({ square: '', label: 'New category', page: 'shop', kind: 'goods' }) }
  ];

  const SITE_FIELDS = [
    F.text('topbar', 'Thin strip at the very top'),
    F.text('taglineScript', 'Fancy script line next to the logo'),
    { t: 'list', k: 'values', l: 'Little words under the script line', itemName: 'word', item: { t: 'text' }, make: () => 'New' },
    F.img('logo', 'Logo at the top', { max: 700 }),
    F.img('footerLogo', 'Logo in the footer', { max: 600 }),
    F.text('email', 'Email address', 'Shown in the footer with an email icon.'),
    { t: 'group', k: 'social', l: 'Social media links', hint: 'Leave one empty to hide that icon.',
      fields: [F.text('facebook', 'Facebook web address'), F.text('instagram', 'Instagram web address'),
        F.text('pinterest', 'Pinterest web address'), F.text('tiktok', 'TikTok web address')] },
    { t: 'list', k: 'nav', l: 'Top menu', itemName: 'menu item',
      item: { t: 'group', fields: [F.text('label', 'Words'), F.link('href'),
        { t: 'list', k: 'children', l: 'Drop-down items', itemName: 'drop-down item', item: LINK_ITEM, make: newLink }] },
      make: () => ({ label: 'New', href: 'index.html', children: [] }) },
    { t: 'list', k: 'footerColumns', l: 'Footer link columns', hint: 'The first two sit left of the footer logo, the rest to the right.', itemName: 'column',
      item: { t: 'group', fields: [F.text('title', 'Column heading'),
        { t: 'list', k: 'links', l: 'Links', itemName: 'link', item: LINK_ITEM, make: newLink }] },
      make: () => ({ title: 'New column', links: [] }) },
    F.text('connectTitle', 'Heading of the last footer column'),
    { t: 'list', k: 'connectLinks', l: 'Links in the last footer column', itemName: 'link', item: LINK_ITEM, make: newLink },
    F.text('copyright', 'Copyright line', '{year} turns into the current year by itself.')
  ];

  // ---------- form engine ----------
  function changed() {
    dirty = true; hasDraft = true;
    updateStatus(); saveDraft(); sendPreviewSoon();
  }

  function fieldEl(def, obj) {
    if (def.t === 'heading') return h('h3', { class: 'group-title' }, def.l);
    if (def.t === 'group') return groupEl(def, obj);
    if (def.t === 'list') return listEl(def, obj);
    const id = 'f' + (++uid);
    const wrap = h('div', { class: 'field' });
    const val = obj[def.k] ?? '';
    const set = v => { obj[def.k] = v; changed(); };
    if (def.l) wrap.append(def.t === 'check' ? '' : h('label', { for: id }, def.l));
    switch (def.t) {
      case 'text':
      case 'link':
        wrap.append(h('input', { id, type: 'text', value: val, list: def.t === 'link' ? 'cn-pages' : null, oninput: e => set(e.target.value) }));
        break;
      case 'area': {
        const ta = h('textarea', { id, rows: Math.min(10, Math.max(2, String(val).split('\n').length + 1)), oninput: e => set(e.target.value) });
        ta.value = val; wrap.append(ta); break;
      }
      case 'select': {
        const opts = typeof def.options === 'function' ? def.options() : def.options;
        const cur = val || (opts[0] && opts[0][0]);
        const sel = h('select', { id, onchange: e => set(e.target.value) },
          opts.map(([v, l]) => h('option', { value: v, selected: cur === v }, l)));
        if (val && !opts.some(([v]) => v === val)) sel.prepend(h('option', { value: val, selected: true }, val)); // keep unknown values visible
        wrap.append(sel); break;
      }
      case 'money':
        wrap.append(h('div', { class: 'money' }, h('span', { 'aria-hidden': 'true' }, '$'),
          h('input', { id, type: 'text', inputmode: 'decimal', value: val === '' ? '' : (Number(val) || 0).toFixed(2),
            oninput: e => { const n = parseFloat(e.target.value.replace(/[$,\s]/g, '')); set(isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0); },
            onblur: e => { e.target.value = (Number(obj[def.k]) || 0).toFixed(2); } })));
        break;
      case 'number':
        wrap.append(h('input', { id, type: 'number', min: 0, step: 1, value: val, class: 'num', oninput: e => set(Math.max(0, parseInt(e.target.value, 10) || 0)) }));
        break;
      case 'check':
        wrap.append(h('label', { class: 'check' }, h('input', { id, type: 'checkbox', checked: !!val, onchange: e => set(e.target.checked) }), def.l));
        break;
      case 'image':
        wrap.append(imageEl(def, obj, id)); break;
    }
    if (def.hint) wrap.append(h('p', { class: 'hint' }, def.hint));
    return wrap;
  }

  function groupEl(def, obj) {
    let target = obj;
    if (def.k) { if (!obj[def.k] || typeof obj[def.k] !== 'object') obj[def.k] = {}; target = obj[def.k]; }
    const box = h('div', { class: def.l ? 'field' : '' });
    if (def.l) box.append(h('span', { class: 'label' }, def.l));
    if (def.hint) box.append(h('p', { class: 'hint' }, def.hint));
    def.fields.forEach(f => box.append(fieldEl(f, target)));
    return box;
  }

  function listEl(def, obj) {
    if (!Array.isArray(obj[def.k])) obj[def.k] = [];
    const arr = obj[def.k];
    const wrap = h('div', { class: 'field' }, h('span', { class: 'label' }, def.l));
    if (def.hint) wrap.append(h('p', { class: 'hint' }, def.hint));
    const list = h('div', { class: 'list' });
    wrap.append(list);
    const simple = def.item.t !== 'group';
    const draw = () => {
      list.replaceChildren();
      arr.forEach((_, i) => {
        const tools = h('div', { class: 'tools' },
          iconBtn('↑', `Move ${def.itemName} up`, i === 0, () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; changed(); draw(); }),
          iconBtn('↓', `Move ${def.itemName} down`, i === arr.length - 1, () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; changed(); draw(); }),
          iconBtn('✕', `Remove this ${def.itemName}`, false, () => {
            if (!confirm(`Remove this ${def.itemName}?`)) return;
            arr.splice(i, 1); changed(); draw();
          }, 'danger'));
        if (simple) {
          list.append(h('div', { class: 'item simple' }, fieldEl({ ...def.item, k: i }, arr), tools));
        } else {
          list.append(h('div', { class: 'item' },
            h('div', { class: 'item-head' }, h('span', {}, `${cap(def.itemName)} ${i + 1}`), tools),
            ...def.item.fields.map(f => fieldEl(f, arr[i]))));
        }
      });
    };
    draw();
    wrap.append(h('button', { type: 'button', class: 'btn-quiet', onclick: () => { arr.push(def.make()); changed(); draw(); } }, `+ Add ${def.itemName}`));
    return wrap;
  }

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const iconBtn = (txt, label, disabled, fn, cls = '') =>
    h('button', { type: 'button', class: `icon-btn ${cls}`, title: label, 'aria-label': label, disabled, onclick: e => { e.preventDefault(); e.stopPropagation(); fn(); } }, txt);

  // ---------- pictures ----------
  const resolve = p => !p ? '' : urls[p] || (/^(https?:|data:|blob:)/.test(p) ? p : '../' + p);

  function imageEl(def, obj, id) {
    const thumb = h('img', { class: 'thumb', alt: '' });
    const meta = h('div', { class: 'img-meta' });
    const refresh = () => {
      const p = obj[def.k];
      thumb.src = resolve(p); thumb.style.visibility = p ? '' : 'hidden';
      meta.replaceChildren(p ? (pending[p] ? h('span', { class: 'new' }, 'New picture (not live yet)') : p.split('/').pop()) : 'No picture yet');
    };
    const use = async f => {
      if (!f || !/^image\//.test(f.type)) { toast('That file is not a picture. Use a JPG or PNG photo.'); return; }
      btn.disabled = true; btn.textContent = 'Getting it ready…';
      try { obj[def.k] = await addImage(f, def); refresh(); changed(); }
      catch (err) { toast(err.message, 7000); }
      finally { btn.disabled = false; btn.textContent = 'Change picture'; input.value = ''; }
    };
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true, id, onchange: e => use(e.target.files[0]) });
    const btn = h('button', { type: 'button', class: 'btn-quiet', onclick: () => input.click() }, 'Change picture');
    const hint = def.ratio ? 'Any photo works. It gets trimmed to fit and made smaller.' : 'Any picture works. It gets made smaller to load fast.';
    const box = h('div', { class: 'img-field',
      ondragover: e => { e.preventDefault(); box.classList.add('drag'); },
      ondragleave: () => box.classList.remove('drag'),
      ondrop: e => { e.preventDefault(); box.classList.remove('drag'); use(e.dataTransfer.files[0]); } },
      thumb, h('div', {}, btn, input, meta, h('p', { class: 'hint' }, hint + ' You can also drag a picture here.')));
    refresh();
    return box;
  }

  async function addImage(file, def) {
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch { throw new Error("That picture can't be opened here (iPhone HEIC photos often can't). Save it as a JPG and try again."); }
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (def.ratio) {               // center-crop to the slot's shape
      if (sw / sh > def.ratio) { sw = Math.round(sh * def.ratio); sx = Math.round((bmp.width - sw) / 2); }
      else { sh = Math.round(sw / def.ratio); sy = Math.round((bmp.height - sh) / 2); }
    }
    const scale = def.ratio ? Math.min(1, (def.width || 1200) / sw) : Math.min(1, (def.max || 1600) / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), hgt = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
    bmp.close && bmp.close();
    const toBlob = (type, q) => new Promise(r => c.toBlob(r, type, q));
    let blob = await toBlob('image/webp', 0.85);
    if (!blob || blob.type !== 'image/webp') blob = def.ratio ? await toBlob('image/jpeg', 0.85) : await toBlob('image/png');
    if (!blob) throw new Error('That picture could not be processed. Try a different one.');
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[blob.type];
    const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'photo';
    const path = `assets/img/uploads/${base}-${Date.now().toString(36).slice(-6)}.${ext}`;
    pending[path] = blob; urls[path] = URL.createObjectURL(blob);
    return path;
  }

  // drop new pictures that are no longer used anywhere
  function prune() {
    const json = JSON.stringify(data);
    for (const p of Object.keys(pending)) if (!json.includes(JSON.stringify(p))) {
      URL.revokeObjectURL(urls[p]); delete urls[p]; delete pending[p];
    }
  }

  // ---------- draft ----------
  const saveDraft = debounce(saveDraftNow, 600);
  function saveDraftNow() {
    prune();
    return idb.set('draft', { data, images: pending, dirty, savedAt: Date.now() })
      .catch(() => toast('This browser would not save your work. Download your changes before closing.', 8000));
  }

  // ---------- status ----------
  function updateStatus() {
    const s = $('#status');
    s.className = 'status';
    if (dirty) { s.textContent = 'You have changes that haven\u2019t been downloaded yet. They are saved in this browser.'; s.classList.add('dirty'); }
    else if (hasDraft) { s.textContent = 'Downloaded. Waiting for Russell to put it on the live site.'; }
    else { s.textContent = 'Everything matches the live website.'; s.classList.add('ok'); }
    $('#download').disabled = !dirty;
    $('#startOver').hidden = !hasDraft;
  }

  // ---------- views ----------
  const pageFile = slug => `${slug}.html`;
  function pageLabel(slug) {
    const f = pageFile(slug);
    if (slug === 'index') return 'Home';
    if (slug === 'product') return 'Product page (every product)';
    if (slug === 'thank-you') return 'Thank-you page (after paying)';
    for (const n of data.site.nav || []) {
      if (n.href === f) return n.label;
      for (const c of n.children || []) if (c.href === f) return c.label;
    }
    for (const col of data.site.footerColumns || []) for (const l of col.links || []) if (l.href === f) return l.label;
    const page = data.pages[slug];
    const hero = (page.sections || []).find(x => x.type === 'page-hero');
    return (hero && hero.heading) || String(page.title || slug).replace(/\s*\|\s*The Cows Nest$/, '');
  }
  const slugs = () => Object.keys(data.pages).sort((a, b) => a === 'index' ? -1 : b === 'index' ? 1 : pageLabel(a).localeCompare(pageLabel(b)));

  function renderSide() {
    const ul = $('#pageList'); ul.replaceChildren();
    const slugOf = href => { const m = /^([a-z0-9-]+)\.html$/.exec(String(href || '')); return m && data.pages[m[1]] ? m[1] : null; };
    const placed = new Set();
    const btn = slug => h('li', {}, h('button', { type: 'button', class: 'page-btn', 'aria-current': view.kind === 'page' && view.slug === slug ? 'true' : null,
      onclick: () => go({ kind: 'page', slug }) }, pageLabel(slug), h('small', {}, pageFile(slug))));
    const group = (title, list) => {
      list = [...new Set(list.filter(x => x && !placed.has(x)))];
      if (!list.length) return;
      list.forEach(x => placed.add(x));
      if (list.length === 1) { ul.append(btn(list[0])); return; }
      ul.append(h('li', { class: 'group' }, h('span', { class: 'group-name' }, title), h('ul', {}, list.map(btn))));
    };
    for (const n of data.site.nav || []) group(n.label, [slugOf(n.href), ...(n.children || []).map(c => slugOf(c.href))]);
    for (const c of data.site.footerColumns || []) group(c.title, (c.links || []).map(l => slugOf(l.href)));
    group('Other pages', slugs());
    $('#siteBtn').setAttribute('aria-current', view.kind === 'site' ? 'true' : 'false');
    $('#productsBtn').setAttribute('aria-current', view.kind === 'products' ? 'true' : 'false');
    $('#shopBtn').setAttribute('aria-current', view.kind === 'shop' ? 'true' : 'false');
    // link suggestions for every "Goes to" box
    const known = new Set(slugs().map(pageFile));
    const walk = l => (l || []).forEach(x => { if (x.href) known.add(x.href); walk(x.children); walk(x.links); });
    walk(data.site.nav); walk(data.site.footerColumns); walk(data.site.connectLinks);
    $('#cn-pages').replaceChildren(...[...known].filter(x => !/^(https?:|mailto:|#)/.test(x)).sort().map(v => h('option', { value: v })));
  }

  const phone = () => matchMedia('(max-width: 700px)').matches;
  function go(v) {
    view = v; openSection = null; openProduct = null; renderAll(); sendPreview(0); $('#editor').scrollTop = 0;
    if (phone()) $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' }); // on a phone the page list sits above the editor
  }

  function renderEditor() {
    const ed = $('#editor'); ed.replaceChildren();
    if (view.kind === 'products') { renderProducts(ed); return; }
    if (view.kind === 'shop') {
      ed.append(h('h2', {}, 'Pickup, shipping & categories'),
        h('p', { class: 'lead' }, 'How shoppers get their orders, and how your Square categories match up with pages on this website.'),
        h('div', { class: 'box' }, SHOP_FIELDS.map(f => fieldEl(f, data.shop))));
      return;
    }
    if (view.kind === 'site') {
      ed.append(h('h2', {}, 'Menu, footer & logo'),
        h('p', { class: 'lead' }, 'These show on every page.'),
        h('div', { class: 'box' }, SITE_FIELDS.map(f => fieldEl(f, data.site))));
      return;
    }
    const slug = view.slug, page = data.pages[slug];
    ed.append(h('div', { class: 'page-head' },
      h('h2', {}, pageLabel(slug)), h('span', { class: 'file' }, pageFile(slug)),
      slug !== 'index' ? h('button', { type: 'button', class: 'btn-quiet', onclick: () => deletePage(slug) }, 'Delete page') : null));
    ed.append(h('div', { class: 'box' },
      fieldEl(F.text('title', 'Title in the browser tab'), page),
      fieldEl(F.area('description', 'Search engine blurb', 'The short description Google shows under the link. One or two sentences.'), page)));
    ed.append(h('h3', { class: 'sub' }, 'Sections, top to bottom'));
    if (!page.sections.length) ed.append(h('p', { class: 'lead' }, 'This page is empty. Add a section below to get started.'));
    page.sections.forEach((s, i) => ed.append(sectionEl(page, s, i)));

    const sel = h('select', { 'aria-label': 'Kind of section to add' },
      Object.entries(TYPES).filter(([, t]) => !t.system).map(([k, t]) => h('option', { value: k }, `${t.name}: ${t.blurb}`)));
    sel.value = 'text';
    ed.append(h('div', { class: 'add-row' }, sel,
      h('button', { type: 'button', class: 'btn-quiet', onclick: () => {
        page.sections.push(TYPES[sel.value].make());
        openSection = page.sections.length - 1; changed(); renderEditor(); sendPreview(openSection);
      } }, '+ Add section')));
  }

  function sectionEl(page, s, i) {
    const t = TYPES[s.type];
    const arr = page.sections;
    const move = d => {
      [arr[i + d], arr[i]] = [arr[i], arr[i + d]];
      if (openSection === i) openSection = i + d;
      changed(); renderEditor(); sendPreview(i + d);
    };
    const titleSpan = h('span', { class: 'sec-title' }, t ? (t.title(s) || '').replace(/\n/g, ' ') : '');
    const det = h('details', { class: 'sec' + (s.hidden ? ' is-hidden' : ''), 'data-index': i, open: openSection === i },
      h('summary', {},
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '▸'),
        h('span', { class: 'sec-name' }, t ? t.name : `Unknown section (${s.type})`),
        titleSpan,
        s.hidden ? h('span', { class: 'badge' }, 'Hidden') : null,
        h('span', { class: 'tools' },
          iconBtn('↑', 'Move section up', i === 0, () => move(-1)),
          iconBtn('↓', 'Move section down', i === arr.length - 1, () => move(1)),
          iconBtn(s.hidden ? '◌' : '●', s.hidden ? 'Show this section on the site' : 'Hide this section (keeps it for later)', false, () => {
            s.hidden = !s.hidden; changed(); renderEditor(); }),
          iconBtn('✕', 'Delete this section', false, () => {
            if (!confirm(`Delete the “${t ? t.name : s.type}” section? You can hide it instead if you might want it back.`)) return;
            arr.splice(i, 1); if (openSection === i) openSection = null; changed(); renderEditor();
          }, 'danger'))));
    det.addEventListener('toggle', () => {
      if (det.open && openSection !== i) { openSection = i; sendPreview(i); }
      else if (!det.open && openSection === i) openSection = null;
    });
    if (t) {
      const body = h('div', { class: 'sec-body' }, h('p', { class: 'sec-blurb' }, t.blurb), t.fields.map(f => fieldEl(f, s)));
      body.addEventListener('input', () => { titleSpan.textContent = (t.title(s) || '').replace(/\n/g, ' '); });
      det.append(body);
    }
    return det;
  }

  let openProduct = null; // kept so go() stays simple
  const money = cents => '$' + ((Number(cents) || 0) / 100).toFixed(2);
  let squareCache = null; // { at, products } from the shop Worker

  async function fetchSquare(force) {
    const url = String(data.shop.checkoutUrl || '').replace(/\/+$/, '');
    if (!url) return { error: 'not-connected' };
    if (!force && squareCache && Date.now() - squareCache.at < 30000) return squareCache;
    try {
      const r = await fetch(url + '/products', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      squareCache = { at: Date.now(), products: (await r.json()).products || [] };
      return squareCache;
    } catch { return { error: 'unreachable' }; }
  }

  function renderProducts(ed) {
    ed.append(h('div', { class: 'page-head' }, h('h2', {}, 'Products'),
      h('button', { type: 'button', class: 'btn-quiet', onclick: () => { squareCache = null; renderEditor(); } }, 'Refresh from Square')));
    ed.append(h('div', { class: 'box howto-box' },
      h('p', {}, h('b', {}, 'Products live in your Square app. '), 'Add or change an item there (name, price, photos, sizes, stock) and the website picks it up within about a minute.'),
      h('p', {}, 'To put an item on the website, give it two categories in Square: ',
        h('b', {}, data.shop.websiteCategory || 'Website'), ', and one of the shop categories (for example ',
        h('b', {}, ((data.shop.categories || [])[0] || {}).square || 'Handmade Goods'), '). Market-only items just leave off ',
        h('b', {}, data.shop.websiteCategory || 'Website'), '.'),
      h('p', {}, 'Sold out: when Square tracks stock for an item, it shows Sold out here by itself when the count hits zero.')));
    const list = h('div', {}, h('p', { class: 'lead' }, 'Checking Square…'));
    ed.append(h('h3', { class: 'sub' }, 'On the website right now'), list);

    const dl = h('div', { class: 'box' });
    ed.append(h('h3', { class: 'sub' }, 'Digital download files'), dl);

    fetchSquare().then(res => {
      list.replaceChildren();
      if (res.error === 'not-connected') { list.append(h('p', { class: 'notice' }, 'The shop isn\u2019t connected to Square yet. Russell connects it.')); }
      else if (res.error) { list.append(h('p', { class: 'notice' }, 'Couldn\u2019t reach the shop just now. Try Refresh from Square in a minute.')); }
      else if (!res.products.length) { list.append(h('p', { class: 'lead' }, 'No items have the website categories yet.')); }
      else {
        for (const c of [...(data.shop.categories || []), { page: '', label: 'Other' }]) {
          const items = res.products.filter(p => c.page ? p.page === c.page : !(data.shop.categories || []).some(x => x.page === p.page));
          if (!items.length) continue;
          list.append(h('p', { class: 'group-title' }, c.label));
          for (const p of items) {
            const sold = p.variations.every(v => v.soldOut);
            list.append(h('div', { class: 'sq-item' },
              p.images[0] ? h('img', { class: 'p-thumb', src: p.images[0], alt: '' }) : h('span', { class: 'p-thumb' }),
              h('span', { class: 'sec-name' }, p.name),
              h('span', { class: 'sec-title' }, p.variations.map(v => `${p.variations.length > 1 ? v.name + ' ' : ''}${money(v.price)}`).join(' · ')),
              sold ? h('span', { class: 'badge' }, 'Sold out') : null,
              p.kind === 'digital' && !p.digitalReady ? h('span', { class: 'badge warn' }, 'Needs a file') : null,
              h('button', { type: 'button', class: 'btn-quiet', onclick: () => { openProduct = p.id; sendPreview(); } }, 'Preview')));
          }
        }
      }
      // download files: one row per digital item
      const digital = (res.products || []).filter(p => p.kind === 'digital');
      dl.replaceChildren(h('p', { class: 'hint' }, 'For each digital download, give Russell the file. He uploads it and you type its file name here, exactly as he gives it to you.'));
      if (!data.shop.downloads) data.shop.downloads = [];
      if (!digital.length) dl.append(h('p', { class: 'lead' }, 'No digital download items in Square yet.'));
      for (const p of digital) {
        let row = data.shop.downloads.find(x => x.item === p.id);
        const id = 'f' + (++uid);
        dl.append(h('div', { class: 'field' }, h('label', { for: id }, p.name),
          h('input', { id, type: 'text', value: row ? row.file : '', placeholder: 'for example: coloring-pages.pdf', oninput: e => {
            const v = e.target.value.trim();
            row = data.shop.downloads.find(x => x.item === p.id);
            if (v && row) row.file = v; else if (v) data.shop.downloads.push({ item: p.id, file: v });
            else data.shop.downloads = data.shop.downloads.filter(x => x.item !== p.id);
            changed();
          } })));
      }
    });
  }

  function renderAll() { renderSide(); renderEditor(); updateStatus(); }

  // ---------- pages ----------
  function newPage() {
    const name = prompt('What should the new page be called?\n(For example: Fall Market Schedule)');
    if (!name || !name.trim()) return;
    let slug = slugify(name) || 'page', n = 2;
    while (data.pages[slug]) slug = `${slugify(name)}-${n++}`;
    data.pages[slug] = { title: `${name.trim()} | The Cows Nest`, description: '', sections: [{ type: 'text', title: name.trim(), text: '', align: 'left' }] };
    if (confirm(`Add “${name.trim()}” to the top menu too?`)) data.site.nav.push({ label: name.trim(), href: pageFile(slug), children: [] });
    changed(); go({ kind: 'page', slug });
  }

  function deletePage(slug) {
    if (!confirm(`Delete the “${pageLabel(slug)}” page? Menu and footer links to it are removed too.`)) return;
    const f = pageFile(slug);
    const strip = l => (l || []).filter(x => x.href !== f).map(x => { if (x.children) x.children = strip(x.children); if (x.links) x.links = strip(x.links); return x; });
    data.site.nav = strip(data.site.nav); data.site.footerColumns = strip(data.site.footerColumns); data.site.connectLinks = strip(data.site.connectLinks);
    delete data.pages[slug];
    changed(); go({ kind: 'page', slug: 'index' });
  }

  // Keep in sync with /index.html
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shell = (slug, page) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title || 'The Cows Nest')}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="icon" type="image/png" href="assets/img/favicon.png">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:wght@400;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Parisienne&display=swap">
<link rel="stylesheet" href="assets/css/styles.css">
<link rel="stylesheet" href="assets/css/sections.css">
</head>
<body data-page="${esc(slug)}">
<a class="skip-link" href="#main">Skip to content</a>
<div id="cn-header" style="display:contents"></div>
<main id="main"></main>
<div id="cn-footer" style="display:contents"></div>
<noscript><p style="padding:2rem;text-align:center">Please turn on JavaScript to see The Cows Nest.</p></noscript>
<script src="assets/js/data.js"></script>
<script src="assets/js/render.js"></script>
<script src="assets/js/site.js"></script>
</body>
</html>
`;

  // ---------- download ----------
  async function download() {
    if (!window.JSZip) { toast('The download tool did not load. Check the internet connection and reload this page.', 8000); return; }
    prune();
    data.updated = new Date().toISOString();
    const zip = new JSZip();
    zip.file('assets/js/data.js', `/* The Cows Nest – site content. Edited with /admin. */\nwindow.CN_DATA = ${JSON.stringify(data, null, 2)};\n`);
    for (const [p, b] of Object.entries(pending)) zip.file(p, b);
    const added = Object.keys(data.pages).filter(s => !LIVE.pages[s]);
    for (const s of added) zip.file(pageFile(s), shell(s, data.pages[s]));
    const removed = Object.keys(LIVE.pages).filter(s => !data.pages[s]);
    zip.file('CHANGES.txt', [
      `Cows Nest website changes – ${new Date().toLocaleString()}`,
      'Unzip at the root of the repo (overwrite), then commit.',
      `New pictures: ${Object.keys(pending).length}`,
      added.length ? `New pages: ${added.map(pageFile).join(', ')}` : '',
      removed.length ? `Deleted pages (remove these files): ${removed.map(pageFile).join(', ')}` : '',
      ...(data.shop.downloads || []).map(d => `Digital file needed in R2 (cowsnest-downloads): ${d.file}   <- Square item ${d.item}`)
    ].filter(Boolean).join('\n') + '\n');
    const blob = await zip.generateAsync({ type: 'blob' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const a = h('a', { href: URL.createObjectURL(blob), download: `cowsnest-changes-${stamp}.zip` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    dirty = false; hasDraft = true;
    await saveDraftNow(); updateStatus();
    toast('Downloaded. Send that file to Russell and he’ll put it on the live site.', 7000);
  }

  async function startOver() {
    if (!confirm('Throw away all changes in this browser and go back to what is on the live website?')) return;
    await idb.del('draft').catch(() => {});
    Object.values(urls).forEach(URL.revokeObjectURL);
    data = clone(LIVE); pending = {}; urls = {}; dirty = false; hasDraft = false;
    go({ kind: 'page', slug: 'index' });
  }

  // ---------- preview ----------
  const frame = () => $('#preview');
  function sendPreview(scrollTo = null) {
    const f = frame();
    if (!previewReady || !f.contentWindow) return;
    let page = 'index', productId;
    if (view.kind === 'page') page = view.slug;
    else if (view.kind === 'shop') page = 'cart';
    else if (view.kind === 'products') { productId = openProduct; page = productId ? 'product' : 'shop'; }
    f.contentWindow.postMessage({ type: 'cn-render', data, page, productId, images: urls, scrollTo }, '*');
  }
  const sendPreviewSoon = debounce(() => sendPreview(), 250);

  let size = 'desktop';
  function fit() {
    const stage = $('#stage'), f = frame();
    const W = size === 'desktop' ? 1280 : 390;
    const s = Math.min(1, stage.clientWidth / W);
    f.style.width = W + 'px';
    f.style.height = (stage.clientHeight / s) + 'px';
    f.style.left = Math.max(0, (stage.clientWidth - W * s) / 2) + 'px';
    f.style.transform = `scale(${s})`;
  }

  window.addEventListener('message', e => {
    if (e.source !== frame().contentWindow || !e.data) return;
    if (e.data.type === 'cn-ready') { previewReady = true; sendPreview(openSection); }
    if (e.data.type === 'cn-pick' && view.kind === 'page') {
      openSection = e.data.index; renderEditor();
      const el = $(`details.sec[data-index="${e.data.index}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // ---------- start ----------
  function loadLive() {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `../assets/js/data.js?t=${Date.now()}`; // always the newest, never cached
      s.onload = () => window.CN_DATA ? res(clone(window.CN_DATA)) : rej(new Error('data.js has no content'));
      s.onerror = () => rej(new Error('data.js not found'));
      document.head.append(s);
    });
  }

  async function init() {
    try { LIVE = await loadLive(); }
    catch (err) { $('#editor').append(h('p', { class: 'lead' }, `The editor could not load the website content (${err.message}). Tell Russell.`)); $('#status').textContent = 'Could not load'; return; }

    let draft = null;
    try { draft = await idb.get('draft'); } catch { /* private browsing: editor still works, just no autosave */ }
    if (draft && draft.data && !draft.dirty && draft.data.updated && LIVE.updated && draft.data.updated <= LIVE.updated) {
      await idb.del('draft').catch(() => {}); draft = null; // Russell published it
    }
    if (draft && draft.data) {
      data = draft.data; pending = draft.images || {}; dirty = !!draft.dirty; hasDraft = true;
      for (const p of Object.keys(pending)) urls[p] = URL.createObjectURL(pending[p]);
    } else data = clone(LIVE);
    data.site = data.site || {}; data.pages = data.pages || {};
    data.shop = Object.assign({ checkoutUrl: '', websiteCategory: 'Website', categories: [], downloads: [], pickup: { enabled: true, note: '' }, shipping: { enabled: true, flat: 0, freeOver: 0, note: '' }, taxNote: '' }, data.shop || {});
    if (!data.pages.index) data.pages.index = { title: 'The Cows Nest', description: '', sections: [] };

    $('#download').addEventListener('click', download);
    $('#startOver').addEventListener('click', startOver);
    $('#newPage').addEventListener('click', newPage);
    $('#siteBtn').addEventListener('click', () => go({ kind: 'site' }));
    $('#productsBtn').addEventListener('click', () => go({ kind: 'products' }));
    $('#shopBtn').addEventListener('click', () => go({ kind: 'shop' }));
    document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
      size = b.dataset.size;
      document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      fit();
    }));
    new ResizeObserver(fit).observe($('#stage'));
    $('#toPages').addEventListener('click', () => $('.side').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    addEventListener('pagehide', () => { if (hasDraft) saveDraftNow(); });

    frame().src = '../index.html?cnpreview=1';
    fit();
    renderAll();
  }

  init();
})();
