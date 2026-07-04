import http from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const sourcesFile = path.join(dataDir, "sources.json");
const translationsFile = path.join(dataDir, "translations.json");
const port = Number(process.env.PORT || 4173);
const openAiModel = process.env.OPENAI_TRANSLATION_MODEL || "gpt-5.5";
const openAiBaseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sourceId(feedUrl) {
  return `source-${createHash("sha1").update(feedUrl).digest("hex").slice(0, 12)}`;
}

function cacheKey(value) {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeHttpUrl(value) {
  const parsed = new URL(String(value || "").trim());

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }

  return parsed.toString();
}

async function readSources() {
  try {
    const saved = JSON.parse(await readFile(sourcesFile, "utf8"));
    return Array.isArray(saved.sources) ? saved.sources : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeSources(sources) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(sourcesFile, `${JSON.stringify({ sources }, null, 2)}\n`);
}

async function readTranslations() {
  try {
    const saved = JSON.parse(await readFile(translationsFile, "utf8"));
    return saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeTranslations(translations) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(translationsFile, `${JSON.stringify(translations, null, 2)}\n`);
}

function publicSource(source) {
  return {
    id: source.id,
    title: source.title,
    siteUrl: source.siteUrl,
    feedUrl: source.feedUrl,
    parser: source.parser || "feed",
    createdAt: source.createdAt
  };
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"));
  return match ? match[1].replace(/^["']|["']$/g, "") : "";
}

function decodeHtml(value = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    const lower = code.toLowerCase();

    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return named[lower] || entity;
  });
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function looksRussian(value = "") {
  const cyrillic = value.match(/[А-Яа-яЁё]/g)?.length || 0;
  const latin = value.match(/\p{Script=Latin}/gu)?.length || 0;
  return cyrillic > 0 && cyrillic >= latin;
}

async function runLimited(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function normalizePreviewText(text, maxLength) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function responseOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  return (response.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
}

async function translatePreviewToRussian({ title, description }) {
  const normalizedTitle = normalizePreviewText(title, 240);
  const normalizedDescription = normalizePreviewText(description, 1200);

  if (!normalizedTitle && !normalizedDescription) {
    return { title: normalizedTitle, description: normalizedDescription };
  }

  if (looksRussian(normalizedTitle) && (!normalizedDescription || looksRussian(normalizedDescription))) {
    return { title: normalizedTitle, description: normalizedDescription };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch(`${openAiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      store: false,
      instructions: [
        "Translate blog feed preview metadata into natural Russian.",
        "Preserve names, URLs, code identifiers, product names, and quoted titles when appropriate.",
        "Do not add commentary, summaries, explanations, markdown, or facts not present in the source.",
        "Keep the translation concise and useful for quickly deciding whether to read the article."
      ].join(" "),
      input: JSON.stringify({
        title: normalizedTitle,
        description: normalizedDescription
      }),
      text: {
        format: {
          type: "json_schema",
          name: "blog_preview_translation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" }
            },
            required: ["title", "description"]
          }
        }
      }
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI translation responded with ${response.status}: ${errorText.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = responseOutputText(data);
  const translated = JSON.parse(text);

  return {
    title: normalizePreviewText(translated.title || normalizedTitle, 240),
    description: normalizePreviewText(translated.description || normalizedDescription, 1200)
  };
}

async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;

    if (body.length > 1024 * 1024) {
      throw new Error("Request body is too large");
    }
  }

  return body ? JSON.parse(body) : {};
}

function resolvePublicPath(pathname) {
  const normalized = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const requested = normalized === "/" ? "/index.html" : normalized;
  return path.join(publicDir, requested);
}

function handleConfig(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  sendJson(res, 200, {
    translationsAvailable: Boolean(process.env.OPENAI_API_KEY),
    translationModel: openAiModel
  });
}

async function handleSources(req, res, requestUrl) {
  if (req.method === "GET") {
    const sources = await readSources();
    sendJson(res, 200, { sources: sources.map(publicSource) });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const feedUrl = normalizeHttpUrl(body.feedUrl);
      const siteUrl = body.siteUrl ? normalizeHttpUrl(body.siteUrl) : new URL(feedUrl).origin;
      const title = String(body.title || "").trim() || new URL(siteUrl).hostname.replace(/^www\./, "");
      const sources = await readSources();
      const existing = sources.find((source) => source.feedUrl === feedUrl);

      if (existing) {
        sendJson(res, 200, { source: publicSource(existing), existing: true });
        return;
      }

      const source = {
        id: sourceId(feedUrl),
        title,
        siteUrl,
        feedUrl,
        createdAt: new Date().toISOString()
      };

      sources.push(source);
      await writeSources(sources);
      sendJson(res, 201, { source: publicSource(source) });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid source" });
    }
    return;
  }

  if (req.method === "DELETE") {
    const id = requestUrl.searchParams.get("id");

    if (!id) {
      sendJson(res, 400, { error: "Missing source id" });
      return;
    }

    const sources = await readSources();
    const nextSources = sources.filter((source) => source.id !== id);

    if (nextSources.length === sources.length) {
      sendJson(res, 404, { error: "Unknown source" });
      return;
    }

    await writeSources(nextSources);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleFeed(req, res, requestUrl) {
  const id = requestUrl.searchParams.get("id");

  if (!id) {
    sendJson(res, 400, { error: "Missing source id" });
    return;
  }

  const sources = await readSources();
  const source = sources.find((item) => item.id === id);

  if (!source) {
    sendJson(res, 404, { error: "Unknown source" });
    return;
  }

  if (source.parser === "dated-html-index") {
    await handleDatedHtmlIndex(res, source);
    return;
  }

  if (source.parser === "british-library-blog-index") {
    await handleBritishLibraryBlogIndex(res, source);
    return;
  }

  try {
    const response = await fetch(source.feedUrl, {
      headers: {
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "user-agent": "ReadLike2000/0.1"
      },
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      sendJson(res, response.status, { error: `Feed responded with ${response.status}` });
      return;
    }

    const body = await response.text();
    res.writeHead(200, {
      "content-type": response.headers.get("content-type") || "application/xml; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : "Could not fetch feed" });
  }
}

async function handleTranslations(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const items = Array.isArray(body.items) ? body.items.slice(0, 24) : [];
    const cache = await readTranslations();
    const translations = {};
    const missing = [];

    for (const item of items) {
      const id = String(item?.id || "");
      const title = normalizePreviewText(item?.title, 240);
      const description = normalizePreviewText(item?.description, 1200);

      if (!id || (!title && !description)) continue;

      const key = cacheKey(`ru-preview:${title}\n${description}`);

      if (cache[key]?.translated) {
        translations[id] = cache[key].translated;
      } else {
        missing.push({ id, title, description, key });
      }
    }

    await runLimited(missing, 2, async (item) => {
      const translated = await translatePreviewToRussian(item);
      cache[item.key] = {
        source: {
          title: item.title,
          description: item.description
        },
        translated,
        target: "ru",
        provider: "openai",
        model: openAiModel,
        updatedAt: new Date().toISOString()
      };
      translations[item.id] = translated;
    });

    if (missing.length) {
      await writeTranslations(cache);
    }

    sendJson(res, 200, { translations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not translate previews";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502;
    sendJson(res, status, { error: message });
  }
}

async function handleDatedHtmlIndex(res, source) {
  try {
    const response = await fetch(source.feedUrl || source.siteUrl, {
      headers: {
        "accept": "text/html, */*;q=0.8",
        "user-agent": "ReadLike2000/0.1"
      },
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      sendJson(res, response.status, { error: `Index responded with ${response.status}` });
      return;
    }

    const html = await response.text();
    const base = source.siteUrl || source.feedUrl;
    const origin = new URL(base).origin;
    const items = [...html.matchAll(/<a\b[^>]*>/gi)]
      .map(([tag]) => {
        const href = attr(tag, "href");
        const title = attr(tag, "aria-label") || attr(tag, "title");
        const dateMatch = href.match(/(20\d{2})-(\d{2})-(\d{2})/);

        if (!href || !title || !dateMatch) return null;

        const url = new URL(href, base).toString();
        if (!url.startsWith(origin)) return null;

        return {
          title,
          url,
          date: new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00Z`)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.date - a.date)
      .slice(0, 50);

    const itemXml = items
      .map((item) => `
        <item>
          <title>${escapeXml(item.title)}</title>
          <link>${escapeXml(item.url)}</link>
          <guid>${escapeXml(item.url)}</guid>
          <pubDate>${item.date.toUTCString()}</pubDate>
          <description>${escapeXml(`Материал из ${source.title}`)}</description>
        </item>`)
      .join("");

    const body = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>${escapeXml(source.title)}</title>
          <link>${escapeXml(source.siteUrl)}</link>
          <description>${escapeXml(`Индекс публикаций ${source.title}`)}</description>
          ${itemXml}
        </channel>
      </rss>`;

    res.writeHead(200, {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : "Could not fetch index" });
  }
}

function parseBritishLibraryDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}) ([A-Za-z]+) (20\d{2})$/);
  const months = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11
  };

  if (!match) return new Date();

  return new Date(Date.UTC(Number(match[3]), months[match[2].toLowerCase()] ?? 0, Number(match[1])));
}

async function handleBritishLibraryBlogIndex(res, source) {
  try {
    const response = await fetch(source.feedUrl || source.siteUrl, {
      headers: {
        "accept": "text/html, */*;q=0.8",
        "user-agent": "ReadLike2000/0.1"
      },
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      sendJson(res, response.status, { error: `British Library index responded with ${response.status}` });
      return;
    }

    const html = await response.text();
    const base = source.siteUrl || source.feedUrl;
    const itemPattern = /<a\b[^>]+href="(\/stories\/blogs\/posts\/[^"]+)"[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<span\b[^>]*ListCard[^>]*subtitle[^>]*>([\s\S]*?)<\/span>[\s\S]*?<p\b[^>]*ListCard[^>]*description[^>]*>([\s\S]*?)<\/p>/gi;
    const seen = new Set();
    const items = [];

    for (const match of html.matchAll(itemPattern)) {
      const url = new URL(decodeHtml(match[1]), base).toString();

      if (seen.has(url)) continue;
      seen.add(url);

      items.push({
        url,
        title: stripHtml(match[2]),
        date: parseBritishLibraryDate(stripHtml(match[3])),
        description: stripHtml(match[4])
      });
    }

    const itemXml = items
      .sort((a, b) => b.date - a.date)
      .map((item) => `
        <item>
          <title>${escapeXml(item.title)}</title>
          <link>${escapeXml(item.url)}</link>
          <guid>${escapeXml(item.url)}</guid>
          <pubDate>${item.date.toUTCString()}</pubDate>
          <description>${escapeXml(item.description)}</description>
        </item>`)
      .join("");

    const body = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>${escapeXml(source.title)}</title>
          <link>${escapeXml(source.siteUrl)}</link>
          <description>${escapeXml("Latest British Library blog posts")}</description>
          ${itemXml}
        </channel>
      </rss>`;

    res.writeHead(200, {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : "Could not fetch British Library blog index" });
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Bad request" });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/config") {
    handleConfig(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/sources") {
    await handleSources(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/feed") {
    await handleFeed(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/translations") {
    await handleTranslations(req, res);
    return;
  }

  try {
    const filePath = resolvePublicPath(requestUrl.pathname);
    const ext = path.extname(filePath);
    const body = await readFile(filePath);

    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Read Like 2000 is running at http://localhost:${port}`);
});
