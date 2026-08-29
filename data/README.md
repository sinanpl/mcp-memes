# data/

`catalogue.json` is committed generated output — `npm run sync-templates`
rebuilds it, `scripts/sync-templates.ts` is the thing to edit. Never hand-edit
the JSON.

## Where it comes from, and under what licence

It is a join of two sources from [jacebrowning/memegen](https://github.com/jacebrowning/memegen):

| Field | Source |
| --- | --- |
| `id`, `name`, `lines`, `blank`, `example`, `keywords`, `source` | `https://api.memegen.link/templates/` |
| `boxes` (the `text:` geometry) | each template's `config.yml` in the memegen repo |
| `width`, `height` | measured from the blank image itself |

memegen is MIT licensed, Copyright 2020 Jace Browning. MIT requires its notice
to travel with substantial portions of the work, and the box geometry in
`catalogue.json` is exactly that: someone else's hand-tuned coordinates, copied.
So the notice is bundled verbatim here as
[`memegen-LICENSE.txt`](memegen-LICENSE.txt) rather than only linked, because a
link is not a copy and this repository ships without network access to follow
one.

The meme images are a separate matter from the licence above. They are
third-party cultural material — screenshots, photographs, stills — hotlinked
from `api.memegen.link` at display time. Neither memegen's MIT licence nor this
repository's grants any right in them; this project does not host them and
claims nothing over them.
