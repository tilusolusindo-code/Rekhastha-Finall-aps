import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import { CustomJob, paymentUnits } from "@/types/custom-job";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/map-config";

function MapFlyController({
  target,
  locationReady,
  userLat,
  userLng,
}: {
  target: [number, number] | null;
  locationReady: boolean;
  userLat: number;
  userLng: number;
}) {
  const map = useMap();
  const centeredOnUser = useRef(false);
  useEffect(() => {
    if (target) map.flyTo(target, 15, { duration: 1.2 });
  }, [target, map]);
  useEffect(() => {
    if (!locationReady || centeredOnUser.current) return;
    centeredOnUser.current = true;
    map.flyTo([userLat, userLng], 15, { duration: 1.2 });
  }, [locationReady, userLat, userLng, map]);
  return null;
}

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const createUserIcon = (active = true) =>
  L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center">
        ${active ? `
        <div class="radar-ring" style="position:absolute;inset:0;border-radius:50%;border:2px solid #065F46;animation:radarPulse 2s ease-out infinite;opacity:0.6"></div>
        <div class="radar-ring" style="position:absolute;inset:0;border-radius:50%;border:2px solid #065F46;animation:radarPulse 2s ease-out 0.7s infinite;opacity:0.4"></div>
        <div class="radar-ring" style="position:absolute;inset:0;border-radius:50%;border:2px solid #065F46;animation:radarPulse 2s ease-out 1.4s infinite;opacity:0.2"></div>
        ` : ``}
        <div style="width:16px;height:16px;border-radius:50%;background:${active ? "#065F46" : "#9CA3AF"};border:3px solid white;box-shadow:0 2px 8px rgba(6,95,70,0.5);z-index:1;position:relative"></div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

const createJobIcon = () =>
  L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:6px;background:#047857;border:3px solid white;box-shadow:0 2px 10px rgba(4,120,87,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:15px;font-weight:900;line-height:1">+</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

// Live-broadcast gig: pulsing green pin injected in real time by the central server.
const createBroadcastIcon = () =>
  L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center">
        <div style="position:absolute;inset:0;border-radius:50%;background:#10B981;opacity:0.25;animation:radarPulse 1.8s ease-out infinite"></div>
        <div style="position:absolute;inset:0;border-radius:50%;background:#10B981;opacity:0.2;animation:radarPulse 1.8s ease-out 0.9s infinite"></div>
        <div style="width:26px;height:26px;border-radius:50%;background:#059669;border:3px solid white;box-shadow:0 2px 12px rgba(5,150,105,0.6);display:flex;align-items:center;justify-content:center;color:white;font-size:13px;line-height:1;z-index:1;position:relative">⚡</div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

const createMidpointIcon = (text: string) =>
  L.divIcon({
    className: "",
    html: `<div style="background:#065F46;color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.25)">${text}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

interface WorkerMapProps {
  userLat: number;
  userLng: number;
  locationReady: boolean;
  customJobs: CustomJob[];
  broadcastGigs?: CustomJob[];
  selectedJob: CustomJob | null;
  onJobClick: (job: CustomJob) => void;
  radarActive?: boolean;
  flyTarget?: [number, number] | null;
}

export default function WorkerMap({
  userLat,
  userLng,
  locationReady,
  customJobs,
  broadcastGigs = [],
  selectedJob,
  onJobClick,
  radarActive = true,
  flyTarget = null,
}: WorkerMapProps) {
  const distanceKm = selectedJob && locationReady
    ? haversineKm(userLat, userLng, selectedJob.lat, selectedJob.lng)
    : null;
  const distanceText = distanceKm
    ? `${distanceKm.toFixed(1)} KM · Est. ${Math.round(distanceKm * 4)} menit berkendara`
    : null;

  const midLat = selectedJob ? (userLat + selectedJob.lat) / 2 : 0;
  const midLng = selectedJob ? (userLng + selectedJob.lng) / 2 : 0;

  return (
    <div style={{ height: "100%", width: "100%", position: "absolute", inset: 0, zIndex: 0 }}>
      <MapContainer
        center={[userLat, userLng]}
        zoom={locationReady ? 13 : 4}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <TileLayer
          attribution={MAP_ATTRIBUTION}
          url={MAP_TILE_URL}
        />
        <MapFlyController target={flyTarget} locationReady={locationReady} userLat={userLat} userLng={userLng} />

        {/* User location (pulsing) */}
        {locationReady && (
          <Marker position={[userLat, userLng]} icon={createUserIcon(radarActive)}>
            <Tooltip permanent direction="top" offset={[0, -22]} className="!bg-primary !text-white !text-[10px] !font-semibold !border-0 !rounded-lg !shadow-lg">
              Lokasi Saya
            </Tooltip>
          </Marker>
        )}

        {/* Custom job pins */}
        {customJobs.map((job) => (
          <Marker
            key={job.id}
            position={[job.lat, job.lng]}
            icon={createJobIcon()}
            eventHandlers={{ click: () => onJobClick(job) }}
          >
            <Tooltip direction="top" offset={[0, -14]} className="!bg-emerald-800 !text-white !text-[10px] !font-semibold !border-0 !rounded-lg !shadow-lg">
              {job.posisi}
            </Tooltip>
          </Marker>
        ))}

        {/* Live-broadcast gig pins (pulsing green, pushed by central server) */}
        {broadcastGigs.map((gig) => (
          <Marker
            key={`gig-${gig.id}`}
            position={[gig.lat, gig.lng]}
            icon={createBroadcastIcon()}
            eventHandlers={{ click: () => onJobClick(gig) }}
          >
            <Tooltip direction="top" offset={[0, -20]} className="!bg-emerald-600 !text-white !text-[10px] !font-semibold !border-0 !rounded-lg !shadow-lg">
              ⚡ Mencari: {gig.posisi} | Upah: Rp {gig.nominal.toLocaleString("id-ID")} / {paymentUnits[gig.pembayaran]}
            </Tooltip>
          </Marker>
        ))}

        {/* Polyline to selected job */}
        {selectedJob && locationReady && (
          <>
            <Polyline
              positions={[
                [userLat, userLng],
                [selectedJob.lat, selectedJob.lng],
              ]}
              pathOptions={{
                color: "#065F46",
                dashArray: "10 7",
                weight: 2.5,
                opacity: 0.85,
              }}
            />
            {distanceText && (
              <Marker
                position={[midLat, midLng]}
                icon={createMidpointIcon(distanceText)}
              />
            )}
          </>
        )}
      </MapContainer>

      {!locationReady && (
        <div className="absolute top-3 left-3 right-3 z-[1000] rounded-xl bg-white/95 px-3 py-2 text-center text-xs font-semibold text-gray-700 shadow">
          Aktifkan akses lokasi agar peta menampilkan lowongan terdekat dengan benar.
        </div>
      )}

      <style>{`
        @keyframes radarPulse {
          0%   { transform: scale(0.7); opacity: 0.8; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
