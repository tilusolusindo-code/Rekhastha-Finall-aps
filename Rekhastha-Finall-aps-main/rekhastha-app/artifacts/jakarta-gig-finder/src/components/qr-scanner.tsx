import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, Camera, CameraOff, FlipHorizontal } from "lucide-react";

interface QrScannerProps {
  onScan: (text: string) => void;
  onError?: (message: string) => void;
}

let scannerSeq = 0;

/**
 * Live-camera QR scanner (html5-qrcode).
 *
 * Features:
 * - Starts with the rear camera (facingMode: "environment") for QR scanning.
 * - Front/back toggle button lets the user switch cameras at any time.
 * - Contextual CSS mirroring:
 *     Front camera → scaleX(-1) so text looks natural for the user.
 *     Rear  camera → no transform, ensuring QR codes scan correctly.
 * - Gracefully surfaces a friendly error if camera access is denied.
 */
export default function QrScanner({ onScan, onError }: QrScannerProps) {
  const [elementId] = useState(() => `qr-scanner-${++scannerSeq}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const scannedRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [camError, setCamError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [toggling, setToggling] = useState(false);

  const isFront = facingMode === "user";

  const handleToggle = useCallback(async () => {
    setToggling(true);
    const scanner = scannerRef.current;
    try {
      await startPromiseRef.current;
    } catch {
      // The effect surfaces camera startup errors in camError.
    }
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // It may not have reached the scanning state yet.
      }
      try {
        scanner.clear();
      } catch {
        // The next camera instance will own the viewport.
      }
    }
    scannerRef.current = null;
    setFacingMode(prev => prev === "environment" ? "user" : "environment");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCamError(null);
    setToggling(false);

    const scanner = new Html5Qrcode(elementId, { verbose: false });
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        let cameras: Awaited<ReturnType<typeof Html5Qrcode.getCameras>> = [];
        try {
          cameras = await Html5Qrcode.getCameras();
        } catch {
          // Let start() request camera permission using facingMode as a fallback.
        }
        if (cancelled) return;
        const preferredLabel = facingMode === "environment"
          ? /back|rear|environment|world/i
          : /front|user|facetime/i;
        const camera = cameras.find((item) => preferredLabel.test(item.label))
          ?? undefined;
        await scanner.start(
          camera?.id ?? { facingMode: { ideal: facingMode } },
          {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.78);
              return { width: size, height: size };
            },
          },
          (decodedText: string) => {
            if (scannedRef.current) return;
            scannedRef.current = true;
            onScanRef.current(decodedText);
          },
          () => {
            /* per-frame decode miss — expected, ignore */
          },
        );
        if (!cancelled) setToggling(false);
      } catch {
        if (cancelled) return;
        const msg =
          "Kamera tidak dapat diakses. Pastikan Anda mengizinkan akses kamera di browser, lalu coba lagi.";
        setCamError(msg);
        setToggling(false);
        onErrorRef.current?.(msg);
      } finally {
        startPromiseRef.current = null;
      }
    };
    const starting = startScanner();
    startPromiseRef.current = starting;

    return () => {
      cancelled = true;
      const s = scanner;
      void (async () => {
        try {
          await starting;
        } catch {
          // Startup errors are shown above.
        }
        try {
          await s.stop();
        } catch {
          // Already stopped or never started.
        }
        try {
          s.clear();
        } catch {
          // The scanner may already have cleared itself.
        }
      })();
    };
  }, [elementId, facingMode]);

  return (
    <div className="space-y-2">
      <div className="relative">
        {/* Video viewport — mirror only for front camera */}
        <div
          id={elementId}
          data-testid="qr-scanner-viewport"
          className="w-full overflow-hidden rounded-2xl bg-black [&_video]:rounded-2xl"
          style={{
            minHeight: 220,
          }}
        >
          <style>{`
            #${elementId} video {
              transform: ${isFront ? "scaleX(-1)" : "none"};
              transition: transform 0.15s ease;
            }
          `}</style>
        </div>

        {/* Emerald corner bracket overlay */}
        {!camError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-56 w-56 max-w-[80%]">
              <div className="absolute -top-1 -left-1 h-7 w-7 rounded-tl-lg border-t-4 border-l-4 border-emerald-400" />
              <div className="absolute -top-1 -right-1 h-7 w-7 rounded-tr-lg border-t-4 border-r-4 border-emerald-400" />
              <div className="absolute -bottom-1 -left-1 h-7 w-7 rounded-bl-lg border-b-4 border-l-4 border-emerald-400" />
              <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-br-lg border-b-4 border-r-4 border-emerald-400" />
            </div>
          </div>
        )}

        {/* Camera toggle button — bottom-right of viewport */}
        {!camError && (
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={isFront ? "Ganti ke kamera belakang" : "Ganti ke kamera depan"}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-white backdrop-blur-sm transition-opacity hover:bg-black/80 disabled:opacity-50"
          >
            <FlipHorizontal className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">
              {isFront ? "Belakang" : "Depan"}
            </span>
          </button>
        )}

        {/* Camera label badge — top-left */}
        {!camError && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-white backdrop-blur-sm">
            {isFront ? (
              <Camera className="h-3 w-3" />
            ) : (
              <CameraOff className="h-3 w-3 opacity-70" />
            )}
            <span className="text-[10px] font-medium">
              {isFront ? "Kamera Depan" : "Kamera Belakang"}
            </span>
          </div>
        )}
      </div>

      {camError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-xs leading-relaxed text-red-700">{camError}</p>
        </div>
      )}
    </div>
  );
}
