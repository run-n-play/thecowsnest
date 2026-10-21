/* The Cows Nest – page renderer.
   Builds the header, page sections and footer from window.CN_DATA (assets/js/data.js).
   Each page is a shell: <body data-page="slug"> with #cn-header, #main, #cn-footer.
   Loaded with ?cnpreview=1 inside /admin, it re-renders live from posted draft data. */
(function () {
  'use strict';

  const BASE = ((document.currentScript && document.currentScript.src) || '').replace(/render\.js(\?.*)?$/, '');
  let IMG = {}; // preview only: image path -> blob URL for pictures not uploaded yet
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
  const lines = s => esc(String(s ?? '').trim()).replace(/\r?\n/g, '<br>');
  const paras = s => String(s ?? '').trim().split(/\r?\n\s*\r?\n/).filter(p => p.trim())
    .map(p => `<p>${lines(p)}</p>`).join('\n');
  const href = h => {
    h = String(h ?? '').trim();
    if (!h) return '#';
    // allow relative paths, http(s), mailto, tel, anchors; block javascript: etc.
    if (/^(https?:|mailto:|tel:|#)/i.test(h) || !/^[a-z][a-z0-9+.-]*:/i.test(h)) return esc(h);
    return '#';
  };
  const src = p => esc(IMG[p] || p || '');
  const sid = i => ` data-cn-section="${i}"`;

  const SVG = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    facebook: ['Facebook', SVG('<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H7v3h2v9h3v-9h2.5l.5-3h-3V7a1 1 0 0 1 1-1h2z"/>')],
    instagram: ['Instagram', SVG('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/>')],
    pinterest: ['Pinterest', SVG('<path d="M9 21l2.5-10"/><path d="M8.5 14.5A6 6 0 1 1 18 10c0 3.5-2 6-4.5 6-1.5 0-2.4-1-2.2-2.3"/>')],
    tiktok: ['TikTok', SVG('<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3a5 5 0 0 0 5 5"/>')]
  };
  const MAIL_ICON = SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>');
  const FLOURISH = '<svg class="flourish" width="160" height="20" viewBox="0 0 160 20" fill="none" stroke="#C9A77A" stroke-width="1.5" aria-hidden="true"><path d="M0 10h66"/><path d="M94 10h66"/><path d="M80 17s-8-4.5-8-9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 4.5-8 9-8 9z" fill="#D9735F" stroke="#D9735F"/></svg>';

  const socials = s => Object.keys(ICONS).filter(k => s && String(s[k] ?? '').trim())
    .map(k => `<a href="${href(s[k])}" aria-label="${ICONS[k][0]}">${ICONS[k][1]}</a>`).join('');

  const isCurrent = (h, slug) => String(h || '').replace(/^\.?\//, '') === `${slug}.html`;

  // Home / [menu parent] / this page — worked out from the top menu, nothing to maintain
  function breadcrumb(site, slug, label) {
    const crumbs = ['<a href="index.html">Home</a>'];
    for (const n of site.nav || []) {
      if (isCurrent(n.href, slug)) break;
      if ((n.children || []).some(c => isCurrent(c.href, slug))) { crumbs.push(`<a href="${href(n.href)}">${esc(n.label)}</a>`); break; }
    }
    crumbs.push(`<span aria-current="page">${esc(label)}</span>`);
    return `<nav class="breadcrumb" aria-label="Breadcrumb">${crumbs.join(' / ')}</nav>`;
  }

  function header(site, slug) {
    const nav = (site.nav || []).map(n => {
      const kids = (n.children || []).filter(c => c.label);
      const cur = (isCurrent(n.href, slug) || (n.children || []).some(c => isCurrent(c.href, slug))) ? ' aria-current="page"' : '';
      const sub = kids.length ? `<ul class="submenu">${kids.map(c => `<li><a href="${href(c.href)}">${esc(c.label)}</a></li>`).join('')}</ul>` : '';
      return `<li${kids.length ? ' class="has-sub"' : ''}><a href="${href(n.href)}"${cur}>${esc(n.label)}</a>${sub}</li>`;
    }).join('\n');
    return `<div class="topbar"><span class="heart" aria-hidden="true">&#9829;</span> ${esc(site.topbar)} <span class="heart" aria-hidden="true">&#9829;</span></div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="logo-link" href="index.html"><img src="${src(site.logo)}" width="210" height="233" alt="The Cows Nest home"></a>
    <div class="tagline">
      <div class="script">${esc(site.taglineScript)}</div>
      <div class="values">${(site.values || []).filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('')}</div>
    </div>
    <div class="utilities">
      <div class="socials">${socials(site.social)}</div>
      <div class="account-links">
        <a href="account.html">My account</a><span class="sep" aria-hidden="true">|</span>
        <a href="wishlist.html">Wishlist</a><span class="sep" aria-hidden="true">|</span>
        <a href="cart.html">${SVG('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.5 12h11.5l2-8H6.5"/>', 18)}Cart (0)</a>
      </div>
      <form class="search-form" action="search.html" method="get" role="search">
        <label class="visually-hidden" for="q">Search the nest</label>
        <input id="q" name="q" type="search" placeholder="Search the nest…">
        <button type="submit" aria-label="Search">${SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', 18)}</button>
      </form>
    </div>
  </div>
  <nav class="main-nav gingham" aria-label="Main">
    <div class="wrap nav-inner">
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-list">${SVG('<path d="M4 7h16M4 12h16M4 17h16"/>', 20)} Menu</button>
      <ul class="nav-list" id="nav-list">
${nav}
      </ul>
    </div>
  </nav>
</header>`;
  }

  function footer(site) {
    const col = c => `<div><h2>${esc(c.title)}</h2><ul>${(c.links || []).map(l => `<li><a href="${href(l.href)}">${esc(l.label)}</a></li>`).join('')}</ul></div>`;
    const cols = site.footerColumns || [];
    const email = String(site.email || '').trim();
    const year = new Date().getFullYear();
    return `<footer class="site-footer">
  <div class="wrap footer-grid">
    ${cols.slice(0, 2).map(col).join('\n    ')}
    <div class="footer-logo"><a href="index.html"><img src="${src(site.footerLogo)}" width="170" height="189" alt="The Cows Nest home" loading="lazy"></a></div>
    ${cols.slice(2).map(col).join('\n    ')}
    <div>
      <h2>${esc(site.connectTitle || "Let's connect!")}</h2>
      <div class="footer-social">${socials(site.social)}${email ? `<a href="mailto:${esc(email)}" aria-label="Email">${MAIL_ICON}</a>` : ''}</div>
      <ul>
        ${(site.connectLinks || []).map(l => `<li><a href="${href(l.href)}">${esc(l.label)}</a></li>`).join('\n        ')}
        ${email ? `<li><a href="mailto:${esc(email)}">${esc(email)}</a></li>` : ''}
      </ul>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>${esc(String(site.copyright || '').replace('{year}', year))}</span>
    <span>Website made by <a href="https://dawnintegrations.com">dawnintegrations.com</a> &nbsp;|&nbsp; <a href="mailto:russell@dawnintegrations.com">russell@dawnintegrations.com</a></span>
  </div>
</footer>`;
  }

  // Standard section wrapper with an optional section heading
  const titled = (s, i, inner) => `<section class="section wrap"${sid(i)}${s.title ? ` aria-labelledby="cn-s${i}"` : ''}>
  ${s.title ? `<h2 class="section-title" id="cn-s${i}">${esc(s.title)}</h2>` : ''}
  ${inner}
</section>`;

  const SECTIONS = {
    'page-hero': (s, i, ctx) => `<section class="page-hero"${sid(i)}>
  <div class="wrap">
    ${ctx.slug === 'index' ? '' : breadcrumb(ctx.site, ctx.slug, s.heading)}
    <h1>${esc(s.heading)}</h1>
    ${s.lede || s.searchTerm ? `<p class="lede">${s.searchTerm ? ' <span id="search-term"></span>' : ''}${lines(s.lede)}</p>` : ''}
  </div>
</section>`,

    'coming-soon': (s, i) => `<section class="coming-soon wrap"${sid(i)}>
  <div class="coming-card">
    ${s.image ? `<img src="${src(s.image)}" alt="" width="150" height="150">` : ''}
    <div>
      <h2>${esc(s.title)}</h2>
      ${paras(s.text)}
      <div class="actions">${(s.buttons || []).map(b => `<a class="btn btn-small${b.style === 'outline' ? ' btn-outline' : ''}" href="${href(b.link)}">${esc(b.label)}</a>`).join('')}</div>
    </div>
  </div>
</section>`,

    hero: (s, i) => `<section class="hero"${sid(i)}>
  <div class="wrap hero-inner">
    <div>
      <h1><span class="welcome">${esc(s.welcome)}</span><span class="name">${esc(s.name)}</span></h1>
      ${FLOURISH}
      ${paras(s.text)}
      <div class="hero-actions">${(s.buttons || []).map(b => `<a class="btn${b.style === 'outline' ? ' btn-outline' : ''}" href="${href(b.link)}">${esc(b.label)}</a>`).join('')}</div>
    </div>
    <div class="hero-art">
      ${s.image ? `<img src="${src(s.image)}" width="560" height="567" alt="${esc(s.imageAlt)}">` : ''}
      ${s.bubble1 ? `<div class="bubble bubble-1" aria-hidden="true">${lines(s.bubble1)}</div>` : ''}
      ${s.bubble2 ? `<div class="bubble bubble-2" aria-hidden="true">${lines(s.bubble2)}</div>` : ''}
    </div>
  </div>
</section>`,

    'category-cards': (s, i) => titled(s, i, `<div class="cat-grid">
${(s.items || []).map(c => `<a class="cat-card" href="${href(c.link)}"><img src="${src(c.image)}" alt="" width="126" height="101" loading="lazy"><div class="body"><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div></a>`).join('\n')}
  </div>`),

    'visit-cards': (s, i) => titled(s, i, `<div class="visit-grid">
${(s.items || []).map(c => `<article class="visit-card"><div class="body"><h3>${esc(c.title)}</h3>${paras(c.text)}${c.buttonLabel ? `<a class="btn btn-small" href="${href(c.link)}">${esc(c.buttonLabel)}</a>` : ''}</div><img src="${src(c.image)}" alt="" width="150" height="146" loading="lazy"></article>`).join('\n')}
  </div>`),

    'daisy-pip': (s, i) => `<section class="section wrap"${sid(i)}>
  <div class="trio">
    <div class="meet">
      <div>
        <h2>${esc(s.meetTitle)}</h2>
        ${paras(s.meetText)}
        ${s.meetButton ? `<a class="btn btn-small" href="${href(s.meetLink)}">${esc(s.meetButton)}</a>` : ''}
      </div>
      <img src="${src(s.meetImage)}" alt="${esc(s.meetImageAlt)}" width="138" height="140" loading="lazy">
    </div>
    <div class="chat gingham-soft">
      <div class="chat-head"><h2>${lines(s.chatTitle)}</h2><img src="${src(s.chatImage)}" alt="${esc(s.chatImageAlt)}" width="85" height="137" loading="lazy"></div>
      ${paras(s.chatText)}
      ${s.chatButton ? `<a class="btn btn-small" href="${href(s.chatLink)}">${esc(s.chatButton)}</a>` : ''}
    </div>
    <form class="signup" novalidate>
      <h2>${esc(s.signupTitle)}</h2>
      ${paras(s.signupText)}
      <label for="herd-email">Email address</label>
      <input id="herd-email" name="email" type="email" autocomplete="email" placeholder="you@example.com">
      <button class="btn" type="submit">${esc(s.signupButton || 'Sign me up!')}</button>
      <p class="form-note" role="status"></p>
    </form>
  </div>
</section>`,

    instagram: (s, i) => titled(s, i, `<div class="insta-grid">
${(s.items || []).map((p, n) => `<a href="${href(p.link)}" aria-label="Instagram post ${n + 1}"><img src="${src(p.image)}" alt="" width="125" height="118" loading="lazy"></a>`).join('\n')}
  </div>`),

    trust: (s, i) => `<section class="trust" aria-label="Why shop with us"${sid(i)}>
  <ul class="wrap">${(s.items || []).map(t => `<li><img src="${src(t.icon)}" alt="" height="40" loading="lazy"><span>${lines(t.text)}</span></li>`).join('')}</ul>
</section>`,

    text: (s, i) => titled(s, i, `<div class="cn-text${s.align === 'center' ? ' cn-center' : ''}">${paras(s.text)}</div>`),

    'image-text': (s, i) => `<section class="section wrap"${sid(i)}>
  <div class="cn-imgtext${s.side === 'right' ? ' cn-img-right' : ''}">
    ${s.image ? `<img src="${src(s.image)}" alt="${esc(s.imageAlt)}" width="1200" height="900" loading="lazy">` : '<div></div>'}
    <div class="cn-imgtext-body">
      ${s.title ? `<h2 class="section-title">${esc(s.title)}</h2>` : ''}
      ${paras(s.text)}
      ${s.buttonLabel ? `<a class="btn" href="${href(s.link)}">${esc(s.buttonLabel)}</a>` : ''}
    </div>
  </div>
</section>`,

    gallery: (s, i) => titled(s, i, `<div class="cn-gallery">
${(s.items || []).map(g => `<figure><img src="${src(g.image)}" alt="${esc(g.caption)}" width="900" height="900" loading="lazy">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('\n')}
  </div>`),

    // Products come from Square (via the shop Worker); shop.js fills these in.
    'product-grid': (s, i) => {
      const grid = `<div class="cn-products" data-shop="grid" data-category="${esc(s.category || 'all')}" data-limit="${Number(s.limit) || 0}" data-empty="${esc(s.emptyText || '')}"></div>`;
      return titled(s, i, grid).replace('<section class="section wrap"', '<section class="section wrap" data-shop-section');
    },

    'product-detail': (s, i) => `<section class="section wrap cn-product"${sid(i)}><div data-shop="product"><p class="cn-empty">Loading…</p></div></section>`,

    cart: (s, i) => `<section class="section wrap"${sid(i)}><div class="cn-cart" data-shop="cart"><p class="cn-empty">Loading your cart…</p></div></section>`,

    'order-confirmation': (s, i) => `<section class="section wrap"${sid(i)}><div class="cn-order" data-shop="order"><p class="cn-empty">Loading your order…</p></div></section>`,
  };

  function setMeta(desc) {
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = desc || '';
  }

  function render(data, slug, opts = {}) {
    const site = data.site || {};
    const page = (data.pages || {})[slug];
    const h = document.getElementById('cn-header');
    const m = document.getElementById('main');
    const f = document.getElementById('cn-footer');
    const productId = opts.productId || new URLSearchParams(location.search).get('id') || '';
    window.CN = { data, slug, productId, preview, src, esc, paras };
    if (h) h.innerHTML = header(site, slug);
    if (f) f.innerHTML = footer(site);
    if (!m) return;
    if (!page) {
      document.title = 'Page not found | The Cows Nest';
      m.innerHTML = '<section class="section wrap"><h1 class="section-title">Page not found</h1><p><a class="btn" href="index.html">Go to the home page</a></p></section>';
    } else {
      document.title = page.title || 'The Cows Nest';
      setMeta(page.description);
      const ctx = { site, slug };
      m.innerHTML = (page.sections || []).map((s, i) =>
        (s.hidden || !SECTIONS[s.type]) ? '' : SECTIONS[s.type](s, i, ctx)).join('\n');
    }
    document.dispatchEvent(new CustomEvent('cn:rendered'));
  }

  const params = new URLSearchParams(location.search);
  const preview = params.has('cnpreview') && window.parent !== window;
  let slug = (preview && params.get('page')) || document.body.dataset.page || 'index';

  if (window.CN_DATA) render(window.CN_DATA, slug);

  // cart, add-to-cart and order pages (loaded here so page shells never need editing)
  if (BASE && !document.querySelector('script[data-cn-shop]')) {
    const sc = document.createElement('script');
    sc.src = BASE + 'shop.js'; sc.dataset.cnShop = '';
    document.body.appendChild(sc);
  }

  if (preview) {
    window.addEventListener('message', e => {
      if (e.source !== window.parent || !e.data || e.data.type !== 'cn-render') return;
      IMG = e.data.images || {};
      slug = e.data.page || slug;
      render(e.data.data, slug, { productId: e.data.productId });
      if (e.data.scrollTo != null) {
        const el = document.querySelector(`[data-cn-section="${e.data.scrollTo}"]`);
        // scroll only this frame; scrollIntoView would also scroll the editor page around it on phones
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'smooth' });
      }
    });
    // In the editor preview: links don't navigate; clicking a section opens it in the editor.
    document.addEventListener('click', e => {
      if (e.target.closest('a, button')) e.preventDefault();
      const sec = e.target.closest('[data-cn-section]');
      if (sec) window.parent.postMessage({ type: 'cn-pick', index: +sec.dataset.cnSection }, '*');
    }, true);
    document.addEventListener('submit', e => e.preventDefault(), true);
    window.parent.postMessage({ type: 'cn-ready' }, '*');
  }
})();
