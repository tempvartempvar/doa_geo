/**
 * globe3d.js — interactive 3-D Earth for the TDOA/FDOA lessons (three.js wrapper).
 *
 * Everything is specified in ECEF metres (Earth-centred Earth-fixed, WGS-84):
 *   +X through lat 0 / lon 0, +Y through lon 90°E, +Z through the north pole.
 * Callers never touch three.js. three.js is loaded lazily with dynamic import()
 * inside createGlobe(), through the host page's importmap:
 *   "three"         → ./vendor/three/build/three.module.js   (three.js 0.160.0, vendored)
 *   "three/addons/" → ./vendor/three/examples/jsm/
 * If it cannot be loaded (vendor/ missing, or no WebGL), createGlobe() renders a small
 * notice in the container and rejects with an Error; the rest of the app is unaffected.
 *
 * Usage
 * -----
 *   import { createGlobe, geodeticToEcef } from '../ui/globe3d.js';
 *
 *   const globe = await createGlobe(containerEl, {
 *     height: 480,           // CSS px; width follows the container (ResizeObserver)
 *     background: null,      // CSS colour; null → CSS var --surface-2 (fallback: transparent)
 *     showContinents: true,  // schematic coastlines
 *   });
 *   globe.setEmitter({ ecef: geodeticToEcef(39, -77, 0), label: 'Emitter', color: '--emitter' });
 *   globe.setEstimate({ ecef: estEcef, label: 'Estimate', color: '#e33' });   // null hides
 *   globe.setSatellites([{ id: 'A', ecef: [x, y, z], velEcef: [vx, vy, vz], label: 'A', color: '--collector-a' }]);
 *   globe.setPolylines('los', [{ points: [[x, y, z], ...], color, width: 2, dashed: false, opacity: 1, closed: false }]);
 *   globe.setMesh('hyp-AB', { positions, indices, color, opacity: 0.25, doubleSided: true, wireframe: false });
 *   globe.setEllipsoid('cep', { center, axes: [a, b, c], color, opacity: 0.35, scale: 1 });
 *                          // axes = three semi-axis VECTORS in ECEF metres (e.g. eigvec * sqrt(eigval) * k)
 *   globe.setLabelsVisible(true);
 *   globe.lookAt({ ecef, distance: 3.0e6, animate: true });
 *   globe.fit([p1, p2, ...], { animate: true });
 *   globe.resetView();
 *   globe.onFrame = (dtSeconds) => {};   // called on every rendered frame; call requestRender() in it to animate
 *   globe.requestRender();               // render on demand (no rAF loop while idle)
 *   globe.dispose();
 *
 * Notes
 * - Colours: any CSS colour string, or a custom-property name such as '--collector-a'
 *   (or 'var(--collector-a)'), resolved with getComputedStyle on the container.
 *   Theme colours read: --globe-ocean, --globe-land-line, --globe-grid, --text, --surface-2
 *   (re-read on prefers-color-scheme change and on class/data-theme/style changes of <html>/<body>).
 * - setPolylines / setMesh / setEllipsoid keep named groups: the same key replaces, [] / null removes.
 *   Points within ~20 km of the ellipsoid surface are lifted slightly and long surface segments are
 *   densified along great circles so lines hug the globe without z-fighting.
 * - All setters may be called in any order, repeatedly (e.g. 60×/s); replaced GPU resources are disposed.
 *
 * Pure helpers (no WebGL; usable in Node): geodeticToEcef(latDeg, lonDeg, h), greatCirclePoints(lat1, lon1, lat2, lon2, n).
 */

// ─────────────────────────────── WGS-84 helpers ───────────────────────────────

const D2R = Math.PI / 180;
const WGS84_A = 6378137;
const WGS84_B = 6356752.314245;
const E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

/** WGS-84 geodetic (deg, deg, m) → ECEF [x, y, z] metres. */
export function geodeticToEcef(latDeg, lonDeg, hMeters = 0) {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const s = Math.sin(lat), c = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - E2 * s * s);
  const h = hMeters || 0;
  return [(N + h) * c * Math.cos(lon), (N + h) * c * Math.sin(lon), (N * (1 - E2) + h) * s];
}

function nvec(latDeg, lonDeg) {
  const lat = latDeg * D2R, lon = lonDeg * D2R, c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

function nvecToLatLonDeg(v) {
  return [Math.atan2(v[2], Math.hypot(v[0], v[1])) / D2R, Math.atan2(v[1], v[0]) / D2R];
}

/**
 * n points (inclusive of both ends, n ≥ 2) along the great circle between two geodetic
 * positions, returned as ECEF metres on the ellipsoid surface (h = 0). Interpolation is done
 * on the surface-normal (n-vector) sphere, so endpoints are exact.
 */
export function greatCirclePoints(lat1, lon1, lat2, lon2, n = 32) {
  n = Math.max(2, Math.floor(n) || 2);
  const a = nvec(lat1, lon1), b = nvec(lat2, lon2);
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const w = Math.acos(d), sw = Math.sin(w);
  let q = null;
  if (sw < 1e-9 && d < 0) {
    // antipodal: route through the direction of the north pole (or +X at the poles)
    let ref = [0, 0, 1];
    if (Math.abs(a[2]) > 0.99) ref = [1, 0, 0];
    const k = ref[0] * a[0] + ref[1] * a[1] + ref[2] * a[2];
    q = [ref[0] - k * a[0], ref[1] - k * a[1], ref[2] - k * a[2]];
    const l = Math.hypot(q[0], q[1], q[2]);
    q = [q[0] / l, q[1] / l, q[2] / l];
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v;
    if (sw < 1e-9) {
      if (q) {
        const c = Math.cos(Math.PI * t), s = Math.sin(Math.PI * t);
        v = [a[0] * c + q[0] * s, a[1] * c + q[1] * s, a[2] * c + q[2] * s];
      } else v = a;
    } else {
      const k1 = Math.sin((1 - t) * w) / sw, k2 = Math.sin(t * w) / sw;
      v = [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
    }
    const [la, lo] = nvecToLatLonDeg(v);
    out.push(geodeticToEcef(la, lo, 0));
  }
  return out;
}

/** Ellipsoid surface radius (m) along the unit direction u. */
function surfaceRadius(ux, uy, uz) {
  return 1 / Math.sqrt((ux * ux + uy * uy) / (WGS84_A * WGS84_A) + (uz * uz) / (WGS84_B * WGS84_B));
}

// ───────────────────── Schematic continents (hand-authored) ─────────────────────
// SCHEMATIC, low-resolution coastline outlines written by hand for readability only —
// not cartographically accurate. Flat arrays of [lon, lat, lon, lat, ...] in degrees; each is a closed ring.

const CONTINENTS = [
  // North America (Alaska → Arctic coast → Hudson Bay → Labrador → east coast → Gulf → Central America → Pacific coast)
  [-168,65.6,-166,68.3,-162,70.2,-156.5,71.3,-152,70.8,-148,70.3,-141,69.6,-136,69,-130,70,-125,69.5,-120,68.8,-115,68,-110,68,-104,68,-98,67.8,-94,69,-90,68.5,-86,67.5,-82,66.5,-84,64,-87,63.5,-90,63,-94,61,-94.5,58.8,-92.5,57,-88,56,-85,55.2,-82.3,52.9,-80,51.3,-79,54,-77,56,-77,58.5,-78,60.5,-77.5,62.5,-74,62.3,-70,61,-69.5,58.8,-67,58.4,-64.5,60.3,-62,57.5,-60.5,55.5,-57.5,54,-56,52.2,-58,51,-60,50.2,-64,50.2,-66.5,49.7,-65,48.8,-64.5,47.5,-61.5,46,-60,45.8,-63.5,44.6,-66,43.8,-66.9,44.8,-68.5,44.2,-70.2,43.6,-70.6,42,-70,41.7,-71.5,41.4,-73.8,40.6,-74.1,39.8,-74.9,38.9,-75.5,38.4,-76,37,-75.6,35.3,-76.5,34.6,-78,33.8,-79.3,33,-81,31.6,-81.4,30.2,-80.6,28.4,-80,26.5,-80.4,25.2,-81.2,25.4,-81.8,26.7,-82.7,28,-82.7,29.2,-84,30,-85.5,29.7,-87,30.4,-89,30.3,-89.4,29,-90.5,29.1,-92,29.6,-94,29.6,-95.3,28.8,-97.2,27.6,-97.5,25.8,-97.7,24,-97.7,22,-97.2,20.6,-96.2,19.2,-94.6,18.2,-92.5,18.6,-91,19,-90.4,20.9,-88.4,21.5,-87,21.4,-87.5,19.5,-88.2,17.5,-88.8,15.9,-86.5,15.8,-84,15.6,-83.3,14.5,-83.6,12,-83.7,10.9,-82.3,9.4,-80,9.3,-79,9.5,-77.4,8.6,-78,7.4,-80,7.4,-81.7,8.2,-83.6,8.5,-85.7,9.9,-85.7,11.1,-87.5,13,-89.8,13.5,-91.5,14,-93,15.6,-94.8,16.2,-96.5,15.7,-98.5,16.3,-101,17.2,-103.5,18.3,-105.3,19.9,-105.5,21.5,-106.8,23.4,-108.5,25.3,-110,27,-111,28.7,-112.7,30.5,-114.8,31.8,-114.6,30.2,-113,28.5,-112,26.5,-110.3,24.2,-109.5,23,-110.3,23.5,-112,24.8,-112.4,26.5,-114.3,28,-115.2,29.6,-116.3,31.5,-117.1,32.6,-118.4,33.8,-120.6,34.6,-121.9,36.6,-122.5,37.8,-123.8,39.8,-124.3,41.8,-124.1,43.9,-123.9,46.2,-124.7,48.4,-123,48.9,-125,50,-127.5,51,-128,52.5,-130.3,54.5,-132,56.5,-134.5,58.3,-137.5,58.8,-140,59.8,-143.5,60,-146.5,61,-149,60.5,-151.8,59.2,-154,57.5,-156.5,56.6,-159.5,55.5,-162.5,54.9,-161,56.2,-158.5,57.5,-157.5,58.7,-161.8,59,-164.5,60.5,-165.3,62.5,-164,63.3,-161,64.5,-163.5,64.6,-166,64.6],
  // Baffin Island
  [-80,63.5,-77,64.3,-73,62.3,-65,61.8,-64.5,63.5,-66,65.5,-62,66.8,-68,69,-72,70.8,-78,72.5,-84,73.5,-90,72.5,-86,70,-82,69.5,-81,68,-85,66],
  // Victoria Island
  [-118,69,-106,69,-101,70,-104,73,-114,73,-119,71.5],
  // Ellesmere Island
  [-90,76,-80,76.2,-75,79,-68,82,-62,82.5,-75,83,-90,81.5,-95,79],
  // Greenland
  [-73,78,-67,76,-60,76,-57,74.5,-55,71,-52,68.5,-53.5,66,-51,63.5,-49,61.5,-45,60,-43,60,-41,62.5,-40,65,-37,65.8,-32,68,-25,69.5,-22,70.5,-23,72,-21,74,-19,76,-19,78,-16,80,-12,81.6,-20,82.5,-30,83.5,-45,83,-57,82.2,-63,81,-67,80],
  // Cuba, Hispaniola
  [-85,21.9,-83,22.9,-80.5,23.1,-78,22.3,-75.5,20.6,-74.2,20.2,-77.7,19.9,-80,21.7,-82,22.4],
  [-74.4,18.4,-72.8,19.9,-70,19.7,-68.4,18.6,-71.3,17.7],
  // South America
  [-77.4,8.6,-76,9.4,-75.5,10.5,-74.2,11.2,-72.3,11.9,-71.3,12.4,-71.8,11,-71,10.7,-69.8,11.5,-68,10.6,-66,10.6,-64,10.7,-62,10.7,-61,9,-59.8,8.3,-58,6.8,-55,5.9,-53,5.5,-51.5,4.2,-50,1.8,-49.5,0,-48,-1,-44.5,-2.3,-42,-2.8,-39,-3.5,-37.2,-4.8,-35.4,-5.3,-34.8,-7.5,-35.2,-9.3,-37,-11,-38.6,-13,-39,-15.5,-39.6,-18,-40.7,-21,-42,-23,-44.5,-23.3,-46.5,-24.1,-48.5,-26.3,-48.7,-28.5,-50.5,-31,-52.5,-33.5,-54,-34.8,-56.5,-34.9,-58.4,-34.5,-57.2,-36.3,-57.6,-38.2,-62,-39,-62.3,-40.8,-64.9,-40.8,-63.8,-42.2,-65,-45,-67.5,-46.3,-65.9,-47.8,-67.8,-50,-68.4,-52.3,-70,-53,-71.5,-53.9,-74,-52.5,-75.3,-50,-75.5,-47,-74,-44,-73.5,-41.8,-73.7,-38,-72.6,-35.5,-71.6,-33,-71.4,-30,-71.3,-27,-70.5,-24,-70.2,-21,-70.3,-18.4,-72.5,-16.8,-75.5,-14.8,-76.4,-13,-78,-10.5,-79.5,-7.8,-81.2,-6,-80.9,-4.3,-80,-3,-80.9,-1.5,-80.1,0.5,-79,1.5,-78.7,2.6,-77.4,4,-77.4,6.5,-77.9,7.2],
  // Eurasia (Iberia → North Sea → Baltic → Scandinavia → Arctic → Pacific → SE Asia → India → Arabia → Levant → Mediterranean)
  [-5.6,36,-6.4,36.8,-7.4,37.2,-8.9,37,-8.8,38.7,-9.4,39.5,-8.7,41.5,-8.9,42.8,-9.2,43.2,-8,43.7,-5.8,43.6,-3.5,43.4,-1.8,43.4,-1.3,44.5,-1.2,46,-2.2,47.2,-4.5,47.9,-4.7,48.6,-3,48.8,-1.6,48.7,-1.3,49.7,0.2,49.5,1.6,50.2,1.6,51,3,51.3,4.2,52,4.8,53,6.9,53.5,8.5,53.7,8.7,55,8.1,56.6,10.6,57.7,10.5,56.3,12.5,55.6,11,54.2,13,54.4,14.5,53.9,18,54.8,19.7,54.4,21.2,55.2,21,56.8,23.7,57.3,24.4,58.4,23.4,59.2,28,59.5,30,60,28,60.5,25,60.2,22.5,60.3,21.4,61.8,21.5,63.2,24.5,64.8,25.4,65.5,22.4,65.9,21.2,64.8,19,63.5,17.4,62.4,17.2,61,18.9,59.8,16.8,58.6,16.5,57.2,15.8,56.1,14.2,55.4,12.9,55.6,11.5,58,10.7,59.4,9.5,59,7,58,5.6,58.8,5,60.5,5,62,7,62.8,10,64,12,65.5,13.5,67.5,15,68.5,17.5,69.5,20,70,23.5,70.7,26,71,28.5,70.9,31,70.3,33,69.3,36,69,40,67.8,41,66.3,38,66,35,66.2,33.5,66.6,34.5,65.2,36.5,64.5,38,64.8,40,64.6,42,66.4,44,66.2,44,68.4,46,68,48,67.6,53,68.5,55,68.3,58,68.8,60,68.9,63,69.5,66,69.4,68.5,68.2,69,70.5,67,71.8,69,72.9,72.5,72.8,72,71,74,68,77,72,80,72.4,83,70.5,86,73.8,80.5,73.6,87,75,95,76.1,100,76.4,104,77.7,106,76.8,112,76.4,114,75.5,113,73.6,118,73.5,124,73.5,128,72.6,129.5,71,132,71.5,136,71.6,140,72.4,146,72.3,150,71.5,153,70.9,158,70.8,160,69.6,166,69.6,170,70,176,69.8,180,68.9,-176,67.5,-172,66.9,-169.8,66,-171,65.4,-173,64.3,-176,65,-179,65,178,64.5,177,62.5,173,61.7,170,60,166,60,163,59.5,162,57.8,163,56.1,161.8,54.8,160,53,158.5,52,156.6,51,156,53.5,155.5,56.5,157,57.8,160,58.8,163,60.5,160,61.5,156,61.6,154,59.5,150,59.5,146,59.3,143,59.3,141,58.3,138,56,135.5,54.5,137.5,53.8,141,53,140.5,51,140.4,48.5,138.5,46.6,135,43.3,132,43,130.7,42.3,129.7,41,128,40,129.4,37,129.3,35.2,126.5,34.4,126.3,36.7,126.2,37.8,124.8,39.6,121.6,39,121.5,40.8,119.5,39.9,118,39.2,117.5,38.4,119,37.2,120.8,37.8,122.5,37,120.3,36,119.2,34.8,120.8,32.4,121.9,31,121.9,30,121.5,28.3,120,26.5,119.5,25.3,118,24.4,116.5,22.9,114.2,22.3,112,21.7,110.4,21.2,110.2,20.3,109.6,21.6,108,21.5,106.7,20.7,105.7,19,106.5,17.5,108.2,16,109.2,13.4,109.3,11.6,107.2,10.4,105.1,8.7,104.8,10.4,103,11,102.3,12.2,100.9,13.4,100,12.3,99.2,9.2,100.4,7.4,101.3,6.9,103,5.5,103.5,4,104.2,1.4,103.5,1.3,101.3,2.9,100.4,5,100.2,6.5,98.3,8,98.2,10,98.7,12.5,97.6,16.5,95.4,15.8,94.2,16.5,94.6,18.5,93.6,19.8,92.3,21,91.8,22.5,90.5,22,89,21.8,87,21.5,86.9,20.5,85,19.3,82.3,16.6,80.3,15.8,80.2,13.2,79.9,10.3,79,9.2,78.2,8.4,77.3,8.1,76.5,8.9,75.7,11.3,74.8,12.9,74.1,14.8,73.4,16.5,72.8,19.3,72.8,21.3,72.6,22.3,70.5,20.8,69,22.4,70.3,22.9,68.4,23.6,67,24.8,66.5,25.4,64,25.3,61.5,25.1,59,25.5,57.3,25.7,56.4,27.1,54,26.6,51.5,27.9,50.1,30.1,48.5,29.9,47.9,29,48.8,27.6,50.1,26.4,50.8,24.8,51.6,25.2,51.6,24.2,54,24.1,56,24.9,56.4,26.3,57.2,23.8,58.8,23.5,59.8,22.4,58.6,20.5,57.8,19,55.4,17.6,52.2,15.9,49.5,14.6,47,13.1,45,12.8,43.5,12.7,42.8,14.8,42.6,16.5,41.2,18.6,40.3,20,39.1,21.7,38.5,23.6,37.4,25,36.5,26.4,35.2,28.1,34.6,28.1,34.9,29.5,34.2,31.3,34.6,32,35,32.8,35.6,34.3,36,35.9,36,36.8,34.6,36.8,32.5,36.1,30.5,36.4,29.2,36.7,27.5,37,27.2,38.4,26.4,39.5,26.6,40.3,26,40.8,24,40.8,23.6,40.2,22.6,40.3,23,39,24,38.2,23,37.5,22.6,36.5,21.7,36.9,21.1,38.3,20.2,39.6,19.4,41,19.5,42,18.5,42.5,17,43.3,15.4,44.3,14.5,45.3,13.6,45.7,12.4,45.4,12.3,44.3,13.6,43.5,14.7,42,16,41.4,18.5,40.1,17,39.9,16.6,38.9,15.7,38,15.7,39.5,14.9,40.2,12.8,41.3,11.1,42.5,10.2,43.9,8.8,44.4,7.5,43.8,6,43.1,4.6,43.4,3,43.1,3.2,41.9,1,41,0,39.8,-0.3,38.4,-0.8,37.6,-2.1,36.7,-4.4,36.7],
  // Black Sea, Caspian Sea (drawn as outlines)
  [28,41.2,28.6,43.4,30,45,30.8,46.5,33.5,46,32.5,45.4,33.6,44.4,35.5,45.1,36.6,45.4,38,47.1,39.3,47,37.5,46,37.6,44.7,39.7,43.4,41.6,41.6,40,41,38,40.9,36,41.7,34,42,32,41.8,30,41.2],
  [47,44.8,49,46.5,51.5,47,53,46.5,53,45,51,44.5,51.5,43,52.7,41.7,53,40,53.8,37.5,51,36.7,49,37.6,49.5,40.3,48,42],
  // Novaya Zemlya
  [52,71.5,55,70.6,57.5,70.7,56,72.5,58,74.5,62,75.5,68,76.8,65,77,59,76,55,74],
  // Great Britain, Ireland, Iceland
  [-5.7,50.1,-3,50.6,0,50.8,1.4,51.3,1.7,52.6,0.3,53.4,-0.2,54.3,-1.6,55.6,-2.1,57,-1.8,57.6,-3.3,58.6,-5,58.6,-5.7,57.6,-5.6,56.3,-4.9,55.1,-3.1,54.9,-3.4,54.3,-3,53.4,-4.6,53.3,-4.1,52.4,-5.2,51.7,-3.4,51.4],
  [-6,52.2,-6.2,53.8,-5.5,54.6,-7.3,55.3,-8.5,54.6,-10,53.9,-9.5,52.6,-10.3,51.8,-8.4,51.6],
  [-22.5,64,-24,65.5,-21.5,66.2,-18,66.2,-15,66.4,-13.6,65.2,-15,64.3,-18,63.4],
  // Africa
  [-5.9,35.8,-2,35.1,0,35.8,3,36.8,7,37,10,37.3,11,36.8,10.4,35.5,11,35,10.1,34,11.5,33.1,13,32.9,15.3,32.2,17,31,19,30.3,20.1,31,20,32.2,21.5,32.9,23.2,32.5,25,31.9,27,31.4,29,30.9,31,31.6,32.4,31.2,34.2,31.3,34.6,29.5,34,27.5,33.5,28.2,32.6,29.9,32.4,29.4,33.6,27.3,34.3,26,35.6,23.9,36.9,22,37.4,18.8,38.6,18,39.7,15.3,41.2,14.5,43.3,12.5,44,10.5,45.5,10.7,48,11.2,51.2,11.9,51,10.5,50.8,9.2,49.5,6.8,48,4.5,46,2,43.5,-0.8,41.6,-1.8,40.2,-3,39.3,-4.7,39.2,-6.8,39.5,-8.5,40.4,-10.4,40.6,-14,40,-16.4,37,-17.8,35,-19.8,35.5,-22,35.4,-24,33,-25.5,32.9,-26.9,32.4,-28.8,31,-29.9,30,-31.3,28,-33,25.6,-34,22.5,-34,20,-34.8,18.4,-34.1,18.2,-32,17.2,-29.5,16.5,-28.6,15.2,-27,14.5,-23,14.4,-22.3,13.2,-20.3,11.8,-17.3,11.8,-15.8,12.6,-13,13.7,-11.2,13.2,-9,12.3,-6.1,12,-5,11,-3.8,9.8,-2.5,9,-0.6,9.6,1,9.8,3,9,4,8,4.5,6.5,4.3,5,5.8,4.4,6.4,2,6.3,0,5.6,-2,4.8,-4,5.2,-7.5,4.4,-9.2,5.2,-11.4,6.8,-13,7.8,-13.4,9.5,-15,10.9,-16.7,12.3,-17.2,14.6,-16.5,16.2,-16.1,18.2,-16.5,19.6,-17,21,-16,23.7,-14.9,25.5,-13.2,27.6,-11.6,28.2,-9.8,29.6,-9.6,30.9,-8.6,33.3,-6.8,34.1],
  // Madagascar, Sri Lanka
  [49.3,-12,50.2,-14.5,50.4,-15.9,49.4,-17.5,48.4,-20.5,47.5,-23.5,47,-25,45.2,-25.5,44,-24.8,43.3,-22,44.3,-20,44,-17.5,44.5,-16.2,46.3,-15.6,47.8,-14],
  [79.9,9.8,81.4,8.4,81.8,7,81,6,80,6,79.8,8],
  // Japan (Honshu, Kyushu, Hokkaido), Taiwan, Sakhalin
  [130.9,34,132.3,34.3,133.5,34.4,135,34.6,135.3,33.6,136,33.5,136.9,34.3,138.2,34.6,139,34.9,139.8,35,140.4,35.2,140.9,36.9,141,38.3,141.6,39.5,141.5,40.6,141.2,41.3,140.3,41.2,139.9,40,140,39,139.4,38.1,138.5,37.4,137.2,36.8,136.7,37.3,136,35.7,134,35.5,132.5,35.4,131.2,34.4],
  [130,33.7,131,33.9,131.9,33,131.5,31.5,130.7,31,130.2,31.5,129.7,33],
  [140,41.4,141.2,41.8,143.2,42,145.6,43.3,145,44.2,142,45.5,141.6,45.2,141.4,43.4,140.4,43.2],
  [121.5,25.3,121.9,24.6,120.9,22,120.1,23],
  [142,46,143.5,46.8,143,49.5,144.5,49,143,52,143,54,142.3,54.3,142.2,51,141.8,48],
  // Philippines (Luzon, Mindanao)
  [120.6,18.5,122.3,18.4,122,16,121.6,15,124,13,124,12.5,122.6,13.5,121,13.8,120.6,14.5,119.8,16.3],
  [122,7,123.5,7.8,125.5,9.6,126.6,7.3,125.4,5.6,124,6.5],
  // Indonesia: Sumatra, Java, Borneo, Sulawesi; New Guinea
  [95.3,5.6,97.5,5.2,100.4,2.2,103.8,-1,106,-3,105.8,-5.8,104.5,-5.9,102.3,-4,101,-2.2,98.7,1.7,97,3.3],
  [105.2,-6.8,106.5,-6,108.3,-6.3,110.5,-6.9,112.6,-6.9,114.5,-7.8,114.4,-8.7,111,-8.2,108.6,-7.8,106.4,-7.4],
  [109,1.5,109.7,2,111.2,2.6,113,3.2,114.6,4.5,115.9,5.3,117,7,117.7,6,119.2,5.3,118.2,4.4,117.7,3.1,118,1,117.4,0,116.7,-1.5,116.4,-3.3,114.6,-4,113,-3.2,111.7,-3.2,110.2,-2.9,110.1,-1.6,109.1,-0.4],
  [120.5,0.5,123,0.9,125,1.5,123.4,0.4,121,0,120.8,-1.5,122,-1,123.4,-0.9,121.3,-1.9,122.4,-3.5,122.6,-5.5,121.2,-4.7,120.4,-5.5,119.4,-5.4,119.5,-3.5,118.8,-2.8,119.8,0],
  [131,-1.4,132.6,-0.4,134.2,-0.9,135.5,-3.3,137.8,-1.5,141,-2.6,144.5,-3.8,146,-5.5,147.8,-6.3,147.4,-8,149,-9.7,150.8,-10.3,148,-10.2,146,-8.1,144,-7.7,143.4,-9,141,-9.1,139,-8.1,138,-8.4,137.6,-7,138.6,-6.3,135.2,-4.4,132.8,-4.1,132,-2.8,133.6,-2.4,132,-2.2],
  // Australia, Tasmania
  [113.6,-22,114.2,-26,115,-29.5,115.7,-31.8,115,-33.5,115.4,-34.3,117.9,-35.1,120,-34,123.5,-33.9,126,-32.3,129,-31.6,131.2,-31.5,133.5,-32.2,135,-33.5,136,-35,137.8,-33,137.6,-35.6,139.7,-36,140.6,-38,143.5,-38.8,146.3,-39.1,148,-37.8,150,-37.4,150.1,-35.7,151.3,-33.8,152.5,-32.4,153.6,-28.5,153.1,-25.5,151,-23.5,149.5,-22.3,148.7,-20.5,146.3,-19,145.4,-16,145.3,-14.8,143.6,-14,143.4,-12.3,142.5,-10.7,141.7,-12.9,141.6,-15,140.8,-17.4,139.3,-17.4,137,-15.9,135.4,-15,136.6,-13.2,136.9,-12.2,134.5,-12,132.6,-11.5,131,-12.2,129.5,-14.9,128,-15.4,126,-14.2,124.5,-16.3,123.5,-17.3,122.2,-18.2,121,-19.6,118.5,-20.3,116.8,-20.6,114.6,-21.8],
  [144.7,-40.7,148.3,-40.9,148,-43.2,146.9,-43.6,145.3,-42.6],
  // New Zealand (North, South)
  [172.7,-34.4,174.4,-35.7,175.9,-37.4,178.5,-37.7,177.9,-39.2,176.9,-39.5,175.9,-41.4,174.7,-41.3,175.2,-40.2,173.8,-39.2,174.6,-38,174.4,-36.6],
  [172.8,-40.5,174.2,-41.3,173.9,-42.5,172.8,-43.6,171.2,-44.5,170.6,-45.9,169.3,-46.6,166.5,-46,166.9,-45.2,168.4,-44,170.8,-42.6,172.1,-41],
  // Antarctica rim
  [-180,-78,-170,-78.4,-160,-80,-150,-79,-145,-76,-135,-74.5,-120,-73.8,-110,-74.5,-100,-73.5,-90,-72.8,-80,-73.2,-75,-71.5,-68,-70,-62,-66,-58,-63.5,-60,-64,-62,-66.5,-64,-69,-62,-72,-60,-75,-50,-77.8,-40,-78,-35,-77,-28,-75.5,-20,-73.5,-12,-71.5,0,-70,10,-70,20,-70,30,-69.5,40,-69,50,-67,60,-67,70,-68,75,-69.5,80,-67,90,-66.5,100,-66,110,-66.5,120,-67,130,-66.2,140,-66.7,150,-68.5,160,-70,166,-71,170,-72,168,-76,170,-78,180,-78],
];

// ─────────────────────────────── three.js loading ───────────────────────────────

let libsPromise = null;
function loadThree() {
  if (!libsPromise) {
    libsPromise = (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      let fat = null;
      try {
        const [l2, lm, lg] = await Promise.all([
          import('three/addons/lines/Line2.js'),
          import('three/addons/lines/LineMaterial.js'),
          import('three/addons/lines/LineGeometry.js'),
        ]);
        fat = { Line2: l2.Line2, LineMaterial: lm.LineMaterial, LineGeometry: lg.LineGeometry };
      } catch (e) {
        console.warn('globe3d: wide lines unavailable, using 1-px lines', e);
      }
      return { THREE, OrbitControls, fat };
    })();
    libsPromise.catch(() => { libsPromise = null; }); // allow a later retry
  }
  return libsPromise;
}

function showNotice(container, text) {
  const div = document.createElement('div');
  div.className = 'globe3d-notice';
  div.setAttribute('role', 'note');
  div.textContent = text;
  div.style.cssText = 'padding:12px 14px;font:13px/1.4 system-ui,sans-serif;opacity:.75;border:1px dashed currentColor;border-radius:6px;margin:8px 0;';
  container.appendChild(div);
  return div;
}

// ─────────────────────────────── constants ───────────────────────────────

const S = 1e-6;                 // metres → scene units (1 unit = 1000 km)
const A_U = WGS84_A * S;
const LIFT_GRID = 0.00006;      // graticule / coastline lift (≈380 m; chords are densified to < 150 m sag)
const LIFT_LINE = 0.0001;       // user surface polylines (≈640 m); the globe also uses polygonOffset
const LIFT_MARK = 0.0001;       // surface markers (kept small to avoid visible parallax when zoomed in)
const SURFACE_TOL = 20e3;       // m: points this close to the surface count as "on the surface"
const MAX_SURF_STEP = 0.5 * D2R; // densify surface segments longer than this (chord sag ≈ 60 m)
const FOV = 40;
const MAX_DIST = 20 * A_U;

// ─────────────────────────────── createGlobe ───────────────────────────────

export async function createGlobe(container, options = {}) {
  if (!container || !container.appendChild) throw new Error('globe3d: createGlobe needs a container element');
  const opts = { height: 480, background: null, showContinents: true, ...options };

  let libs;
  try {
    libs = await loadThree();
  } catch (err) {
    showNotice(container, '3-D view unavailable (could not load three.js)');
    throw new Error('globe3d: 3-D view unavailable — could not load three.js (' + (err && err.message ? err.message : err) + ')');
  }
  const { THREE, OrbitControls, fat } = libs;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    showNotice(container, '3-D view unavailable (WebGL is not available in this browser)');
    throw new Error('globe3d: WebGL renderer could not be created (' + (err && err.message ? err.message : err) + ')');
  }

  const V3 = THREE.Vector3;
  let disposed = false;
  let width = Math.max(1, container.clientWidth || 300);
  let height = Math.max(1, opts.height | 0 || 480);

  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = height + 'px';
  canvas.setAttribute('aria-label', '3-D globe view: drag to rotate, scroll or pinch to zoom');
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.01, 1000);
  camera.up.set(0, 0, 1);                       // ECEF +Z (north) is up on screen
  scene.add(camera);

  // lights: soft ambient + a key light that follows the camera (from the viewer's upper-left)
  const ambient = new THREE.AmbientLight(0xffffff, 1.9);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
  keyLight.position.set(-0.6, 0.7, 1);
  camera.add(keyLight);                         // target stays at the world origin (Earth centre)

  // ── colour resolution ──
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
  const cssCache = new Map();

  function cssVar(name) {
    try { return getComputedStyle(container).getPropertyValue(name).trim(); } catch { return ''; }
  }
  /** Any CSS colour / custom-property name → '#rrggbb', or null if unresolvable. */
  function toHex(input) {
    if (input == null) return null;
    if (typeof input === 'number') return '#' + (input & 0xffffff).toString(16).padStart(6, '0');
    let str = String(input).trim();
    if (!str) return null;
    const m = /^var\(\s*(--[^,\s)]+)\s*(?:,\s*([^)]*))?\)$/.exec(str);
    if (m) str = cssVar(m[1]) || (m[2] || '').trim();
    else if (str.startsWith('--')) str = cssVar(str);
    if (!str) return null;
    if (/^#[0-9a-f]{6}$/i.test(str)) return str.toLowerCase();
    if (cssCache.has(str)) return cssCache.get(str);
    let out = null;
    if (colorCtx) {
      colorCtx.fillStyle = '#010203';
      colorCtx.fillStyle = str;
      const accepted = String(colorCtx.fillStyle).toLowerCase() !== '#010203' || /^#010203$/i.test(str);
      if (accepted) {
        colorCtx.clearRect(0, 0, 1, 1);
        colorCtx.fillRect(0, 0, 1, 1);
        const d = colorCtx.getImageData(0, 0, 1, 1).data;
        out = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      }
    }
    if (cssCache.size > 500) cssCache.clear();
    cssCache.set(str, out);
    return out;
  }
  const hexOr = (input, fallback) => toHex(input) || fallback;
  const color3 = (hex) => new THREE.Color(hex);

  const theme = {};
  function readTheme() {
    const dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    theme.ocean = hexOr('--globe-ocean', dark ? '#17293a' : '#dbe7f1');
    theme.land = hexOr('--globe-land-line', dark ? '#8fc9a3' : '#3f7a55');
    theme.grid = hexOr('--globe-grid', dark ? '#3c5168' : '#9fb4c8');
    theme.text = hexOr('--text', dark ? '#e8eaed' : '#1c1f23');
    const bg = opts.background != null ? toHex(opts.background) : toHex('--surface-2');
    theme.bg = bg;                                  // null → transparent
    theme.halo = bg || (dark ? '#10161d' : '#ffffff');
    theme.accent = hexOr('--accent', dark ? '#7ab8ff' : '#1f6feb');
  }
  readTheme();

  // ── disposal helpers ──
  function disposeMaterial(m) {
    if (!m) return;
    (Array.isArray(m) ? m : [m]).forEach((x) => x && x.dispose && x.dispose());
  }
  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.isSprite) { disposeMaterial(o.material); return; }   // sprite geometry is shared by three.js
      if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
      if (o.material) disposeMaterial(o.material);
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  // ── sprite textures (cached; cleared on theme change and dispose) ──
  const texCache = new Map();
  function canvasTexture(key, w, h, draw) {
    let t = texCache.get(key);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.userData.cssW = w / 2; t.userData.cssH = h / 2;
    texCache.set(key, t);
    return t;
  }
  function clearTextures() { texCache.forEach((t) => t.dispose()); texCache.clear(); }

  function markerTexture(kind, hex) {
    const size = kind === 'dot' ? 28 : 48;          // device px at 2× → CSS 14 / 24
    return canvasTexture(`m:${kind}:${hex}:${theme.halo}`, size, size, (g, w) => {
      const c = w / 2;
      g.lineCap = 'round';
      if (kind === 'dot') {
        g.beginPath(); g.arc(c, c, 9, 0, Math.PI * 2);
        g.fillStyle = hex; g.fill();
        g.lineWidth = 3; g.strokeStyle = theme.halo; g.stroke();
      } else if (kind === 'emitter') {
        g.beginPath(); g.arc(c, c, 17, 0, Math.PI * 2);
        g.lineWidth = 7; g.strokeStyle = theme.halo; g.stroke();
        g.lineWidth = 3.5; g.strokeStyle = hex; g.stroke();
        g.beginPath(); g.arc(c, c, 7, 0, Math.PI * 2);
        g.fillStyle = hex; g.fill(); g.lineWidth = 2.5; g.strokeStyle = theme.halo; g.stroke();
      } else { // estimate: diamond with an X
        const r = 15;
        const path = () => { g.beginPath(); g.moveTo(c, c - r); g.lineTo(c + r, c); g.lineTo(c, c + r); g.lineTo(c - r, c); g.closePath(); };
        const cross = () => { g.beginPath(); g.moveTo(c - 6, c - 6); g.lineTo(c + 6, c + 6); g.moveTo(c + 6, c - 6); g.lineTo(c - 6, c + 6); };
        path(); g.lineWidth = 7; g.strokeStyle = theme.halo; g.stroke();
        path(); g.lineWidth = 3.5; g.strokeStyle = hex; g.stroke();
        cross(); g.lineWidth = 6; g.strokeStyle = theme.halo; g.stroke();
        cross(); g.lineWidth = 3; g.strokeStyle = hex; g.stroke();
      }
    });
  }
  function labelTexture(text, hex) {
    const fontPx = 26;                               // 13 CSS px at 2×
    const font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    const tw = Math.ceil(measure.measureText(text).width);
    const w = tw + 12, h = fontPx + 14;
    return canvasTexture(`l:${text}:${hex}:${theme.text}:${theme.halo}`, w + (w % 2), h + (h % 2), (g) => {
      g.font = font; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = 6; g.strokeStyle = theme.halo; g.strokeText(text, 6, h / 2 + 1);
      g.fillStyle = hex || theme.text; g.fillText(text, 6, h / 2 + 1);
    });
  }

  // constant on-screen size sprites (sizeAttenuation: false); positions occluded by the Earth are hidden manually
  function makeSprite(tex, anchor, { label = false, offsetPx = 0 } = {}) {
    const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.position.copy(anchor);
    s.renderOrder = label ? 101 : 100;
    s.userData.px = [tex.userData.cssW, tex.userData.cssH];
    s.userData.anchor = anchor.clone();
    s.userData.isLabel = label;
    if (label) s.center.set(-offsetPx / tex.userData.cssW, 0.1);
    updateSpriteScale(s);
    return s;
  }
  function pxToScale() { return (2 * Math.tan((FOV * D2R) / 2)) / height; }
  function updateSpriteScale(s) {
    const k = pxToScale();
    s.scale.set(s.userData.px[0] * k, s.userData.px[1] * k, 1);
  }

  // ── geometry helpers ──
  function toVec(p) {
    if (!p || p.length < 3) return null;
    const x = +p[0], y = +p[1], z = +p[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return new V3(x * S, y * S, z * S);
  }
  function surfR(v) { // scene-units surface radius along v's direction
    const l = v.length() || 1;
    return surfaceRadius(v.x / l, v.y / l, v.z / l) * S;
  }
  function liftedSurfacePoint(dir, lift) { const d = dir.clone().normalize(); return d.multiplyScalar(surfR(d) * (1 + lift)); }
  function nearSurface(v) { const r = v.length(); return r > 0 && Math.abs(r - surfR(v)) < SURFACE_TOL * S; }

  /** Lift near-surface points and densify surface-to-surface segments along great circles. */
  function prepPolyline(rawPts, closed) {
    const pts = [];
    for (const p of rawPts || []) { const v = toVec(p); if (v) pts.push(v); }
    if (closed && pts.length > 2) pts.push(pts[0].clone());
    if (pts.length < 2) return pts;
    const flags = pts.map(nearSurface);
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i > 0 && flags[i] && flags[i - 1]) {
        const a = pts[i - 1].clone().normalize(), b = p.clone().normalize();
        const ang = a.angleTo(b);
        const steps = Math.ceil(ang / MAX_SURF_STEP);
        if (steps > 1) {
          const q = new THREE.Quaternion().setFromUnitVectors(a, b), qt = new THREE.Quaternion(), id = new THREE.Quaternion();
          for (let k = 1; k < steps; k++) {
            qt.slerpQuaternions(id, q, k / steps);
            out.push(liftedSurfacePoint(a.clone().applyQuaternion(qt), LIFT_LINE));
          }
        }
      }
      out.push(flags[i] ? liftedSurfacePoint(p, LIFT_LINE) : p);
    }
    return out;
  }

  function lineResolution(m) { if (m && m.isLineMaterial) m.resolution.set(width, height); }

  function makeLine(pts, spec, fallbackHex) {
    const hex = hexOr(spec.color, fallbackHex);
    const opacity = Math.max(0, Math.min(1, spec.opacity == null ? 1 : +spec.opacity));
    const widthPx = Math.max(0.5, spec.width == null ? 2 : +spec.width || 2);
    const dashed = !!spec.dashed;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    // dash pattern sized to the line and arranged to start and end on a dash
    const d0 = Math.max(len / 60, 0.004);
    const nDash = Math.max(1, Math.round((len / d0 - 1) / 1.7));
    const dash = len > 0 ? len / (1 + 1.7 * nDash) : d0, gap = dash * 0.7;
    const transparent = opacity < 1;
    let line;
    if (fat) {
      const arr = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
      const g = new fat.LineGeometry();
      g.setPositions(arr);
      const m = new fat.LineMaterial({ color: color3(hex), linewidth: widthPx, transparent, opacity, depthWrite: !transparent, dashed });
      if (dashed) { m.dashSize = dash; m.gapSize = gap; m.dashScale = 1; }
      lineResolution(m);
      line = new fat.Line2(g, m);
      if (dashed) line.computeLineDistances();
    } else {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed
        ? new THREE.LineDashedMaterial({ color: color3(hex), transparent, opacity, dashSize: dash, gapSize: gap, depthWrite: !transparent })
        : new THREE.LineBasicMaterial({ color: color3(hex), transparent, opacity, depthWrite: !transparent });
      line = new THREE.Line(g, m);
      if (dashed) line.computeLineDistances();
    }
    line.renderOrder = 20;
    return line;
  }

  // ── Earth ──
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);
  let earthMat, gridMat, gridMajorMat, landMat;
  {
    const nLat = 72, nLon = 144;
    const pos = new Float32Array((nLat + 1) * (nLon + 1) * 3), nor = new Float32Array(pos.length);
    let k = 0;
    for (let i = 0; i <= nLat; i++) {
      const lat = -90 + (180 * i) / nLat;
      for (let j = 0; j <= nLon; j++) {
        const lon = -180 + (360 * j) / nLon;
        const p = geodeticToEcef(lat, lon, 0), n = nvec(lat, lon);
        pos[k] = p[0] * S; pos[k + 1] = p[1] * S; pos[k + 2] = p[2] * S;
        nor[k] = n[0]; nor[k + 1] = n[1]; nor[k + 2] = n[2];
        k += 3;
      }
    }
    const idx = [];
    for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
      const a = i * (nLon + 1) + j, b = a + nLon + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    earthMat = new THREE.MeshLambertMaterial({ color: color3(theme.ocean), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    const earth = new THREE.Mesh(g, earthMat);
    earth.renderOrder = 0;
    earthGroup.add(earth);

    // graticule: 15° grid, equator + prime meridian stronger
    const minor = [], major = [];
    const pushArc = (arr, lat1, lon1, lat2, lon2) => {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot3(nvec(lat1, lon1), nvec(lat2, lon2))))) / D2R;
      const pts = greatCirclePoints(lat1, lon1, lat2, lon2, Math.max(2, Math.ceil(ang / 0.75) + 1));
      for (let i = 1; i < pts.length; i++) {
        arr.push(pts[i - 1][0] * S * (1 + LIFT_GRID), pts[i - 1][1] * S * (1 + LIFT_GRID), pts[i - 1][2] * S * (1 + LIFT_GRID),
          pts[i][0] * S * (1 + LIFT_GRID), pts[i][1] * S * (1 + LIFT_GRID), pts[i][2] * S * (1 + LIFT_GRID));
      }
    };
    for (let lon = -180; lon < 180; lon += 15) {
      const arr = lon === 0 ? major : minor;
      for (let lat = -90; lat < 90; lat += 2) pushArc(arr, lat, lon, lat + 2, lon);
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const arr = lat === 0 ? major : minor;
      for (let lon = -180; lon < 180; lon += 2) pushArc(arr, lat, lon, lat, lon + 2);
    }
    gridMat = new THREE.LineBasicMaterial({ color: color3(theme.grid), transparent: true, opacity: 0.55, depthWrite: false });
    gridMajorMat = new THREE.LineBasicMaterial({ color: color3(theme.grid), transparent: true, opacity: 1, depthWrite: false });
    const mkSeg = (arr, m) => {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const ls = new THREE.LineSegments(sg, m);
      ls.renderOrder = 1;
      return ls;
    };
    earthGroup.add(mkSeg(minor, gridMat), mkSeg(major, gridMajorMat));

    if (opts.showContinents) {
      const land = [];
      for (const ring of CONTINENTS) {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          pushArc(land, ring[i * 2 + 1], ring[i * 2], ring[j * 2 + 1], ring[j * 2]);
        }
      }
      landMat = new THREE.LineBasicMaterial({ color: color3(theme.land), transparent: true, opacity: 0.95, depthWrite: false });
      const ls = mkSeg(land, landMat);
      ls.renderOrder = 2;
      earthGroup.add(ls);
    }
  }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function applyBackground() {
    if (theme.bg) renderer.setClearColor(color3(theme.bg), 1);
    else renderer.setClearColor(0x000000, 0);
  }
  applyBackground();

  // ── data layers ──
  const layers = { emitter: null, estimate: null, sats: null };
  const state = { emitter: null, estimate: null, sats: [], labels: true };
  const polyGroups = new Map(), polyArgs = new Map();
  const meshObjs = new Map(), meshArgs = new Map();
  const ellObjs = new Map(), ellArgs = new Map();
  let unitSphere = null;

  function surfaceMarker(spec, kind, defLabel, defColor) {
    const p = toVec(spec.ecef);
    if (!p) return null;
    const g = new THREE.Group();
    const hex = hexOr(spec.color, defColor);
    const anchor = nearSurface(p) ? liftedSurfacePoint(p, LIFT_MARK) : p;
    g.add(makeSprite(markerTexture(kind, hex), anchor));
    const text = spec.label == null ? defLabel : String(spec.label);
    if (text) {
      const l = makeSprite(labelTexture(text, hex), anchor, { label: true, offsetPx: 12 });
      l.visible = state.labels;
      g.add(l);
    }
    scene.add(g);
    return g;
  }

  function setEmitter(spec) {
    if (disposed) return;
    state.emitter = spec || null;
    disposeObject(layers.emitter); layers.emitter = null;
    if (spec) layers.emitter = surfaceMarker(spec, 'emitter', 'Emitter', theme.accent);
    requestRender();
  }
  function setEstimate(spec) {
    if (disposed) return;
    state.estimate = spec || null;
    disposeObject(layers.estimate); layers.estimate = null;
    if (spec) layers.estimate = surfaceMarker(spec, 'estimate', 'Estimate', '#e0533d');
    requestRender();
  }

  function setSatellites(list) {
    if (disposed) return;
    state.sats = Array.isArray(list) ? list.slice() : [];
    disposeObject(layers.sats); layers.sats = null;
    if (!state.sats.length) { requestRender(); return; }
    const g = new THREE.Group();
    for (const sat of state.sats) {
      if (!sat) continue;
      const p = toVec(sat.ecef);
      if (!p) continue;
      const hex = hexOr(sat.color, theme.accent);
      g.add(makeSprite(markerTexture('dot', hex), p));
      const text = sat.label != null ? String(sat.label) : sat.id != null ? String(sat.id) : '';
      if (text) {
        const l = makeSprite(labelTexture(text, hex), p, { label: true, offsetPx: 9 });
        l.visible = state.labels;
        g.add(l);
      }
      // nadir line to the sub-satellite point
      if (p.length() > surfR(p) * 1.002) {
        const foot = liftedSurfacePoint(p, LIFT_GRID);
        const ng = new THREE.BufferGeometry().setFromPoints([p, foot]);
        const nm = new THREE.LineDashedMaterial({ color: color3(hex), transparent: true, opacity: 0.55, dashSize: 0.012, gapSize: 0.01, depthWrite: false });
        const nl = new THREE.Line(ng, nm);
        nl.computeLineDistances();
        nl.renderOrder = 15;
        g.add(nl);
      }
      const v = toVec(sat.velEcef);
      if (v && v.lengthSq() > 0) {
        const arrow = new THREE.ArrowHelper(v.clone().normalize(), p, 0.3, color3(hex).getHex(), 0.07, 0.04);
        arrow.renderOrder = 16;
        g.add(arrow);
      }
    }
    scene.add(g);
    layers.sats = g;
    requestRender();
  }

  function setPolylines(key, list) {
    if (disposed) return;
    key = String(key);
    disposeObject(polyGroups.get(key)); polyGroups.delete(key);
    if (!Array.isArray(list) || !list.length) { polyArgs.delete(key); requestRender(); return; }
    polyArgs.set(key, list);
    const g = new THREE.Group();
    for (const spec of list) {
      if (!spec) continue;
      const pts = prepPolyline(spec.points, !!spec.closed);
      if (pts.length < 2) continue;
      g.add(makeLine(pts, spec, theme.text));
    }
    scene.add(g);
    polyGroups.set(key, g);
    requestRender();
  }

  function setMesh(key, spec) {
    if (disposed) return;
    key = String(key);
    disposeObject(meshObjs.get(key)); meshObjs.delete(key);
    if (!spec || !spec.positions || spec.positions.length < 9) { meshArgs.delete(key); requestRender(); return; }
    meshArgs.set(key, spec);
    const src = spec.positions, n = Math.floor(src.length / 3);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) { const v = +src[i]; pos[i] = Number.isFinite(v) ? v * S : 0; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (spec.indices && spec.indices.length >= 3) {
      const m = spec.indices.length - (spec.indices.length % 3);
      const idx = new Uint32Array(m);
      let ok = true;
      for (let i = 0; i < m; i++) { const v = spec.indices[i] >>> 0; if (v >= n) { ok = false; break; } idx[i] = v; }
      if (ok) g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const opacity = Math.max(0, Math.min(1, spec.opacity == null ? 0.25 : +spec.opacity));
    const mat = new THREE.MeshLambertMaterial({
      color: color3(hexOr(spec.color, theme.accent)), transparent: true, opacity,
      side: spec.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
      depthWrite: false, wireframe: !!spec.wireframe,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 10;
    scene.add(mesh);
    meshObjs.set(key, mesh);
    requestRender();
  }

  function setEllipsoid(key, spec) {
    if (disposed) return;
    key = String(key);
    disposeObject(ellObjs.get(key)); ellObjs.delete(key);
    const c = spec && toVec(spec.center);
    const ax = spec && Array.isArray(spec.axes) && spec.axes.length >= 3 ? spec.axes.slice(0, 3).map(toVec) : null;
    if (!c || !ax || ax.some((v) => !v)) { ellArgs.delete(key); requestRender(); return; }
    ellArgs.set(key, spec);
    const k = spec.scale == null ? 1 : +spec.scale || 1;
    ax.forEach((v) => v.multiplyScalar(k));
    const hex = hexOr(spec.color, theme.accent);
    const opacity = Math.max(0, Math.min(1, spec.opacity == null ? 0.35 : +spec.opacity));
    if (!unitSphere) unitSphere = new THREE.SphereGeometry(1, 48, 24);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: color3(hex), transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(unitSphere, mat);
    mesh.userData.sharedGeometry = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(ax[0], ax[1], ax[2]).setPosition(c);
    mesh.renderOrder = 11;
    g.add(mesh);
    // principal ellipses as outlines so the shape reads at any opacity
    const pairs = [[0, 1], [1, 2], [0, 2]];
    for (const [i, j] of pairs) {
      const pts = [];
      for (let s = 0; s <= 64; s++) {
        const t = (s / 64) * Math.PI * 2;
        pts.push(c.clone().addScaledVector(ax[i], Math.cos(t)).addScaledVector(ax[j], Math.sin(t)));
      }
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      const lm = new THREE.LineBasicMaterial({ color: color3(hex), transparent: true, opacity: Math.min(1, opacity + 0.4), depthWrite: false });
      const l = new THREE.Line(lg, lm);
      l.renderOrder = 12;
      g.add(l);
    }
    scene.add(g);
    ellObjs.set(key, g);
    requestRender();
  }

  function setLabelsVisible(on) {
    if (disposed) return;
    state.labels = !!on;
    requestRender();
  }

  // ── controls & view ──
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxDistance = MAX_DIST;
  controls.minDistance = A_U * 1.006;
  controls.zoomSpeed = 1.0;
  controls.screenSpacePanning = true;

  // The wheel zooms only once the globe has been clicked or touched (or with Ctrl/Cmd held, which is
  // also what a trackpad pinch sends). Otherwise the page scrolls as usual and a hint appears briefly,
  // so a reader scrolling down the lesson is not trapped by the globe.
  let wheelArmed = false, hintTimer = 0;
  controls.enableZoom = false;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const zoomHint = document.createElement('div');
  zoomHint.className = 'globe3d-hint';
  zoomHint.textContent = 'Click the globe, then scroll to zoom (or hold Ctrl and scroll)';
  zoomHint.hidden = true;
  container.appendChild(zoomHint);
  const onArm = () => { wheelArmed = true; controls.enableZoom = true; zoomHint.hidden = true; };
  const onDisarm = () => { wheelArmed = false; controls.enableZoom = false; };
  const onWheelGate = (e) => {
    const ok = wheelArmed || e.ctrlKey || e.metaKey;
    controls.enableZoom = ok;
    if (ok) { zoomHint.hidden = true; return; }
    zoomHint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { zoomHint.hidden = true; }, 1600);
  };
  container.addEventListener('pointerdown', onArm, true);
  container.addEventListener('pointerleave', onDisarm);
  container.addEventListener('wheel', onWheelGate, { capture: true, passive: true });

  function updateMinDistance() {
    controls.minDistance = Math.max(0.03, A_U * 1.006 - controls.target.length());
  }

  let anim = null;
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function slerpDir(a, b, t) {
    const q = new THREE.Quaternion().setFromUnitVectors(a, b);
    return a.clone().applyQuaternion(new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), q, t));
  }
  function flyTo(target, camPos, animate) {
    if (animate) {
      anim = { t0: performance.now(), dur: 900, ft: controls.target.clone(), tt: target.clone(), fc: camera.position.clone(), tc: camPos.clone() };
      controls.minDistance = 0;
    } else {
      anim = null;
      controls.target.copy(target);
      camera.position.copy(camPos);
      updateMinDistance();
      controls.update();
    }
    requestRender();
  }
  function stepAnim(now) {
    const t = Math.min(1, (now - anim.t0) / anim.dur), e = easeInOut(t);
    controls.target.lerpVectors(anim.ft, anim.tt, e);
    const r0 = anim.fc.length(), r1 = anim.tc.length();
    const dir = r0 > 1e-9 && r1 > 1e-9 ? slerpDir(anim.fc.clone().normalize(), anim.tc.clone().normalize(), e) : anim.tc.clone().normalize();
    camera.position.copy(dir.multiplyScalar(r0 + (r1 - r0) * e));
    camera.lookAt(controls.target);
    if (t >= 1) { anim = null; updateMinDistance(); controls.update(); return false; }
    return true;
  }

  /** Oblique camera position: along the outward radial at `target`, tilted toward the south (looking north). */
  function obliqueCamera(target, dist, tiltDeg) {
    let n = target.clone();
    if (n.lengthSq() < 1e-12) n = camera.position.clone();
    n.normalize();
    const north = new V3(0, 0, 1).addScaledVector(n, -n.z);
    if (north.lengthSq() < 1e-8) north.set(-1, 0, 0);
    north.normalize();
    const t = tiltDeg * D2R;
    const dir = n.multiplyScalar(Math.cos(t)).addScaledVector(north, -Math.sin(t)).normalize();
    const cam = target.clone().addScaledVector(dir, dist);
    const minR = surfR(cam) * 1.004;
    if (cam.length() < minR) cam.setLength(minR);
    return cam;
  }

  function lookAt(args = {}) {
    if (disposed) return;
    const p = toVec(args.ecef);
    if (!p) return;
    const dist = Math.min(MAX_DIST, Math.max(0.03, (args.distance == null ? 3.0e6 : +args.distance || 3.0e6) * S));
    flyTo(p, obliqueCamera(p, dist, 35), args.animate !== false);
  }

  function fit(points, args = {}) {
    if (disposed) return;
    const vs = (points || []).map(toVec).filter(Boolean);
    if (!vs.length) { resetView(args); return; }
    const c = new V3();
    vs.forEach((v) => c.add(v));
    c.multiplyScalar(1 / vs.length);
    let r = 0;
    vs.forEach((v) => { r = Math.max(r, v.distanceTo(c)); });
    r = Math.max(r, 0.15);
    const vfov = FOV * D2R, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    let dist = (r * 1.25) / Math.sin(Math.min(vfov, hfov) / 2);
    dist = Math.min(dist, MAX_DIST);
    if (c.length() < 0.5 * A_U) {
      // points spread around the globe → look at the whole Earth from the current direction
      const target = new V3();
      const d = Math.max(dist, A_U * 3.2);
      flyTo(target, camera.position.clone().normalize().multiplyScalar(Math.min(MAX_DIST, d)), args.animate !== false);
      return;
    }
    flyTo(c, obliqueCamera(c, dist, 20), args.animate !== false);
  }

  function resetView(args = {}) {
    if (disposed) return;
    const dir = new V3(...nvec(25, -55));
    flyTo(new V3(), dir.multiplyScalar(3.4 * A_U), args.animate !== false);
  }

  // ── render loop (on demand) ──
  let rafId = 0, lastTime = 0;
  function requestRender() {
    if (disposed) return;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  const tmpV = new V3();
  function occluded(camPos, p) {
    // segment camera→p hits a sphere slightly smaller than the Earth's polar radius?
    const R = WGS84_B * S * 0.996;
    const d = tmpV.copy(p).sub(camPos);
    const L = d.length();
    if (L < 1e-9) return false;
    d.multiplyScalar(1 / L);
    const b = camPos.dot(d), cc = camPos.lengthSq() - R * R;
    const disc = b * b - cc;
    if (disc <= 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < L;
  }

  function preRender() {
    // keep the camera above the surface
    const cr = camera.position.length(), minR = surfR(camera.position) * 1.003;
    if (cr < minR) camera.position.setLength(minR);
    // adaptive clipping planes (depth precision near the surface)
    const alt = Math.max(0, camera.position.length() - WGS84_B * S);
    const toTarget = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.0005, Math.min(alt * 0.1, toTarget * 0.3, 2));
    camera.far = camera.position.length() + 60;
    camera.updateProjectionMatrix();
    // gentler rotation when close to the surface with the target at the Earth centre
    if (controls.target.length() < 1) {
      const d = toTarget;
      controls.rotateSpeed = Math.max(0.04, Math.min(1, ((d - A_U) / d) * 1.6));
    } else controls.rotateSpeed = 0.8;
    // billboard visibility
    const cam = camera.position;
    scene.traverse((o) => {
      if (!o.isSprite || !o.userData.anchor) return;
      o.visible = (!o.userData.isLabel || state.labels) && !occluded(cam, o.userData.anchor);
    });
  }

  function tick(now) {
    rafId = 0;
    if (disposed) return;
    const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
    lastTime = now;
    let more = false;
    if (anim) more = stepAnim(now);
    else if (controls.update()) more = true;
    preRender();
    if (typeof api.onFrame === 'function') {
      try { api.onFrame(dt); } catch (e) { console.error('globe3d onFrame:', e); }
    }
    renderer.render(scene, camera);
    if (more && !rafId) rafId = requestAnimationFrame(tick);
    if (!rafId) lastTime = 0;
  }

  const onControlChange = () => requestRender();
  const onControlStart = () => { if (anim) { anim = null; updateMinDistance(); } requestRender(); };
  controls.addEventListener('change', onControlChange);
  controls.addEventListener('start', onControlStart);
  controls.addEventListener('end', onControlChange);

  // ── resize ──
  function resize() {
    if (disposed) return;
    const w = Math.max(1, container.clientWidth || width);
    if (w === width && canvas.style.height === height + 'px') return;
    width = w;
    renderer.setSize(width, height, false);
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    scene.traverse((o) => {
      if (o.isSprite && o.userData.px) updateSpriteScale(o);
      if (o.material && o.material.isLineMaterial) lineResolution(o.material);
    });
    requestRender();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container);
  const onWinResize = () => {
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    width = -1; resize();
  };
  window.addEventListener('resize', onWinResize);

  // ── theme ──
  let themePending = false;
  function refreshTheme() {
    themePending = false;
    if (disposed) return;
    cssCache.clear();
    readTheme();
    clearTextures();
    earthMat.color.set(theme.ocean);
    gridMat.color.set(theme.grid);
    gridMajorMat.color.set(theme.grid);
    if (landMat) landMat.color.set(theme.land);
    applyBackground();
    // re-apply data layers so CSS-variable colours re-resolve
    setEmitter(state.emitter);
    setEstimate(state.estimate);
    setSatellites(state.sats);
    [...polyArgs].forEach(([k, v]) => setPolylines(k, v));
    [...meshArgs].forEach(([k, v]) => setMesh(k, v));
    [...ellArgs].forEach(([k, v]) => setEllipsoid(k, v));
    requestRender();
  }
  const scheduleTheme = () => { if (!themePending && !disposed) { themePending = true; requestAnimationFrame(refreshTheme); } };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq) (mq.addEventListener ? mq.addEventListener('change', scheduleTheme) : mq.addListener(scheduleTheme));
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleTheme) : null;
  if (mo) {
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  }

  // ── dispose ──
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (ro) ro.disconnect();
    if (mo) mo.disconnect();
    if (mq) (mq.removeEventListener ? mq.removeEventListener('change', scheduleTheme) : mq.removeListener(scheduleTheme));
    window.removeEventListener('resize', onWinResize);
    controls.removeEventListener('change', onControlChange);
    controls.removeEventListener('start', onControlStart);
    controls.removeEventListener('end', onControlChange);
    clearTimeout(hintTimer);
    container.removeEventListener('pointerdown', onArm, true);
    container.removeEventListener('pointerleave', onDisarm);
    container.removeEventListener('wheel', onWheelGate, true);
    zoomHint.remove();
    controls.dispose();
    scene.traverse((o) => {
      if (o.isSprite) { disposeMaterial(o.material); return; }
      if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
      if (o.material) disposeMaterial(o.material);
    });
    if (unitSphere) unitSphere.dispose();
    clearTextures();
    scene.clear();
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch { /* ignore */ }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    polyGroups.clear(); polyArgs.clear(); meshObjs.clear(); meshArgs.clear(); ellObjs.clear(); ellArgs.clear();
    api.onFrame = null;
  }

  const api = {
    setEmitter, setEstimate, setSatellites, setPolylines, setMesh, setEllipsoid,
    setLabelsVisible, lookAt, fit, resetView, requestRender, dispose,
    onFrame: null,  };

  resetView({ animate: false });
  requestRender();
  return api;
}
