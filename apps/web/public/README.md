# PWA icons go here

Vite serves everything in this folder at the site root, and `vite.config.ts`'s
`VitePWA({ manifest: { icons: [...] } })` points at two files by that exact
name — put them directly in this folder (`apps/web/public/`), not in a
subfolder:

- `pwa-192x192.png` — 192×192px, used for the home-screen icon on Android and
  in most install prompts.
- `pwa-512x512.png` — 512×512px, used for the splash screen shown while the
  app is loading after being launched from the home screen, and doubles as
  the `maskable` variant in the manifest.

Both must be actual PNG files at exactly those pixel dimensions — a browser
that can't load one at the size it asked for typically falls back to no icon
at all rather than scaling a mismatched one.

**Maskable icon**: Android crops "maskable" icons into different shapes
(circle, squircle, rounded square) depending on the device's icon pack, so
`pwa-512x512.png` needs its logo kept inside the center ~80% of the canvas —
anything near the edges can get clipped. Check the result at
https://maskable.app/editor before shipping.

**Quick way to generate both from one source image**: a square logo at
512×512 or larger, run through https://realfavicongenerator.net or
https://www.pwabuilder.com/imageGenerator, gives you both sizes (and a
favicon) in one pass.

This file is just a placeholder explaining what belongs here — delete it
once the two PNGs are in place.
