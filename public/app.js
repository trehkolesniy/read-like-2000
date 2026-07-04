const STORAGE_KEY = "read-like-2000-state";
const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;
const TRANSLATION_BATCH_SIZE = 12;
const AUTO_TRANSLATE_NEW_LIMIT = 80;

const initialState = {
  sources: [],
  posts: [],
  lastReadAt: 0
};

const elements = {
  sourceForm: document.querySelector("#sourceForm"),
  sourceTitle: document.querySelector("#sourceTitle"),
  sourceUrl: document.querySelector("#sourceUrl"),
  sourceList: document.querySelector("#sourceList"),
  refreshButton: document.querySelector("#refreshButton"),
  markReadButton: document.querySelector("#markReadButton"),
  feedMeta: document.querySelector("#feedMeta"),
  statusLine: document.querySelector("#statusLine"),
  feedList: document.querySelector("#feedList"),
  sourceTemplate: document.querySelector("#sourceTemplate"),
  postTemplate: document.querySelector("#postTemplate")
};

let state = loadState();
let translationObserver = null;
let translationTimer = null;
let translationRunning = false;
const translationQueue = new Set();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      ...initialState,
      posts: Array.isArray(saved.posts) ? saved.posts : [],
      lastReadAt: Number(saved.lastReadAt || 0)
    };
  } catch {
    return { ...initialState };
  }
}

function saveState() {
  const { posts, lastReadAt } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ posts, lastReadAt }));
}

function normalizeUrl(value) {
  return new URL(value.trim()).toString();
}

function postId(url, title) {
  return `post-${btoa(unescape(encodeURIComponent(`${url}:${title}`))).replace(/=+$/g, "")}`;
}

function compactText(value = "") {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return (doc.body.textContent || value).replace(/\s+/g, " ").trim();
}

function formatRelativeTime(dateValue) {
  const date = new Date(dateValue);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  const hours = Math.round(diff / 3600000);
  const days = Math.round(diff / 86400000);

  if (Number.isNaN(date.getTime())) return "";
  if (minutes < 2) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  if (hours < 24) return `${hours} ч`;
  if (days < 8) return `${days} д`;

  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  });
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function getSortedPosts() {
  return [...state.posts].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function render() {
  renderSources();
  renderPosts();
  saveState();
}

function renderSources() {
  elements.sourceList.replaceChildren();

  for (const source of state.sources) {
    const node = elements.sourceTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("strong").textContent = source.title;
    node.querySelector("span").textContent = source.feedUrl;
    node.querySelector("button").addEventListener("click", () => removeSource(source.id));
    elements.sourceList.append(node);
  }
}

function renderPosts() {
  const posts = getSortedPosts();
  const newCount = posts.filter(isNewPost).length;

  elements.feedMeta.textContent = `${posts.length} ${plural(posts.length, ["публикация", "публикации", "публикаций"])}, ${newCount} ${plural(newCount, ["новая", "новые", "новых"])}`;
  elements.feedList.replaceChildren();
  resetTranslationObserver();

  for (const [index, post] of posts.entries()) {
    const node = elements.postTemplate.content.firstElementChild.cloneNode(true);
    const isNew = isNewPost(post);
    const avatar = node.querySelector(".post-avatar");
    const sourceName = node.querySelector(".post-meta strong");
    const sourceKind = node.querySelector(".post-meta span");
    const time = node.querySelector("time");
    const title = node.querySelector(".post-title");
    const description = node.querySelector("p");

    node.classList.toggle("is-new", isNew);
    node.dataset.postId = post.id;
    avatar.textContent = (post.sourceTitle || "R").slice(0, 1);
    sourceName.textContent = post.sourceTitle || "Сохраненное";
    sourceKind.textContent = "блог";
    time.dateTime = post.publishedAt;
    time.textContent = formatRelativeTime(post.publishedAt);
    title.href = post.url;
    title.textContent = post.title;
    description.textContent = post.descriptionRu || post.description || "Описание не найдено.";

    elements.feedList.append(node);

    if (shouldTranslatePost(post)) {
      if (translationObserver) {
        translationObserver.observe(node);
      } else if (index < 20) {
        queueTranslation(post.id);
      }
    }
  }
}

function resetTranslationObserver() {
  if (translationObserver) {
    translationObserver.disconnect();
  }

  if (!("IntersectionObserver" in window)) {
    translationObserver = null;
    return;
  }

  translationObserver = new IntersectionObserver(handleTranslationIntersections, {
    rootMargin: "420px 0px",
    threshold: 0.01
  });
}

function handleTranslationIntersections(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;

    translationObserver.unobserve(entry.target);
    queueTranslation(entry.target.dataset.postId);
  }
}

function shouldTranslatePost(post) {
  return Boolean(post.description && !post.descriptionRu);
}

function queueTranslation(postId) {
  if (!postId) return;

  translationQueue.add(postId);

  if (translationTimer) return;

  translationTimer = window.setTimeout(() => {
    translationTimer = null;
    processTranslationQueue();
  }, 180);
}

async function processTranslationQueue() {
  if (translationRunning) return;

  translationRunning = true;

  try {
    while (translationQueue.size) {
      const ids = [...translationQueue].slice(0, TRANSLATION_BATCH_SIZE);
      ids.forEach((id) => translationQueue.delete(id));

      const items = ids
        .map((id) => {
          const post = state.posts.find((item) => item.id === id);
          return post && shouldTranslatePost(post) ? { id: post.id, text: post.description } : null;
        })
        .filter(Boolean);

      if (!items.length) continue;

      setStatus("Перевожу описания...");

      const response = await fetch("/api/translations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items })
      });

      if (!response.ok) {
        throw new Error("Translation failed");
      }

      const data = await response.json();
      const translations = data.translations || {};

      for (const post of state.posts) {
        if (translations[post.id]) {
          post.descriptionRu = translations[post.id];
          updateRenderedDescription(post.id, post.descriptionRu);
        }
      }

      saveState();
    }

    setStatus("Видимые описания переведены.");
  } catch {
    setStatus("Часть описаний пока осталась в оригинале.");
  } finally {
    translationRunning = false;

    if (translationQueue.size) {
      processTranslationQueue();
    }
  }
}

function updateRenderedDescription(postId, text) {
  const node = [...document.querySelectorAll(".post")].find((item) => item.dataset.postId === postId);

  if (node) {
    node.querySelector("p").textContent = text;
  }
}

function isNewPost(post) {
  const firstSeen = Date.parse(post.firstSeenAt || "");
  return firstSeen > state.lastReadAt && Date.now() - firstSeen < NEW_WINDOW_MS;
}

function plural(count, forms) {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

async function loadSources() {
  try {
    const response = await fetch("/api/sources");

    if (!response.ok) {
      throw new Error("Could not load sources");
    }

    const data = await response.json();
    state.sources = Array.isArray(data.sources) ? data.sources : [];
    render();
  } catch {
    setStatus("Не получилось загрузить список блогов.");
  }
}

async function removeSource(id) {
  const response = await fetch(`/api/sources?id=${encodeURIComponent(id)}`, { method: "DELETE" });

  if (!response.ok) {
    setStatus("Не получилось удалить блог.");
    return;
  }

  state.sources = state.sources.filter((source) => source.id !== id);
  state.posts = state.posts.filter((post) => post.sourceId !== id);
  setStatus("Блог удален из локального списка источников.");
  render();
}

async function addSource(title, rawFeedUrl) {
  const feedUrl = normalizeUrl(rawFeedUrl);
  const existing = state.sources.some((source) => source.feedUrl === feedUrl);

  if (existing) {
    setStatus("Этот блог уже есть в списке источников.");
    return;
  }

  const response = await fetch("/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: title.trim(),
      feedUrl
    })
  });

  if (!response.ok) {
    setStatus("Не получилось зарегистрировать блог как источник.");
    return;
  }

  const data = await response.json();
  const source = data.source;
  state.sources = [...state.sources.filter((item) => item.id !== source.id), source];
  elements.sourceForm.reset();
  setStatus(data.existing ? "Этот блог уже был в списке источников." : "Блог зарегистрирован. Обновляю только его фид...");
  render();
  const freshPosts = await fetchSource(source);
  render();
  queueFreshPostTranslations(freshPosts);
}

async function refreshFeeds() {
  if (!state.sources.length) {
    setStatus("Добавь RSS/Atom-блог слева, чтобы собрать ленту.");
    return;
  }

  elements.refreshButton.disabled = true;
  setStatus(`Обновляю источники: 0/${state.sources.length}`);

  const failures = [];
  const freshPosts = [];
  let completed = 0;

  await runLimited(state.sources, 6, async (source) => {
    try {
      const fresh = await fetchSource(source);
      freshPosts.push(...fresh);
    } catch {
      failures.push(source);
    } finally {
      completed += 1;
      setStatus(`Обновляю источники: ${completed}/${state.sources.length}`);
    }
  });

  elements.refreshButton.disabled = false;

  if (failures.length) {
    setStatus(`Готово, но ${failures.length} источн. не ответили.`);
  } else {
    setStatus("Лента обновлена.");
  }

  render();
  queueFreshPostTranslations(freshPosts);
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

async function fetchSource(source) {
  const response = await fetch(`/api/feed?id=${encodeURIComponent(source.id)}`);

  if (!response.ok) {
    throw new Error(`Could not load ${source.feedUrl}`);
  }

  const xml = await response.text();
  const posts = parseFeed(xml, source);
  return mergePosts(posts);
}

function parseFeed(xml, source) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  if (doc.querySelector("parsererror")) {
    throw new Error(`Could not parse ${source.feedUrl}`);
  }

  const rssItems = [...doc.querySelectorAll("item")].map((item) => ({
    title: text(item, "title") || "Без заголовка",
    url: text(item, "link") || text(item, "guid") || source.siteUrl || source.feedUrl,
    description: compactText(text(item, "description") || namespacedText(item, "content:encoded") || ""),
    publishedAt: text(item, "pubDate") || text(item, "published") || text(item, "updated")
  }));

  const atomItems = [...doc.querySelectorAll("entry")].map((entry) => ({
    title: text(entry, "title") || "Без заголовка",
    url: atomLink(entry) || text(entry, "id") || source.siteUrl || source.feedUrl,
    description: compactText(text(entry, "summary") || text(entry, "content") || ""),
    publishedAt: text(entry, "published") || text(entry, "updated")
  }));

  return [...rssItems, ...atomItems].map((post) => {
    const publishedAt = new Date(post.publishedAt);

    return {
      id: postId(post.url, post.title),
      sourceId: source.id,
      sourceTitle: source.title,
      title: compactText(post.title),
      url: absoluteUrl(post.url, source.siteUrl || source.feedUrl),
      description: post.description.slice(0, 260),
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date().toISOString() : publishedAt.toISOString(),
      firstSeenAt: new Date().toISOString(),
      isManual: false
    };
  });
}

function text(root, selector) {
  return root.querySelector(selector)?.textContent?.trim() || "";
}

function namespacedText(root, tagName) {
  return root.getElementsByTagName(tagName)[0]?.textContent?.trim() || "";
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return base;
  }
}

function atomLink(entry) {
  const alternate = entry.querySelector("link[rel='alternate']");
  const anyLink = entry.querySelector("link");
  return alternate?.getAttribute("href") || anyLink?.getAttribute("href") || "";
}

function mergePosts(posts) {
  const known = new Set(state.posts.map((post) => post.id));
  const freshPosts = posts.filter((post) => !known.has(post.id));

  state.posts = [...state.posts, ...freshPosts].slice(-600);
  return freshPosts;
}

function queueFreshPostTranslations(posts) {
  posts
    .filter(shouldTranslatePost)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, AUTO_TRANSLATE_NEW_LIMIT)
    .forEach((post) => queueTranslation(post.id));
}

elements.sourceForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    addSource(elements.sourceTitle.value, elements.sourceUrl.value).catch(() => {
      setStatus("Не получилось добавить источник.");
    });
  } catch {
    setStatus("Проверь URL источника.");
  }
});

elements.refreshButton.addEventListener("click", refreshFeeds);

elements.markReadButton.addEventListener("click", () => {
  state.lastReadAt = Date.now();
  setStatus("Все текущие публикации отмечены прочитанными.");
  render();
});

render();
loadSources();
