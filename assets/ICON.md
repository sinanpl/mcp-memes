# The icon

`icon.svg` is the source of truth. `icon-256.png` is rendered from it and
committed, the same deal as `data/catalogue.json`: generated output that is
checked in so a build never needs the tool that produced it.

```bash
npm run render-icon    # needs rsvg-convert (brew install librsvg)
```

`scripts/build-widget.mjs` bakes both into `src/generated/assets.ts`, and
`src/server.ts` advertises them as `icons` on the server's `Implementation`, so
a host that reads them shows the mark instead of the letter M. There is no
filesystem in a Cloudflare Worker; anything served at runtime has to be a
compile-time value.

## Why this drawing and not Trollface

The obvious icon for a meme server is the Trollface, and it is not available.

Trollface was drawn by Carlos Ramirez ("Whynne") in 2008 and **registered with
the US Copyright Office on 27 July 2010**. That registration has been used: the
creator has collected six figures in licensing over the years, and in 2025
granted an *exclusive* licence to the Trollface IP to the TROLL meme coin
project. So it is not public domain, not abandoned, and not quietly tolerated —
it is actively licensed IP with an exclusive licensee.

Sources:

- <https://en.wikipedia.org/wiki/Trollface>
- <https://knowyourmeme.com/memes/trollface>
- <https://decrypt.co/337937/trollface-meme-creator-grants-exclusive-ip-rights-solana-token>

The free "troll face" SVGs on the icon-set sites do not fix this. A flat redraw
of a copyrighted character is a derivative work; whatever licence the icon set
stamps on it, the set cannot grant rights it does not hold.

Worth saying plainly: the meme *templates* this server captions are in the same
grey zone, and that is a normal, well-trodden one — nobody meaningfully polices
captioning Drake. Putting a copyrighted character in the product's own logo is a
different thing. A logo is a trade identity, it is the one image that travels
with the software everywhere, and it is exactly the use an exclusive licensee
would object to.

So: an original mark instead. Top caption bar, bottom caption bar, a face
between them. It says "captioned image, meant to be funny" without borrowing
anyone's character.

## Where it came from

Authored by Claude (Opus 5) in a Claude Code session on 2026-08-29, at the
repository owner's request. Hand-written SVG: five primitives and one arc, with
the coordinates typed directly into the file. No source image, no traced bitmap,
no icon set, no image generator — the entire provenance is the six shape lines
you can read in `icon.svg`.

Worth stating rather than assuming. "Original" is a claim, and this file sits
next to a section arguing about someone else's copyright; a reader who wants to
check the claim should be able to, and here checking it means reading the SVG.

One honest caveat: US copyright protects human authorship, and the Copyright
Office has held that purely machine-generated expression is not registrable.
The practical effect here is nil — the project is MIT, so nobody's use of the
icon depends on it being protected — but do not treat the mark as an
enforceable trademark or a registrable work without advice.

## Licence

The icon is part of this repository and covered by [../LICENSE](../LICENSE).
It is not derived from any third-party artwork.

`Anton-Regular.ttf` is unrelated to the icon and carries its own licence — see
[Anton-OFL.txt](Anton-OFL.txt).
