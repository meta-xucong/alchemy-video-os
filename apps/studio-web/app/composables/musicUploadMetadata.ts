// Platform upload boundary for the existing ConfirmAssetUpload.duration_ms.
// Reuses C06's loadedmetadata pattern; this is client-reported metadata, not
// a replacement for the Runtime's byte inspection or ffprobe validation.
type MusicMetadataEnvironment = {
  createAudio: () => HTMLAudioElement;
  createObjectURL: (file: Blob) => string;
  revokeObjectURL: (url: string) => void;
  setTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

const browserEnvironment: MusicMetadataEnvironment = {
  createAudio: () => document.createElement("audio"),
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timer) => clearTimeout(timer),
};

export const readMusicDurationMs = (
  file: Blob,
  environment: MusicMetadataEnvironment = browserEnvironment,
): Promise<number> => new Promise((resolve, reject) => {
  const audio = environment.createAudio();
  const url = environment.createObjectURL(file);
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (durationMs?: number) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) environment.clearTimeout(timer);
    audio.removeEventListener("loadedmetadata", loaded);
    audio.removeEventListener("error", failed);
    let cleanupFailed = false;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      cleanupFailed = true;
    } finally {
      environment.revokeObjectURL(url);
    }
    if (durationMs === undefined || cleanupFailed) reject(new Error("无法读取音乐时长，请选择可正常播放的音乐文件。"));
    else resolve(durationMs);
  };
  const loaded = () => {
    const seconds = audio.duration;
    const durationMs = Math.round(seconds * 1_000);
    // assets.duration_ms is a PostgreSQL integer; do not forward a value
    // outside that existing storage representation.
    finish(Number.isFinite(seconds) && seconds > 0 && Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= 2_147_483_647
      ? durationMs
      : undefined);
  };
  const failed = () => finish();
  audio.addEventListener("loadedmetadata", loaded);
  audio.addEventListener("error", failed);
  timer = environment.setTimeout(failed, 10_000);
  try {
    audio.preload = "metadata";
    audio.src = url;
    audio.load();
  } catch {
    failed();
  }
});
