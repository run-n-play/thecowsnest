# The Cows Nest website

Static site for thecowsnest.com. No build tools needed to host it; just serve the files.

## Edit pages
Header, nav and footer are shared. Change them in `build.py` (or add a page to `PAGES`), then run:

    python3 build.py

Styles: `assets/css/styles.css`. Images: `assets/img/`.

## Preview locally
    python3 -m http.server 8000
then open http://localhost:8000

## Still to fill in
- Social links: `SOCIAL` in build.py (currently `#`)
- Email signup: not connected to a mailing service yet
- Shop, cart, account and search pages are placeholders
- Photos are cropped from the design mockup (low resolution); replace with full-size photos

## Hosting (GitHub Pages)
`CNAME` is set to thecowsnest.com. Push to a repo, enable Pages on the main branch,
then point the domain's DNS at GitHub Pages.
