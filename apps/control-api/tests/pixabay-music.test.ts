import assert from "node:assert/strict";
import test from "node:test";
import { HttpPixabayMusicClient, PixabayMusicError, PIXABAY_MAX_AUDIO_BYTES } from "../src/pixabay-music.js";

test("Pixabay loopback client transports bytes and metadata without exposing provider URL", async () => {
  let request = "";
  const client = new HttpPixabayMusicClient({ runtimeUrl: "http://127.0.0.1:3433/", token: "t", fetcher: async (u) => { request = String(u); return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg", "x-pixabay-track-title-base64": Buffer.from("fixture").toString("base64url"), "x-pixabay-rating": "4.75", "x-pixabay-download-count": "321" } }); } });
  const result = await client.execute({ query: "ambient" });
  assert.equal(request, "http://127.0.0.1:3433/internal/v1/media/pixabay-music");
  assert.equal(result.track.title, "fixture");
  assert.equal(result.track.rating, 4.75);
  assert.equal(result.track.download_count, 321);
  assert.deepEqual([...result.bytes], [1]);
});

test("Pixabay loopback client rejects unsafe runtime URLs", () => {
  for (const runtimeUrl of [
    "http://user:pass@127.0.0.1:3433/",
    "http://127.0.0.1:3433/?q=x",
    "http://127.0.0.1:3433/#fragment",
  ]) {
    assert.throws(() => new HttpPixabayMusicClient({ runtimeUrl, token: "t" }));
  }
});

test("Pixabay loopback client maps source no-results and other non-2xx failures", async () => {
  const noResultsClient = new HttpPixabayMusicClient({
    runtimeUrl: "http://127.0.0.1:3433/",
    token: "t",
    fetcher: async () => new Response(JSON.stringify({ error: { code: "MEDIA_RENDER_FAILED" } }), { status: 400, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(
    () => noResultsClient.execute({ query: "x" }),
    (error: unknown) => error instanceof PixabayMusicError && error.kind === "NO_RESULTS" && !error.retryable,
  );

  const unavailableClient = new HttpPixabayMusicClient({
    runtimeUrl: "http://127.0.0.1:3433/",
    token: "t",
    fetcher: async () => new Response("upstream unavailable", { status: 503, headers: { "content-type": "text/plain" } }),
  });
  await assert.rejects(
    () => unavailableClient.execute({ query: "x" }),
    (error: unknown) => error instanceof PixabayMusicError && error.kind === "UNAVAILABLE" && error.retryable,
  );
});

test("Pixabay loopback client aborts a timed-out Runtime request", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let signal: AbortSignal | undefined;
  globalThis.setTimeout = ((handler: (...args: any[]) => void, ...args: any[]) => originalSetTimeout(handler, 0, ...args)) as typeof setTimeout;
  try {
    const client = new HttpPixabayMusicClient({
      runtimeUrl: "http://127.0.0.1:3433/",
      token: "t",
      fetcher: async (_input, init) => {
        signal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    });
    await assert.rejects(
      () => client.execute({ query: "x" }),
      (error: unknown) => error instanceof PixabayMusicError && error.kind === "UNAVAILABLE",
    );
    assert.equal(signal?.aborted, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("Pixabay loopback client rejects non-audio MIME and oversized Content-Length before reading bytes", async () => {
  const mimeClient = new HttpPixabayMusicClient({
    runtimeUrl: "http://127.0.0.1:3433/",
    token: "t",
    fetcher: async () => new Response("not audio", { status: 200, headers: { "content-type": "text/html" } }),
  });
  await assert.rejects(
    () => mimeClient.execute({ query: "x" }),
    (error: unknown) => error instanceof PixabayMusicError && error.kind === "INVALID" && !error.retryable,
  );

  let bodyRead = false;
  const oversizedResponse = {
    ok: true,
    headers: new Headers({
      "content-type": "audio/mpeg",
      "content-length": String(PIXABAY_MAX_AUDIO_BYTES + 1),
    }),
    arrayBuffer: async () => {
      bodyRead = true;
      return new Uint8Array([1]).buffer;
    },
  } as unknown as Response;
  const oversizedClient = new HttpPixabayMusicClient({
    runtimeUrl: "http://127.0.0.1:3433/",
    token: "t",
    fetcher: async () => oversizedResponse,
  });
  await assert.rejects(
    () => oversizedClient.execute({ query: "x" }),
    (error: unknown) => error instanceof PixabayMusicError && error.kind === "INVALID" && !error.retryable,
  );
  assert.equal(bodyRead, false);
});

test("Pixabay loopback client keeps malformed numeric and metadata headers fail-closed", async () => {
  const client = new HttpPixabayMusicClient({
    runtimeUrl: "http://127.0.0.1:3433/",
    token: "t",
    fetcher: async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "x-pixabay-track-title-base64": "%",
        "x-pixabay-duration": "NaN",
        "x-pixabay-results-found": "Infinity",
        "x-pixabay-results-after-filter": "not-a-number",
      },
    }),
  });
  await assert.rejects(() => client.execute({ query: "x" }), (error: unknown) => error instanceof PixabayMusicError && error.kind === "INVALID" && !error.retryable);
});
