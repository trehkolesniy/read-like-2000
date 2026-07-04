import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const sourcesFile = path.join(projectRoot, "data", "sources.json");

const BLOG_URLS = [
  "https://cassandrapages.com",
  "https://schwitzsplinters.blogspot.com",
  "https://handwritten.danieljanus.pl",
  "https://ciechanow.ski",
  "https://abuseofnotation.github.io",
  "https://blog.jim-nielsen.com",
  "https://shadycharacters.co.uk",
  "https://100r.co/",
  "https://tonsky.me",
  "https://onetwoxu.de",
  "https://blog.lostartpress.com",
  "https://paulstamatiou.com/",
  "https://sive.rs",
  "https://solar.lowtechmagazine.com",
  "https://macwright.com",
  "https://vas3k.blog",
  "https://ilyabirman.ru/meanwhile/",
  "https://sergeykorol.ru/blog/",
  "https://lepekhin.ru/blog/",
  "https://cassidoo.co",
  "https://dancohen.org",
  "https://navendu.me",
  "https://vhbelvadi.com",
  "https://rodneybrooks.com/blog/",
  "https://shiflett.org",
  "https://thekevinalexander.com",
  "https://pensiveibex.com",
  "https://noahie.xyz/blog/",
  "https://rasterweb.net/raster/",
  "https://melanie-richards.com",
  "https://www.benkuhn.net",
  "https://abhinavsarkar.net",
  "https://www.todepond.com",
  "https://robinrendle.com/",
  "https://jzhao.xyz",
  "https://brennan.day",
  "https://stefanbohacek.com",
  "https://slimemoldtimemold.com",
  "https://thebloggess.com",
  "https://a.wholelottanothing.org",
  "https://www.leadedsolder.com",
  "https://briankoberlein.com",
  "https://www.swiss-miss.com",
  "https://howtosavetheworld.ca",
  "https://www.cjchilvers.com",
  "https://blog.ayjay.org",
  "https://pedestrianobservations.com",
  "https://www.antipope.org/charlie/blog-static/",
  "https://ethanmarcotte.com",
  "https://blog.nuclearsecrecy.com",
  "https://analogoffice.net",
  "https://emilygorcenski.com",
  "https://jeremyfelt.com",
  "https://sgillies.net",
  "https://rotational.co.uk",
  "https://harper.blog",
  "https://aworkinglibrary.com",
  "https://ludic.mataroa.blog",
  "https://sethw.xyz",
  "https://blakewatson.com",
  "https://tracydurnell.com",
  "https://cogdogblog.com",
  "https://www.overcomingbias.com",
  "https://worksinprogress.co",
  "https://flowingdata.com",
  "https://eukaryotewritesblog.com",
  "https://dynomight.net",
  "https://gwern.net",
  "https://drewdevault.com",
  "https://nedbatchelder.com/blog",
  "https://www.brendangregg.com/blog/",
  "https://hypercritical.co",
  "https://manuelmoreale.com/interview/andy-baio",
  "https://kevquirk.com",
  "https://rachelandrew.co.uk",
  "https://www.sarasoueidan.com/blog/",
  "https://daverupert.com",
  "https://maggieappleton.com",
  "https://www.casualoptimist.com",
  "https://frankchimero.com/blog/",
  "https://interconnected.org/home/",
  "https://www.maproomblog.com",
  "https://www.presentandcorrect.com/blogs/blog",
  "https://www.futilitycloset.com",
  "https://bldgblog.com",
  "https://publicdomainreview.org",
  "https://pluralistic.net",
  "https://waxy.org",
  "https://kottke.org",
  "https://www.bl.uk/stories/blogs/"
];

const FEED_OVERRIDES = new Map([
  ["https://cassandrapages.com", "http://cassandrapages.com/feed/"],
  ["https://solar.lowtechmagazine.com", "https://solar.lowtechmagazine.com/posts/index.xml"],
  ["https://www.todepond.com", "https://www.todepond.com/feed/index.xml"],
  ["https://www.antipope.org/charlie/blog-static/", "http://www.antipope.org/charlie/blog-static/atom.xml"]
]);

const CUSTOM_SOURCES = new Map([
  [
    "https://handwritten.danieljanus.pl",
    {
      title: "handwritten.danieljanus.pl",
      siteUrl: "https://handwritten.danieljanus.pl/",
      feedUrl: "https://handwritten.danieljanus.pl/",
      parser: "dated-html-index"
    }
  ],
  [
    "https://www.bl.uk/stories/blogs/",
    {
      title: "British Library Blogs",
      siteUrl: "https://www.bl.uk/stories/blogs/",
      feedUrl: "https://www.bl.uk/stories/blogs/posts",
      parser: "british-library-blog-index"
    }
  ]
]);

const requestHeaders = {
  "accept": "text/html, application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  "user-agent": "ReadLike2000/0.1"
};

function sourceId(feedUrl) {
  return `source-${createHash("sha1").update(feedUrl).digest("hex").slice(0, 12)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanText(value = "") {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    const lower = code.toLowerCase();

    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return named[lower] || entity;
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: requestHeaders,
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    contentType: response.headers.get("content-type") || "",
    text
  };
}

function isFeed(document) {
  const head = document.text.slice(0, 2000).toLowerCase();
  const type = document.contentType.toLowerCase();

  return (
    type.includes("rss") ||
    type.includes("atom") ||
    type.includes("xml") ||
    /<(rss|feed)\b/.test(head)
  );
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"));
  return match ? match[1].replace(/^["']|["']$/g, "") : "";
}

function pageTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1] || "");
}

function feedTitle(xml) {
  const channelTitle = xml.match(/<channel[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  const rootTitle = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(channelTitle?.[1] || rootTitle?.[1] || "");
}

function alternateFeeds(html, baseUrl) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => {
      const rel = attr(tag, "rel").toLowerCase();
      const type = attr(tag, "type").toLowerCase();
      const href = decodeHtml(attr(tag, "href"));
      const title = attr(tag, "title");

      if (!href || !rel.split(/\s+/).includes("alternate")) return null;
      if (!/(rss|atom|xml)/.test(type) && !/(rss|atom|feed)/i.test(href + title)) return null;

      try {
        return {
          url: new URL(href, baseUrl).toString(),
          title
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return links
    .sort((a, b) => feedCandidateScore(b) - feedCandidateScore(a))
    .map((link) => link.url);
}

function feedCandidateScore(candidate) {
  const haystack = `${candidate.url} ${candidate.title || ""}`.toLowerCase();
  let score = 0;

  if (haystack.includes("feed")) score += 3;
  if (haystack.includes("rss")) score += 2;
  if (haystack.includes("atom")) score += 2;
  if (haystack.includes("comment")) score -= 10;
  if (haystack.includes("podcast")) score -= 4;

  return score;
}

function commonFeedCandidates(siteUrl) {
  const parsed = new URL(siteUrl);
  const origin = parsed.origin;
  const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  const pathBase = `${origin}${pathname}`;

  const candidates = [
    `${pathBase}feed/`,
    `${pathBase}feed`,
    `${pathBase}rss/`,
    `${pathBase}rss`,
    `${pathBase}rss.xml`,
    `${pathBase}atom.xml`,
    `${pathBase}feed.xml`,
    `${pathBase}feed/index.xml`,
    `${pathBase}index.xml`,
    `${origin}/feed/`,
    `${origin}/feed`,
    `${origin}/rss/`,
    `${origin}/rss`,
    `${origin}/rss.xml`,
    `${origin}/atom.xml`,
    `${origin}/feed.xml`,
    `${origin}/feed/index.xml`,
    `${origin}/index.xml`,
    `${origin}/blog/feed/`,
    `${origin}/blog/rss.xml`,
    `${origin}/blog/atom.xml`
  ];

  if (parsed.hostname.endsWith("blogspot.com")) {
    candidates.unshift(`${origin}/feeds/posts/default?alt=rss`);
  }

  if (pathname.includes("/blogs/")) {
    candidates.unshift(`${origin}${pathname.replace(/\/$/, "")}.atom`);
    candidates.unshift(`${origin}${pathname.replace(/\/$/, "")}.rss`);
  }

  return candidates;
}

async function validateFeed(candidateUrl) {
  try {
    const document = await fetchText(candidateUrl);
    if (!document.ok || !isFeed(document)) return null;

    return {
      feedUrl: document.url,
      title: feedTitle(document.text)
    };
  } catch {
    return null;
  }
}

async function discoverSource(siteUrl) {
  if (CUSTOM_SOURCES.has(siteUrl)) {
    return CUSTOM_SOURCES.get(siteUrl);
  }

  const overrideFeedUrl = FEED_OVERRIDES.get(siteUrl);
  if (overrideFeedUrl) {
    const feed = await validateFeed(overrideFeedUrl);

    if (!feed) {
      throw new Error(`Override feed could not be verified for ${siteUrl}`);
    }

    return {
      siteUrl,
      feedUrl: feed.feedUrl,
      title: feed.title || new URL(siteUrl).hostname.replace(/^www\./, "")
    };
  }

  const page = await fetchText(siteUrl);
  const site = page.url || siteUrl;

  if (page.ok && isFeed(page)) {
    return {
      siteUrl,
      feedUrl: site,
      title: feedTitle(page.text) || new URL(siteUrl).hostname.replace(/^www\./, "")
    };
  }

  const candidates = unique([
    ...alternateFeeds(page.text, site),
    ...commonFeedCandidates(site)
  ]);

  for (const candidate of candidates) {
    const feed = await validateFeed(candidate);

    if (feed) {
      return {
        siteUrl,
        feedUrl: feed.feedUrl,
        title: feed.title || pageTitle(page.text) || new URL(siteUrl).hostname.replace(/^www\./, "")
      };
    }
  }

  throw new Error(`No verified RSS/Atom feed found for ${siteUrl}`);
}

async function main() {
  const sources = [];
  const failures = [];

  for (const siteUrl of BLOG_URLS) {
    try {
      const source = await discoverSource(siteUrl);
      sources.push({
        id: sourceId(source.feedUrl),
        title: source.title,
        siteUrl: new URL(source.siteUrl).toString(),
        feedUrl: source.feedUrl,
        parser: source.parser || "feed",
        createdAt: new Date().toISOString()
      });
      console.log(`OK ${siteUrl} -> ${source.feedUrl}`);
    } catch (error) {
      failures.push({
        siteUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      console.log(`MISS ${siteUrl}`);
    }
  }

  await mkdir(path.dirname(sourcesFile), { recursive: true });
  await writeFile(sourcesFile, `${JSON.stringify({ sources }, null, 2)}\n`);

  console.log("");
  console.log(`Imported ${sources.length}/${BLOG_URLS.length} sources into ${sourcesFile}`);

  if (failures.length) {
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`- ${failure.siteUrl}: ${failure.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
