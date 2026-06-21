# Chiba Home Search 🏡

A simple, English-language tool to help you **buy a home in Chiba prefecture (千葉県)**
when you don't read Japanese.

Japan's property portals (SUUMO, LIFULL HOME'S, AtHome) are Japanese-only and have no
English API. Rather than scraping them (fragile and against their terms), this tool acts
as a **smart link builder**: you enter your budget and what you want in English, and it

- translates everything into the exact Japanese filter terms the sites use,
- opens the right Chiba listings on each portal for your property type, and
- builds a **precise Google `site:` search** that bakes in your city, budget, layout and
  more — the fastest way to jump straight to matching listings (then use your browser's
  "Translate to English" on the results).

It's a single static page — no server, no build step, no dependencies.

## Use it

Just open `index.html` in any web browser:

```bash
# from this folder
open index.html        # macOS
xdg-open index.html    # Linux
# or double-click the file
```

That's it. Pick a property type, city, budget and filters, then click
**“Build my searches”**.

## Host it online (optional, free)

To use it from your phone or share it, host the `chiba-home-search/` folder on
**GitHub Pages**:

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: “Deploy from a branch.”**
3. Pick your branch and set the folder to `/` (or move these files to `/docs`).
4. Your site appears at `https://<you>.github.io/<repo>/chiba-home-search/`.

Any static host works too (Netlify, Cloudflare Pages, Vercel) — point it at this folder.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page structure & form |
| `styles.css` | Styling |
| `app.js` | Form logic, currency conversion, link building |
| `data.js` | Chiba cities, property types, portal URLs, glossary — **edit here to add data** |

## Customising

Everything you'd want to tweak lives in `data.js`:

- **Add a city** → add an entry to `CHIBA_CITIES` (`en`, `ja`, and the official `jis`
  municipality code).
- **Add/adjust a property type or portal URL** → edit `PROPERTY_TYPES`.
- **Add glossary terms** → edit `GLOSSARY`.

## Notes & caveats

- Property data, prices and availability live entirely on the third-party sites. This tool
  only builds links to their public search pages.
- Currency conversions are approximate — set the ¥/$ rate in the form.
- Portal category URLs follow each site's standard, long-standing structure. If a site ever
  reorganises its URLs, the **“Precise Google search”** button is the robust fallback (it
  always finds current listings).
- **Foreigners can legally buy property in Japan** with no residency requirement; getting a
  Japanese mortgage is the harder part and usually needs residency + stable income. Budget
  ~6–8% on top of the price for taxes and fees.
