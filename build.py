#!/usr/bin/env python3
"""Builds The Cows Nest static site.

Every page shares the same header, nav and footer from this file.
Edit the PAGES list or the templates below, then run:  python3 build.py
Output: the .html files in this folder (ready for GitHub Pages or any web host).
"""
from pathlib import Path
from html import escape

ROOT = Path(__file__).parent
SITE_NAME = "The Cows Nest"
YEAR = 2026

# ---------------------------------------------------------------- pages
# slug: (title, short description, parent slug or None, image or None)
PAGES = {
    "shop":               ("Shop Online", "Handmade goods, paper treasures, sweet treats and more, all in one place.", None, "cat-handmade.jpg"),
    "handmade-goods":     ("Handmade Goods", "Crafts, décor, gifts and more, made by hand in small batches.", "shop", "cat-handmade.jpg"),
    "paper-goods":        ("Paper Goods & Printables", "Notepads, recipe cards, art prints and more.", "shop", "cat-paper.jpg"),
    "sweet-treats":       ("Sweet Treats & Goodies", "Baked goods, popcorn, snacks and mixes.", "shop", "cat-treats.jpg"),
    "apparel":            ("Apparel & Accessories", "Shirts, hats, tote bags, keychains and more.", "shop", "cat-apparel.jpg"),
    "jewelry":            ("Jewelry & Small Finds", "Handmade jewelry, charms and little treasures.", "shop", "cat-jewelry.jpg"),
    "digital-downloads":  ("Digital Downloads", "Coloring pages, planners, binders and more, ready to print at home.", None, "cat-downloads.jpg"),
    "seasonal":           ("Seasonal Collections", "New finds for every season.", "shop", "cat-seasonal.jpg"),
    "visit":              ("Visit the Cows Nest", "Find us at the roadside stand, our vendor booth, or a market near you.", None, "visit-stand.jpg"),
    "roadside-stand":     ("The Roadside Stand", "Our honor stand on the corner, open daily from sunup to sundown.", "visit", "visit-stand.jpg"),
    "vendor-booth":       ("The Vendor Booth", "Home décor, handcrafted gifts, wreaths, jewelry and paper goods.", "visit", "visit-booth.jpg"),
    "markets":            ("Markets & Pop-Ups", "See where we'll be next.", "visit", "visit-markets.jpg"),
    "local-pickup":       ("Local Pickup", "Order online and pick up close to home.", "visit", "visit-stand.jpg"),
    "about":              ("Our Story", "How the Cows Nest came to be.", None, "daisy-pip-chat.jpg"),
    "daisy-and-pip":      ("Meet Daisy & Pip", "Daisy the cow and Pip the wren love sharing little conversations, sweet reminders, and simple joys.", "about", "daisy-pip-chat.jpg"),
    "conversations":      ("Conversations Over the Picket Fence", "New chats every week: encouragement, giggles, life lessons and a little mischief.", "about", "pip.jpg"),
    "blog":               ("Blog", "News, projects and happenings from the nest.", None, "insta-3.jpg"),
    "contact":            ("Contact Us", "We'd love to hear from you.", None, "icon-nest.jpg"),
    "account":            ("My Account", "Sign in to see your orders and saved details.", None, "icon-bird.jpg"),
    "wishlist":           ("Wishlist", "Save your favorite finds for later.", None, "icon-heart.jpg"),
    "cart":               ("Your Cart", "Your cart is empty.", None, "icon-nest.jpg"),
    "search":             ("Search the Nest", "Search results will show here.", None, "icon-bird.jpg"),
    "faq":                ("FAQ", "Answers to common questions.", None, "icon-heart2.jpg"),
    "shipping-returns":   ("Shipping & Returns", "How we ship and how returns work.", None, "icon-nest.jpg"),
    "order-tracking":     ("Order Tracking", "Check on an order.", None, "icon-nest.jpg"),
    "payment-options":    ("Payment Options", "Ways to pay online and in person.", None, "icon-heart3.jpg"),
    "privacy":            ("Privacy Policy", "How we handle your information.", None, "icon-heart2.jpg"),
    "terms":              ("Terms of Use", "The terms for using this website.", None, "icon-heart3.jpg"),
}

NAV = [
    ("index", "Home", []),
    ("shop", "Shop Online", ["shop", "handmade-goods", "paper-goods", "sweet-treats", "apparel", "jewelry", "seasonal"]),
    ("digital-downloads", "Digital Downloads", []),
    ("visit", "Visit the Cows Nest", ["roadside-stand", "vendor-booth", "markets", "local-pickup"]),
    ("about", "About Us", ["about", "daisy-and-pip", "conversations"]),
    ("blog", "Blog", []),
    ("contact", "Contact", []),
]
SUB_LABELS = {"shop": "All Products", "about": "Our Story"}

# TODO: replace "#" with the real social profile URLs
SOCIAL = {"Facebook": "#", "Instagram": "#", "Pinterest": "#", "TikTok": "#"}
SHOP_EMAIL = "hello@thecowsnest.com"

# ---------------------------------------------------------------- icons
def icon(name, size=16):
    paths = {
        "Facebook": '<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H7v3h2v9h3v-9h2.5l.5-3h-3V7a1 1 0 0 1 1-1h2z"/>',
        "Instagram": '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/>',
        "Pinterest": '<path d="M9 21l2.5-10"/><path d="M8.5 14.5A6 6 0 1 1 18 10c0 3.5-2 6-4.5 6-1.5 0-2.4-1-2.2-2.3"/>',
        "TikTok": '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3a5 5 0 0 0 5 5"/>',
        "Email": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
        "cart": '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.5 12h11.5l2-8H6.5"/>',
        "search": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
        "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    }
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>')

FLOURISH = ('<svg class="flourish" width="160" height="20" viewBox="0 0 160 20" fill="none" stroke="#C9A77A" '
            'stroke-width="1.5" aria-hidden="true"><path d="M0 10h66"/><path d="M94 10h66"/>'
            '<path d="M80 17s-8-4.5-8-9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 4.5-8 9-8 9z" fill="#D9735F" stroke="#D9735F"/></svg>')

def href(slug):
    return "index.html" if slug == "index" else f"{slug}.html"

def title_of(slug):
    return "Home" if slug == "index" else PAGES[slug][0]

# ---------------------------------------------------------------- layout
def nav_html(current):
    parent = PAGES[current][2] if current in PAGES else None
    items = []
    for slug, label, subs in NAV:
        active = current == slug or parent == slug or (current in subs)
        cur = ' aria-current="page"' if active else ""
        if subs:
            sub = "".join(
                f'<li><a href="{href(s)}">{escape(SUB_LABELS.get(s, title_of(s)))}</a></li>' for s in subs)
            items.append(f'<li class="has-sub"><a href="{href(slug)}"{cur}>{escape(label)}</a>'
                         f'<ul class="submenu">{sub}</ul></li>')
        else:
            items.append(f'<li><a href="{href(slug)}"{cur}>{escape(label)}</a></li>')
    return "\n".join(items)

def header(current):
    socials = "".join(f'<a href="{u}" aria-label="{n}">{icon(n)}</a>' for n, u in SOCIAL.items())
    return f'''<a class="skip-link" href="#main">Skip to content</a>
<div class="topbar"><span class="heart" aria-hidden="true">&#9829;</span> Homemade with love, from our nest to yours <span class="heart" aria-hidden="true">&#9829;</span></div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="logo-link" href="index.html"><img src="assets/img/logo.webp" width="210" height="233" alt="The Cows Nest home"></a>
    <div class="tagline">
      <div class="script">Conversations Over the Picket Fence</div>
      <div class="values"><span>Handmade</span><span>Creative</span><span>Southern</span><span>From the heart</span></div>
    </div>
    <div class="utilities">
      <div class="socials">{socials}</div>
      <div class="account-links">
        <a href="account.html">My account</a><span class="sep" aria-hidden="true">|</span>
        <a href="wishlist.html">Wishlist</a><span class="sep" aria-hidden="true">|</span>
        <a href="cart.html">{icon("cart", 18)}Cart (0)</a>
      </div>
      <form class="search-form" action="search.html" method="get" role="search">
        <label class="visually-hidden" for="q">Search the nest</label>
        <input id="q" name="q" type="search" placeholder="Search the nest…">
        <button type="submit" aria-label="Search">{icon("search", 18)}</button>
      </form>
    </div>
  </div>
  <nav class="main-nav gingham" aria-label="Main">
    <div class="wrap nav-inner">
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-list">{icon("menu", 20)} Menu</button>
      <ul class="nav-list" id="nav-list">
{nav_html(current)}
      </ul>
    </div>
  </nav>
</header>'''

def footer():
    col = lambda heading, slugs: (f'<div><h2>{heading}</h2><ul>' + "".join(
        f'<li><a href="{href(s)}">{escape(SUB_LABELS.get(s, title_of(s)) if s in ("shop",) else title_of(s))}</a></li>'
        for s in slugs) + '</ul></div>')
    socials = "".join(f'<a href="{u}" aria-label="{n}">{icon(n)}</a>' for n, u in SOCIAL.items())
    socials += f'<a href="mailto:{SHOP_EMAIL}" aria-label="Email">{icon("Email")}</a>'
    return f'''<footer class="site-footer">
  <div class="wrap footer-grid">
    {col("Shop", ["shop", "handmade-goods", "paper-goods", "sweet-treats", "apparel", "jewelry", "digital-downloads", "seasonal"])}
    {col("Visit us", ["roadside-stand", "vendor-booth", "markets", "local-pickup"])}
    <div class="footer-logo"><a href="index.html"><img src="assets/img/logo-small.webp" width="170" height="189" alt="The Cows Nest home" loading="lazy"></a></div>
    {col("Help", ["faq", "shipping-returns", "order-tracking", "payment-options", "privacy", "terms"])}
    <div>
      <h2>Let's connect!</h2>
      <div class="footer-social">{socials}</div>
      <ul>
        <li><a href="about.html">Our Story</a></li>
        <li><a href="daisy-and-pip.html">Meet Daisy &amp; Pip</a></li>
        <li><a href="mailto:{SHOP_EMAIL}">{SHOP_EMAIL}</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>&copy; {YEAR} The Cows Nest. All rights reserved.</span>
    <span>Website made by <a href="https://dawnintegrations.com">dawnintegrations.com</a> &nbsp;|&nbsp; <a href="mailto:russell@dawnintegrations.com">russell@dawnintegrations.com</a></span>
  </div>
</footer>'''

def page(slug, title, description, body):
    full = SITE_NAME if slug == "index" else f"{title} | {SITE_NAME}"
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(full)}</title>
<meta name="description" content="{escape(description)}">
<link rel="icon" type="image/png" href="assets/img/favicon.png">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:wght@400;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Parisienne&display=swap">
<link rel="stylesheet" href="assets/css/styles.css">
</head>
<body>
{header(slug)}
<main id="main">
{body}
</main>
{footer()}
<script src="assets/js/site.js"></script>
</body>
</html>
'''

# ---------------------------------------------------------------- home page
def home():
    cats = [("handmade-goods", "Handmade Goods", "Crafts, décor, gifts &amp; more", "cat-handmade.jpg"),
            ("paper-goods", "Paper Goods &amp; Printables", "Notepads, recipe cards, art prints &amp; more", "cat-paper.jpg"),
            ("sweet-treats", "Sweet Treats &amp; Goodies", "Baked goods, popcorn, snacks &amp; mixes", "cat-treats.jpg"),
            ("apparel", "Apparel &amp; Accessories", "Shirts, hats, tote bags, keychains &amp; more", "cat-apparel.jpg"),
            ("jewelry", "Jewelry &amp; Small Finds", "Handmade jewelry, charms &amp; treasures", "cat-jewelry.jpg"),
            ("digital-downloads", "Digital Downloads", "Coloring pages, planners, binders &amp; more", "cat-downloads.jpg"),
            ("seasonal", "Seasonal Collections", "New finds for every season", "cat-seasonal.jpg")]
    cat_html = "\n".join(
        f'<a class="cat-card" href="{href(s)}"><img src="assets/img/{img}" alt="" width="126" height="101" loading="lazy">'
        f'<div class="body"><h3>{t}</h3><p>{d}</p></div></a>' for s, t, d, img in cats)
    visits = [("roadside-stand", "The Roadside Stand", "Our honor stand on the corner, with fresh baked goods, seasonal treats, paper goods and rotating finds. Open daily from sunup to sundown.", "Learn more", "visit-stand.jpg"),
              ("vendor-booth", "The Vendor Booth", "Find us inside a large antique mall with home décor, handcrafted gifts, wreaths, jewelry, paper goods and more.", "See the booth", "visit-booth.jpg"),
              ("markets", "Markets &amp; Pop-Ups", "We love meeting y'all at markets, fairs and special events through the year. See where we'll be next!", "View events", "visit-markets.jpg")]
    visit_html = "\n".join(
        f'<article class="visit-card"><div class="body"><h3>{t}</h3><p>{d}</p>'
        f'<a class="btn btn-small" href="{href(s)}">{b}</a></div>'
        f'<img src="assets/img/{img}" alt="" width="150" height="146" loading="lazy"></article>' for s, t, d, b, img in visits)
    insta = "\n".join(f'<a href="{SOCIAL["Instagram"]}" aria-label="Instagram post {i}"><img src="assets/img/insta-{i}.jpg" alt="" width="125" height="118" loading="lazy"></a>' for i in range(1, 8))
    trust = [("icon-heart.jpg", "Handmade<br>in small batches"), ("icon-bird.jpg", "Woman owned<br>&amp; family run"),
             ("icon-heart2.jpg", "Support small<br>shop local"), ("icon-nest.jpg", "Packaged with care<br>from our nest to yours"),
             ("icon-heart3.jpg", "Thank you!<br>You mean the world")]
    trust_html = "".join(f'<li><img src="assets/img/{i}" alt="" height="40" loading="lazy"><span>{t}</span></li>' for i, t in trust)
    return f'''<section class="hero">
  <div class="wrap hero-inner">
    <div>
      <h1><span class="welcome">Welcome to</span><span class="name">The Cows Nest</span></h1>
      {FLOURISH}
      <p>A creative Southern mercantile filled with handmade goods, paper treasures, sweet treats, seasonal finds, and simple things that make everyday life special.</p>
      <div class="hero-actions"><a class="btn" href="shop.html">Shop online</a><a class="btn btn-outline" href="visit.html">Visit us in person</a></div>
    </div>
    <div class="hero-art">
      <img src="assets/img/daisy-and-pip.webp" width="560" height="567" alt="Daisy the cow and Pip the wren with a blueberry pie by the picket fence">
      <div class="bubble bubble-1" aria-hidden="true">Did someone<br>say pie?</div>
      <div class="bubble bubble-2" aria-hidden="true">Only if you<br>share a slice.</div>
    </div>
  </div>
</section>

<section class="section wrap" aria-labelledby="find">
  <h2 class="section-title" id="find">What can we help you find?</h2>
  <div class="cat-grid">
{cat_html}
  </div>
</section>

<section class="section wrap" aria-labelledby="visit">
  <h2 class="section-title" id="visit">Visit the Cows Nest in person</h2>
  <div class="visit-grid">
{visit_html}
  </div>
</section>

<section class="section wrap">
  <div class="trio">
    <div class="meet">
      <div>
        <h2>Meet Daisy &amp; Pip</h2>
        <p>Daisy the cow and Pip the wren love sharing little conversations, sweet reminders, and simple joys.</p>
        <a class="btn btn-small" href="daisy-and-pip.html">Read their latest chat</a>
      </div>
      <img src="assets/img/daisy-pip-chat.jpg" alt="Daisy and Pip" width="138" height="140" loading="lazy">
    </div>
    <div class="chat gingham-soft">
      <div class="chat-head"><h2>Conversations<br>Over the Picket Fence</h2><img src="assets/img/pip.jpg" alt="Pip the wren" width="85" height="137" loading="lazy"></div>
      <p>New chats every week! Encouragement, giggles, life lessons &amp; a little mischief.</p>
      <a class="btn btn-small" href="conversations.html">Join the conversation</a>
    </div>
    <form class="signup" novalidate>
      <h2>Join the herd!</h2>
      <p>Be the first to hear about new goodies, market dates, special offers &amp; sweet little surprises.</p>
      <label for="herd-email">Email address</label>
      <input id="herd-email" name="email" type="email" autocomplete="email" placeholder="you@example.com">
      <button class="btn" type="submit">Sign me up!</button>
      <p class="form-note" role="status"></p>
    </form>
  </div>
</section>

<section class="section wrap" aria-labelledby="insta">
  <h2 class="section-title" id="insta">Follow along on Instagram</h2>
  <div class="insta-grid">
{insta}
  </div>
</section>

<section class="trust" aria-label="Why shop with us">
  <ul class="wrap">{trust_html}</ul>
</section>'''

# ---------------------------------------------------------------- inner pages
def inner(slug):
    title, lede, parent, img = PAGES[slug]
    crumbs = '<a href="index.html">Home</a>'
    if parent:
        crumbs += f' / <a href="{href(parent)}">{escape(PAGES[parent][0])}</a>'
    crumbs += f' / <span aria-current="page">{escape(title)}</span>'
    extra = ' <span id="search-term"></span>' if slug == "search" else ""
    return f'''<section class="page-hero">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="Breadcrumb">{crumbs}</nav>
    <h1>{escape(title)}</h1>
    <p class="lede">{extra}{escape(lede)}</p>
  </div>
</section>
<section class="coming-soon wrap">
  <div class="coming-card">
    <img src="assets/img/{img}" alt="" width="150" height="150">
    <div>
      <h2>This page is coming soon</h2>
      <p>We're still setting this part of the nest up. In the meantime, have a look around the rest of the shop.</p>
      <div class="actions"><a class="btn btn-small" href="index.html">Back to home</a><a class="btn btn-small btn-outline" href="contact.html">Contact us</a></div>
    </div>
  </div>
</section>'''

def not_found():
    return '''<section class="page-hero"><div class="wrap">
  <h1>Page not found</h1>
  <p class="lede">That page wandered out of the pasture. Head back home to keep looking.</p>
  <p style="margin-top:24px"><a class="btn" href="index.html">Back to home</a></p>
</div></section>'''

if __name__ == "__main__":
    (ROOT / "index.html").write_text(page("index", "Home",
        "A creative Southern mercantile with handmade goods, paper treasures, sweet treats and seasonal finds.", home()), encoding="utf-8")
    for s, (t, d, *_ ) in PAGES.items():
        (ROOT / f"{s}.html").write_text(page(s, t, d, inner(s)), encoding="utf-8")
    (ROOT / "404.html").write_text(page("404", "Page not found", "Page not found.", not_found()), encoding="utf-8")
    print(f"Built {len(PAGES) + 2} pages.")
