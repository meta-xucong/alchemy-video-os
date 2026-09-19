import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

import { VideoProviderProtocolError } from "./port.js";

const require = createRequire(import.meta.url);

type StaticBinary = { path?: unknown };

const staticPath = (packageName: string) => {
  const value = require(packageName) as StaticBinary | string | null;
  if (typeof value === "string") return value;
  return typeof value?.path === "string" ? value.path : undefined;
};

const run = (binary: string, args: string[], timeoutMs = 15_000) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new VideoProviderProtocolError("Bundled media tool timed out.")));
    }, timeoutMs);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      clearTimeout(timer);
      reject(new VideoProviderProtocolError("Bundled media tool is not executable."));
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", () => finish(() => reject(new VideoProviderProtocolError("Bundled media tool is not executable."))));
    child.on("close", (code) => finish(() => {
      if (code !== 0) {
        reject(new VideoProviderProtocolError(`Bundled media tool failed with exit code ${code ?? "unknown"}.`));
        return;
      }
      resolve({ stdout, stderr });
    }));
  });

export const getFfmpegBinaryPath = () => staticPath("ffmpeg-static");
export const getFfprobeBinaryPath = () => staticPath("ffprobe-static");

export const verifyBundledMediaTools = async () => {
  const [ffmpegPath, ffprobePath] = [getFfmpegBinaryPath(), getFfprobeBinaryPath()];
  if (!ffmpegPath || !ffprobePath) {
    throw new VideoProviderProtocolError("Bundled ffmpeg and ffprobe are required for the local Mock provider.");
  }
  await Promise.all([run(ffmpegPath, ["-version"]), run(ffprobePath, ["-version"])]);
  return { ffmpegPath, ffprobePath };
};

export type ValidatedVideo = {
  mimeType: "video/mp4";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  durationMs: number;
};

export const validateMp4Bytes = async (bytes: Uint8Array, mimeType: string): Promise<ValidatedVideo> => {
  if (mimeType.toLowerCase() !== "video/mp4") {
    throw new VideoProviderProtocolError("Downloaded media MIME type is not video/mp4.");
  }
  if (bytes.byteLength === 0) {
    throw new VideoProviderProtocolError("Downloaded media is empty.");
  }
  const ffprobePath = getFfprobeBinaryPath();
  if (!ffprobePath) {
    throw new VideoProviderProtocolError("Bundled ffprobe is required for video validation.");
  }
  const directory = await mkdtemp(join(tmpdir(), "alchemy-video-c06-"));
  const videoPath = join(directory, "download.mp4");
  try {
    await writeFile(videoPath, bytes);
    const output = await run(ffprobePath, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_type,width,height,duration",
      "-of", "json",
      videoPath,
    ]);
    const parsed = JSON.parse(output.stdout) as { streams?: Array<{ codec_type?: unknown; width?: unknown; height?: unknown; duration?: unknown }> };
    const stream = parsed.streams?.[0];
    const width = typeof stream?.width === "number" ? stream.width : Number(stream?.width);
    const height = typeof stream?.height === "number" ? stream.height : Number(stream?.height);
    const durationSeconds = typeof stream?.duration === "number" ? stream.duration : Number(stream?.duration);
    if (stream?.codec_type !== "video" || !Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new VideoProviderProtocolError("ffprobe did not report a readable video stream.");
    }
    return {
      mimeType: "video/mp4",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width,
      height,
      durationMs: Math.round(durationSeconds * 1000),
    };
  } catch (error: unknown) {
    if (error instanceof VideoProviderProtocolError) throw error;
    throw new VideoProviderProtocolError("ffprobe could not validate the downloaded MP4.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
