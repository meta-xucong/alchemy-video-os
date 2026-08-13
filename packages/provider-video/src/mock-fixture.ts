import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { getFfmpegBinaryPath } from "./media-validator.js";
import { VideoProviderProtocolError } from "./port.js";

const runFfmpeg = (binary: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new VideoProviderProtocolError("Mock fixture generation timed out.")));
    }, 15_000);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, { windowsHide: true });
    } catch {
      clearTimeout(timer);
      reject(new VideoProviderProtocolError("Bundled ffmpeg is not executable."));
      return;
    }
    child.on("error", () => finish(() => reject(new VideoProviderProtocolError("Bundled ffmpeg is not executable."))));
    child.on("close", (code) => finish(() => code === 0 ? resolve() : reject(new VideoProviderProtocolError(`Mock fixture generation failed with exit code ${code ?? "unknown"}.`))));
  });

export const createMockMp4Fixture = async () => {
  const ffmpegPath = getFfmpegBinaryPath();
  if (!ffmpegPath) {
    throw new VideoProviderProtocolError("Bundled ffmpeg is required for the local Mock provider.");
  }
  const directory = await mkdtemp(join(tmpdir(), "alchemy-video-c06-fixture-"));
  const fixturePath = join(directory, "mock-video.mp4");
  try {
    await runFfmpeg(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x224488:s=160x90:r=12",
      "-t", "1",
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-profile:v", "baseline",
      "-level", "3.0",
      "-movflags", "+faststart",
      fixturePath,
    ]);
    return await readFile(fixturePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
