/**
 * The service worker (PRD §15.6 «PWA»): the app's own static files and the session's sound files are
 * kept on the phone, so a weak connection does not stop a session's audio. Pages and answers always go
 * to the server; there is no offline mode. Served from the site root so its scope is the whole app.
 */

/** Sound files kept at most; the oldest go first. */
const MEDIA_MAX = 400;
/** Files fetched ahead from one session. */
const PREFETCH_MAX = 120;

const source = `
const STATIC = "polyra-static-v1";
const MEDIA = "polyra-media-v1";
const MEDIA_MAX = ${MEDIA_MAX};
const PREFETCH_MAX = ${PREFETCH_MAX};

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== STATIC && key !== MEDIA) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim() {
  const cache = await caches.open(MEDIA);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_MAX; i++) await cache.delete(keys[i]);
}

async function staticFile(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200) await cache.put(request, response.clone());
  return response;
}

/** The whole file, from the phone or once from the server. */
async function wholeMedia(url) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(url);
  if (hit) return hit;
  const response = await fetch(url, { credentials: "same-origin" });
  if (response.ok && response.status === 200) {
    await cache.put(url, response.clone());
    trim();
  }
  return response;
}

/** A sound file; a byte range (Safari asks for one) is cut from the kept file. */
async function media(request) {
  let whole;
  try {
    whole = await wholeMedia(request.url);
  } catch {
    return fetch(request);
  }
  const range = /^bytes=(\\d*)-(\\d*)$/.exec(request.headers.get("range") || "");
  if (!range || (!range[1] && !range[2]) || whole.status !== 200) return whole;
  const blob = await whole.blob();
  const size = blob.size;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": whole.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) event.respondWith(staticFile(request));
  else if (url.pathname.startsWith("/media/")) event.respondWith(media(request));
});

/** The session's sound files, fetched ahead while the connection is there. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "media" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((url) => typeof url === "string" && url.startsWith("/media/")).slice(0, PREFETCH_MAX);
  event.waitUntil(
    (async () => {
      for (const url of urls) {
        try {
          await wholeMedia(new URL(url, self.location.origin).href);
        } catch {
          return;
        }
      }
    })(),
  );
});
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(source, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // A new version is picked up on the next visit.
      "Cache-Control": "no-cache",
    },
  });
}
