# Cows Nest shop Worker (Cloudflare Worker + Square)

Square is the product list. The website reads it through this Worker, and checkout goes to a
Square-hosted payment page. Square sets every price and tax from her catalog; nothing a shopper
sends can change what gets charged. Orders land in her Square Dashboard / app like any sale.

Endpoints: `GET /products`, `POST /checkout`, `GET /order`, `GET /download`. Offline tests: `node test.mjs`.

## 1. Square app (do this logged in as HER Square account)
1. developer.squareup.com → sign in with her Square login → **Create application** ("Cows Nest Website").
2. **Sandbox** tab: copy the *Sandbox access token*. Open the sandbox test seller dashboard,
   note its **Location ID** (Locations), and add a few test items (the sandbox has its own catalog).
3. **Production** tab (later): *Production access token* and her real **Location ID**
   (Square Dashboard → Settings → Account & settings → Locations). Use the location whose
   inventory and taxes should apply to online orders.

## 2. Her Square catalog
- Categories (names must match *Pickup, shipping & categories* in the website editor, which she can edit):
  `Website`, `Handmade Goods`, `Paper Goods`, `Sweet Treats`, `Apparel`, `Jewelry`, `Digital Downloads`, `Seasonal`.
- An item shows on the website only with **Website** + one shop category. Market-only items: skip Website.
- Turn on **Track stock** for one-of-a-kind items so they go Sold out by themselves.
- Set up **sales tax** in Square on her items; online orders apply it automatically.
- Sizes/colors = item variations, each with its own price. Variable-price items and modifiers are not sold online.

## 3. Deploy
```
cd checkout-worker
npx wrangler login
npx wrangler r2 bucket create cowsnest-downloads
npx wrangler secret put SQUARE_ACCESS_TOKEN          # sandbox token first
openssl rand -hex 32 | npx wrangler secret put SIGNING_SECRET
# edit wrangler.toml: SQUARE_LOCATION_ID (sandbox location), SITE_URL, ALLOWED_ORIGINS
npx wrangler deploy
```
Put the printed URL (e.g. `https://cowsnest-shop.<you>.workers.dev`, or a custom domain like
`shop.thecowsnest.com`) in `assets/js/data.js` → `"shop": { "checkoutUrl": "..." }` and commit.
That field is deliberately not in the editor.

## 4. Test (sandbox)
Card `4111 1111 1111 1111`, any future date, any CVC. Run: pickup order; SC shipping order with a
treat; GA address with a treat (must be refused before payment); a digital download; a tracked item
past its stock. Check in Square: the order shows the pickup/shipment details and the Shipping charge.

## 5. Go live
1. `npx wrangler secret put SQUARE_ACCESS_TOKEN` → production token.
2. wrangler.toml: `SQUARE_ENV = "production"`, production `SQUARE_LOCATION_ID`. `npx wrangler deploy`.
3. **First real order, check these in her Square Dashboard** (behaviour I could not verify offline):
   tracked stock went down, sales tax is right, the order appears under Orders with its
   fulfillment, and the Shipping charge shows. Refund the test order.

## Digital downloads
```
npx wrangler r2 object put cowsnest-downloads/coloring-pages.pdf --file ./coloring-pages.pdf --remote
```
Then she types `coloring-pages.pdf` next to that item in the editor (Products → Digital download
files). Until a file is set, the item shows "Available soon" and can't be bought.

## Notes
- Product changes in Square reach the site within ~1 minute (Worker cache); data.js changes
  (categories, shipping) take a few minutes (GitHub Pages cache).
- Stock is re-checked at checkout. Square payment links don't reserve stock, so two shoppers
  paying for the last item at the same moment can still oversell; refund one in Square.
- The thank-you page works for 30 days per order; download links last 7 days and are
  re-issued each time the page is opened.
