// Turn raw OpenStreetMap data (Overpass JSON from tools/fetch-osm.mjs or overpass-turbo) into the
// compact city file the game reads: roads as a graph, building outlines with heights, parks, water,
// the BTS viaduct and stations, named places to drive to.
//   node tools/osm-import.mjs data/osm-siam-silom.json data/city-siam-silom.json
// Map data © OpenStreetMap contributors, ODbL 1.0.
import fs from 'fs';

const [inFile = 'data/osm-siam-silom.json', outFile = 'data/city-siam-silom.json'] = process.argv.slice(2);
const osm = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const els = osm.elements || [];
const nodesById = new Map();
for (const el of els) if (el.type === 'node') nodesById.set(el.id, el);

// ---- projection: metres east (x) and south (z) of the middle of the data ----
let latMin = Infinity; let latMax = -Infinity; let lonMin = Infinity; let lonMax = -Infinity;
for (const el of els) {
  const pts = el.type === 'node' ? [el] : el.geometry || [];
  for (const p of pts) { if (!p) continue; latMin = Math.min(latMin, p.lat); latMax = Math.max(latMax, p.lat); lonMin = Math.min(lonMin, p.lon); lonMax = Math.max(lonMax, p.lon); }
}
const lat0 = (latMin + latMax) / 2;
const lon0 = (lonMin + lonMax) / 2;
const MX = 111320 * Math.cos((lat0 * Math.PI) / 180);
const MZ = 110574;
const P = (lat, lon) => ({ x: (lon - lon0) * MX, z: -(lat - lat0) * MZ });
const r1 = (v) => Math.round(v * 10) / 10;

const names = [];
const nameIdx = new Map();
const nm = (t) => { if (!t) return -1; if (!nameIdx.has(t)) { nameIdx.set(t, names.length); names.push(t); } return nameIdx.get(t); };
const thaiName = (tags = {}) => tags['name:th'] || tags.name || tags['name:en'] || '';

// ---- roads ----
const ROAD = {
  motorway: { main: true, perDir: 3 }, trunk: { main: true, perDir: 3 }, primary: { main: true, perDir: 3 },
  secondary: { main: true, perDir: 2 }, tertiary: { main: false, perDir: 1, wide: true },
  motorway_link: { main: true, perDir: 1 }, trunk_link: { main: true, perDir: 1 }, primary_link: { main: true, perDir: 1 },
  secondary_link: { main: false, perDir: 1 }, tertiary_link: { main: false, perDir: 1 },
  unclassified: { main: false, perDir: 1, soi: true }, residential: { main: false, perDir: 1, soi: true }, living_street: { main: false, perDir: 1, soi: true, narrow: true },
};
const LANE = 3.3;
const roadWays = els.filter((el) => el.type === 'way' && ROAD[el.tags?.highway] && el.nodes?.length >= 2 && el.tags.area !== 'yes' && !(el.tags.layer < 0) && el.tags.tunnel !== 'yes');
// skip elevated expressways (they are toll roads above the streets)
const ground = roadWays.filter((w) => !(w.tags.highway === 'motorway' || (w.tags.bridge === 'yes' && Number(w.tags.layer || 1) >= 2)));

const use = new Map();
for (const w of ground) w.nodes.forEach((id, k) => { use.set(id, (use.get(id) || 0) + (k === 0 || k === w.nodes.length - 1 ? 2 : 1)); });
const coord = (id, w, k) => { const n = nodesById.get(id); if (n) return P(n.lat, n.lon); const g = w.geometry?.[k]; return g ? P(g.lat, g.lon) : null; };

const gNodes = [];         // [x, z, signal]
const gIndex = new Map();  // osm id → graph node index
const gEdges = [];
const gnode = (id, p) => { if (!gIndex.has(id)) { gIndex.set(id, gNodes.length); gNodes.push([r1(p.x), r1(p.z), 0]); } return gIndex.get(id); };

for (const w of ground) {
  const t = w.tags;
  const cls = ROAD[t.highway];
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
  const ids = oneway === -1 ? [...w.nodes].reverse() : w.nodes;
  const geomIdx = oneway === -1 ? (k) => w.nodes.length - 1 - k : (k) => k;
  if (oneway === -1) oneway = 1;
  const lanesTag = parseInt(t.lanes, 10);
  const perDir = lanesTag > 0 ? (oneway ? lanesTag : Math.max(1, Math.floor(lanesTag / 2))) : cls.perDir;
  const median = cls.main && !oneway && perDir >= 2 ? 2 : 0;
  const width = cls.narrow ? 5 : cls.soi ? 6.6 : oneway ? perDir * LANE + 1.2 : perDir * 2 * LANE + median + 1;
  const lanes = [];
  if (oneway) for (let k = 0; k < perDir; k++) lanes.push(r1((k - (perDir - 1) / 2) * LANE));
  else for (let k = 0; k < perDir; k++) lanes.push(r1(median / 2 + (cls.soi ? 1.65 : LANE / 2 + 0.2) + k * LANE));
  const name = nm(thaiName(t));
  let start = 0;
  let pts = [];
  for (let k = 0; k < ids.length; k++) {
    const p = coord(ids[k], w, geomIdx(k));
    if (!p) continue;
    pts.push(r1(p.x), r1(p.z));
    const split = k === ids.length - 1 || (k > 0 && (use.get(ids[k]) || 0) >= 2);
    if (split && pts.length >= 4) {
      const a = gnode(ids[start], { x: pts[0], z: pts[1] });
      const b = gnode(ids[k], { x: pts[pts.length - 2], z: pts[pts.length - 1] });
      if (a !== b) gEdges.push({ a, b, w: r1(width), oneway, main: cls.main ? 1 : 0, name, lanes, median, pts });
      start = k;
      pts = [r1(p.x), r1(p.z)];
    }
  }
}

// keep the biggest connected network (stray bits of road can't be driven to)
{
  const parent = gNodes.map((_, k) => k);
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  for (const e of gEdges) parent[find(e.a)] = find(e.b);
  const size = new Map();
  for (let k = 0; k < gNodes.length; k++) size.set(find(k), (size.get(find(k)) || 0) + 1);
  const big = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const keep = gNodes.map((_, k) => find(k) === big);
  const remap = new Map();
  const nodes2 = [];
  gNodes.forEach((n, k) => { if (keep[k]) { remap.set(k, nodes2.length); nodes2.push(n); } });
  const edges2 = gEdges.filter((e) => keep[e.a] && keep[e.b]).map((e) => ({ ...e, a: remap.get(e.a), b: remap.get(e.b) }));
  gNodes.length = 0; gNodes.push(...nodes2);
  gEdges.length = 0; gEdges.push(...edges2);
  for (const [id, k] of [...gIndex.entries()]) { if (remap.has(k)) gIndex.set(id, remap.get(k)); else gIndex.delete(id); }
}

// traffic signals: on the junction itself, or on its approaches (then the junction gets them)
const degree = new Array(gNodes.length).fill(0);
for (const e of gEdges) { degree[e.a]++; degree[e.b]++; }
for (const el of els) {
  if (el.type !== 'node' || el.tags?.highway !== 'traffic_signals') continue;
  const p = P(el.lat, el.lon);
  let best = -1; let bd = 30;
  gNodes.forEach((n, k) => { if (degree[k] < 3) return; const d = Math.hypot(n[0] - p.x, n[1] - p.z); if (d < bd) { bd = d; best = k; } });
  if (best >= 0) gNodes[best][2] = 1;
}

// ---- areas ----
const ring = (w) => {
  const g = w.geometry || [];
  const pts = g.filter(Boolean).map((q) => P(q.lat, q.lon));
  if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.5) pts.pop();
  // drop points that add nothing (closer than 0.5 m or on a straight line)
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const a = out[out.length - 1]; const b = pts[k]; const c = pts[(k + 1) % pts.length];
    if (a && Math.hypot(b.x - a.x, b.z - a.z) < 0.5) continue;
    if (a) { const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); if (Math.abs(cross) < 0.15) continue; }
    out.push(b);
  }
  return out;
};
const area = (pts) => { let s = 0; for (let k = 0; k < pts.length; k++) { const a = pts[k]; const b = pts[(k + 1) % pts.length]; s += a.x * b.z - b.x * a.z; } return s / 2; };
const flat = (pts) => pts.flatMap((p) => [r1(p.x), r1(p.z)]);

const buildings = [];
for (const w of els) {
  if (w.type !== 'way' || !w.tags?.building || ['roof', 'construction', 'no'].includes(w.tags.building)) continue;
  if (Number(w.tags.layer) < 0 || w.tags['building:part']) continue;
  let pts = ring(w);
  if (pts.length < 3) continue;
  if (area(pts) < 0) pts = pts.reverse(); // counter-clockwise (seen from above with z south)
  const A = Math.abs(area(pts));
  if (A < 12) continue;
  let h = parseFloat(w.tags.height);
  const lv = parseFloat(w.tags['building:levels']);
  if (!(h > 0)) h = lv > 0 ? lv * 3.3 + 1 : 0; // 0 = let the game choose from the footprint
  const kind = { apartments: 1, commercial: 2, retail: 3, office: 2, hotel: 2, temple: 4, religious: 4, house: 5, school: 6, university: 6, hospital: 6 }[w.tags.building] || 0;
  buildings.push([r1(h), kind, ...flat(pts)]);
}

const green = [];
const water = [];
for (const w of els) {
  if (w.type !== 'way' || !w.tags) continue;
  const t = w.tags;
  if (/^(park|garden|pitch)$/.test(t.leisure || '') || /^(grass|recreation_ground|cemetery)$/.test(t.landuse || '')) { const pts = ring(w); if (pts.length >= 3) green.push(flat(pts)); }
  if (t.natural === 'water') { const pts = ring(w); if (pts.length >= 3) water.push(flat(pts)); }
}
const canals = els.filter((w) => w.type === 'way' && /^(canal|river)$/.test(w.tags?.waterway || '')).map((w) => flat((w.geometry || []).filter(Boolean).map((q) => P(q.lat, q.lon))));

// ---- BTS viaduct (elevated light rail) and stations ----
const rail = els.filter((w) => w.type === 'way' && /^(light_rail|monorail)$/.test(w.tags?.railway || '') && (w.tags.bridge || Number(w.tags.layer) >= 1) && !/MRT|subway/i.test(w.tags.name || '')).map((w) => [nm(thaiName(w.tags)), ...flat((w.geometry || []).filter(Boolean).map((q) => P(q.lat, q.lon)))]);
const stations = [];
const seenSt = new Set();
for (const el of els) {
  if (el.type !== 'node' || !el.tags) continue;
  const t = el.tags;
  if (!(t.railway === 'station' || t.railway === 'halt' || t.public_transport === 'station')) continue;
  const name = thaiName(t);
  if (!name || seenSt.has(name)) continue;
  seenSt.add(name);
  const p = P(el.lat, el.lon);
  const sys = /BTS/i.test(t.network || t.operator || t.name || '') || t.station === 'light_rail' ? 'BTS' : /MRT|subway/i.test(t.network || t.operator || '') || t.station === 'subway' ? 'MRT' : 'rail';
  stations.push([r1(p.x), r1(p.z), nm(name), sys]);
}

// ---- named places to drive to ----
const WANT = {
  amenity: /^(restaurant|cafe|fast_food|bank|pharmacy|hospital|clinic|school|university|college|place_of_worship|police|post_office|cinema|theatre|marketplace|bar|pub|fuel|food_court|library|community_centre)$/,
  tourism: /^(hotel|attraction|museum|guest_house|hostel|gallery|viewpoint)$/,
  leisure: /^(park|fitness_centre|sports_centre|stadium)$/,
  shop: /./,
};
const LANDMARK = (t) => t.tourism === 'attraction' || t.tourism === 'museum' || t.shop === 'mall' || t.shop === 'department_store' || /^(hospital|university|place_of_worship|marketplace|cinema)$/.test(t.amenity || '') || t.leisure === 'park' || t.leisure === 'stadium';
const pois = [];
for (const el of els) {
  const t = el.tags;
  if (!t || !thaiName(t) || t.highway || t.building === 'yes' && !t.amenity && !t.shop && !t.tourism) continue;
  const ok = Object.entries(WANT).some(([k, re]) => t[k] && re.test(t[k]));
  if (!ok) continue;
  let p;
  if (el.type === 'node') p = P(el.lat, el.lon);
  else if (el.geometry?.length) { const pts = el.geometry.filter(Boolean).map((q) => P(q.lat, q.lon)); p = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, z: pts.reduce((s, q) => s + q.z, 0) / pts.length }; } else continue;
  pois.push([r1(p.x), r1(p.z), nm(thaiName(t)), LANDMARK(t) ? 1 : 0]);
}
const places = els.filter((el) => el.type === 'node' && /^(suburb|quarter|neighbourhood)$/.test(el.tags?.place || '')).map((el) => { const p = P(el.lat, el.lon); return [r1(p.x), r1(p.z), nm(thaiName(el.tags))]; });

const out = {
  meta: { source: inFile, lat0, lon0, attribution: '© OpenStreetMap contributors (ODbL)' },
  names,
  nodes: gNodes,
  edges: gEdges.map((e) => [e.a, e.b, e.w, e.oneway, e.main, e.name, e.lanes, e.median, e.pts]),
  buildings, green, water, canals, rail, stations, pois, places,
};
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${outFile}: ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB · ${gNodes.length} junctions, ${gEdges.length} roads (${gNodes.filter((n) => n[2]).length} with signals), ${buildings.length} buildings, ${green.length} parks, ${water.length} water, ${rail.length} BTS track pieces, ${stations.length} stations, ${pois.length} places, ${places.length} area names`);
