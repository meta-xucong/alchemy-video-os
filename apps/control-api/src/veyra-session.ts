import { createHmac, timingSafeEqual } from "node:crypto";
import { VeyraExternalIdentitySchema, type VeyraExternalIdentity } from "@alchemy-video/contracts";
import { createVeyraCurrentIdentity, type CurrentIdentity, type IdentityPort } from "./identity.js";

const COOKIE_NAME = "video_session";
const encode = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

export class VideoSessionCodec {
  constructor(private readonly secret: string, private readonly now: () => Date = () => new Date()) {
    if (secret.trim().length < 32) throw new Error("VIDEO_SESSION_SECRET must contain at least 32 characters.");
  }

  issue(identity: VeyraExternalIdentity, maxAgeSeconds = 8 * 60 * 60): string {
    const expiresAt = new Date(this.now().getTime() + maxAgeSeconds * 1000).toISOString();
    const payload = encode(JSON.stringify({ v: 1, externalUserId: identity.externalUserId, email: identity.email, role: identity.role, expiresAt }));
    return `v1.${payload}.${this.sign(payload)}`;
  }

  read(request: Request): VeyraExternalIdentity | undefined {
    const cookie = request.headers.get("cookie") ?? "";
    const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (!value) return undefined;
    const [version, payload, signature] = value.split(".");
    if (version !== "v1" || !payload || !signature) return undefined;
    const expected = this.sign(payload);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
    try {
      const { v: _version, ...parsed } = JSON.parse(decode(payload)) as Record<string, unknown>;
      const identity = VeyraExternalIdentitySchema.parse({ ...parsed, intent: "video" });
      return Date.parse(identity.expiresAt) > this.now().getTime() ? identity : undefined;
    } catch {
      return undefined;
    }
  }

  cookieName() { return COOKIE_NAME; }
  private sign(payload: string) { return encode(createHmac("sha256", this.secret).update(`v1.${payload}`).digest()); }
}

export class VideoSessionIdentityAdapter implements IdentityPort {
  constructor(private readonly codec: VideoSessionCodec) {}
  async resolve(request: Request): Promise<CurrentIdentity> {
    const identity = this.codec.read(request);
    if (!identity) throw new Error("Video session is missing or expired.");
    return createVeyraCurrentIdentity(identity);
  }
}
