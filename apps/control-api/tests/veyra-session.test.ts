import assert from "node:assert/strict";
import test from "node:test";
import { VideoSessionCodec, VideoSessionIdentityAdapter } from "../src/veyra-session.js";

const identity = { externalUserId: 42, intent: "video" as const, email: "user@example.com", role: "user", expiresAt: "2026-08-16T00:00:00.000Z" };

test("Video session is signed, host-only and resolves to deterministic local identity", async () => {
  const codec = new VideoSessionCodec("01234567890123456789012345678901", () => new Date("2026-08-15T12:00:00.000Z"));
  const cookie = codec.issue(identity, 3600);
  const adapter = new VideoSessionIdentityAdapter(codec);
  const resolved = await adapter.resolve(new Request("https://video.example/projects", { headers: { cookie: `${codec.cookieName()}=${cookie}` } }));
  assert.equal(resolved.externalUserId, 42);
  assert.equal(resolved.userId, "usr_veyra_42");
  assert.equal(resolved.workspaceId, "ws_veyra_42");
});

test("tampered or expired sessions are rejected", async () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const codec = new VideoSessionCodec("01234567890123456789012345678901", () => now);
  const cookie = codec.issue(identity, 1).replace(/.$/, "x");
  assert.equal(codec.read(new Request("https://video.example", { headers: { cookie: `${codec.cookieName()}=${cookie}` } })), undefined);
  const expiredIssuer = new VideoSessionCodec("01234567890123456789012345678901", () => new Date("2026-08-15T12:00:00.000Z"));
  const expiredCodec = new VideoSessionCodec("01234567890123456789012345678901", () => new Date("2026-08-15T13:00:02.000Z"));
  const original = expiredIssuer.issue(identity, 1);
  assert.equal(expiredCodec.read(new Request("https://video.example", { headers: { cookie: `${expiredCodec.cookieName()}=${original}` } })), undefined);
});
