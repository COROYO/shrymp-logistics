"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Camera-based scanning via the native `BarcodeDetector` API (Chromium/Android).
 * This is progressive enhancement — most warehouse work uses a USB/Bluetooth
 * keyboard-wedge scanner straight into the text input. When the API is missing
 * (Safari/Firefox), we show a hint and let staff use the hardware scanner.
 */

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const FORMATS = [
  "code_128",
  "ean_13",
  "ean_8",
  "code_39",
  "upc_a",
  "upc_e",
  "qr_code",
];

export function CameraScanner({
  onDetect,
  onError,
}: {
  onDetect: (code: string) => void;
  onError?: () => void;
}) {
  const t = useTranslations("scan");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);

    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let lastValue = "";
    let lastAt = 0;

    const detector = new Ctor({ formats: FORMATS });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        loop();
      } catch {
        setErr("camera_denied");
        onError?.();
      }
    }

    async function loop() {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const hit = codes[0]?.rawValue?.trim();
          const now = Date.now();
          // Debounce duplicate reads from consecutive frames.
          if (hit && (hit !== lastValue || now - lastAt > 1500)) {
            lastValue = hit;
            lastAt = now;
            onDetect(hit);
          }
        } catch {
          // transient detect errors are safe to ignore
        }
      }
      raf = requestAnimationFrame(loop);
    }

    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (supported === false) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-brand-navy/60">
        {t("cameraUnsupported")}
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        {t("cameraDenied")}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-brand-navy/20 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="mx-auto block max-h-72 w-full object-contain"
      />
    </div>
  );
}
