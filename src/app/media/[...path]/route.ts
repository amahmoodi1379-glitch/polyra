import { mediaFile, mediaSize, mediaType, readMediaRange } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Stored files (src/server/storage.ts). Names never change content, so browsers keep them for a year.
 * Byte ranges are answered, which Safari needs to play and seek audio.
 */
async function serve(request: Request, ctx: RouteContext<"/media/[...path]">, body: boolean) {
  const file = mediaFile((await ctx.params).path);
  const size = file ? await mediaSize(file) : null;
  if (!file || size === null) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": mediaType(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  const status = range && (range[1] || range[2]) ? 206 : 200;
  if (!body || size === 0) return new Response(null, { status, headers });
  return new Response(new Uint8Array(await readMediaRange(file, start, end)), { status, headers });
}

export function GET(request: Request, ctx: RouteContext<"/media/[...path]">) {
  return serve(request, ctx, true);
}

export function HEAD(request: Request, ctx: RouteContext<"/media/[...path]">) {
  return serve(request, ctx, false);
}
