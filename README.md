# Read Like 2000

Read Like 2000 is a local blog reader for a personal, curated feed. Sources are stored in an explicit registry, posts are merged into a chronological timeline, new items are marked, and short previews can be translated into Russian with a local cache.

## Run

Set an OpenAI API key if you want automatic title and preview translations:

```bash
export OPENAI_API_KEY="your_api_key_here"
```

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

Titles and short previews are translated into Russian through the server endpoint `/api/translations`. The app uses the OpenAI Responses API with `gpt-5.5` by default. To use a different model, set `OPENAI_TRANSLATION_MODEL`. To point at a compatible proxy or test server, set `OPENAI_BASE_URL`.

The local translation cache is stored in `data/translations.json` and is not committed.
