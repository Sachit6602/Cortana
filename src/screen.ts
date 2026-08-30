// Screen capture, then hand the image to the agent.
//
// In the Electron shell we use desktopCapturer via preload — no share-picker
// prompt, which matters for something you summon and dismiss in two seconds.
// In a plain browser we fall back to getDisplayMedia, which always prompts.

declare global {
  interface Window {
    cortana?: {
      isDesktop: boolean;
      captureScreen: () => Promise<string>;
      resize?: (height: number) => void;
      hide?: () => void;
      setPinned?: (v: boolean) => void;
      openFull?: () => void;
      onPinned?: (fn: (v: boolean) => void) => () => void;
      setRecording?: (v: boolean) => void;
      onSummon?: (fn: () => void) => () => void;
      onStopSend?: (fn: () => void) => () => void;
    };
  }
}

export const isDesktop = (): boolean => Boolean(window.cortana?.isDesktop);

async function captureViaBrowser(): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  try {
    const track = stream.getVideoTracks()[0];
    const { width = 1920, height = 1080 } = track.getSettings();

    // ImageCapture isn't in Safari/Firefox; draw a frame instead — works everywhere.
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    video.pause();

    return canvas.toDataURL("image/png");
  } finally {
    // Always release, or the browser keeps showing "sharing your screen".
    stream.getTracks().forEach((t) => t.stop());
  }
}

export async function captureScreen(): Promise<string> {
  return window.cortana?.captureScreen
    ? await window.cortana.captureScreen()
    : await captureViaBrowser();
}

/** Upload to Hermes; returns the server-side path to reference in a prompt. */
export async function uploadImage(dataUrl: string): Promise<string> {
  const res = await fetch("/api/chat/image-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl, filename: `screen-${Date.now()}.png` }),
  });
  if (!res.ok) throw new Error(`image upload failed: HTTP ${res.status}`);

  const j = (await res.json()) as { path?: string };
  if (!j.path) throw new Error("upload returned no path");
  return j.path;
}
