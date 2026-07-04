# Read Like 2000

Read Like 2000 is a local blog reader for a personal, curated feed. Sources are stored in an explicit registry, posts are merged into a chronological timeline, new items are marked, and short previews can be translated into Russian with a local cache.

## Run

```bash
npm start
```

By default, the app runs at `http://localhost:4173`.

## Check

```bash
npm run check
```

## Sources

The main blog list lives in `data/sources.json`. The server does not fetch arbitrary feed URLs: `/api/feed` only works with a registered `source id`.

To rebuild the source registry from the built-in blog list:

```bash
npm run import:sources
```

## Translations

Titles and short previews are translated into Russian through the server endpoint `/api/translations`. The app uses Google Translate through the public `translate.googleapis.com` endpoint, so no paid API key is required.

For better preview quality, the server translates the title and description together, then splits them back into separate fields before caching the result. Set `DISABLE_TRANSLATIONS=1` before starting the server if you want to turn automatic translations off.

The local translation cache is stored in `data/translations.json` and is not committed.
