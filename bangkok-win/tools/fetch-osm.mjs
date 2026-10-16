// Download real Bangkok streets from OpenStreetMap (Overpass API) for the game.
//   node tools/fetch-osm.mjs                 → Siam – Silom (default)
//   node tools/fetch-osm.mjs S W N E name    → any box, e.g. 13.722 100.523 13.751 100.547 siam-silom
// Writes data/osm-<name>.json (raw Overpass output). Then run tools/osm-import.mjs on it.
// Map data © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright
import fs from 'fs';

const [s = 13.722, w = 100.523, n = 13.751, e = 100.547, name = 'siam-silom'] = process.argv.slice(2);
const bbox = `${s},${w},${n},${e}`;
const query = `[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bbox});
  node["highway"="traffic_signals"](${bbox});
  way["building"](${bbox});
  way["leisure"~"^(park|garden|pitch)$"](${bbox});
  way["landuse"~"^(grass|recreation_ground|cemetery)$"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"~"^(canal|river)$"](${bbox});
  way["railway"~"^(light_rail|monorail|rail|subway)$"](${bbox});
  node["railway"~"^(station|halt)$"](${bbox});
  node["public_transport"="station"](${bbox});
  node["name"]["amenity"](${bbox});
  node["name"]["shop"](${bbox});
  node["name"]["tourism"](${bbox});
  node["name"]["leisure"](${bbox});
  way["name"]["amenity"](${bbox});
  way["name"]["shop"="mall"](${bbox});
  way["name"]["tourism"](${bbox});
  node["place"~"^(suburb|quarter|neighbourhood)$"](${bbox});
);
out body geom;`;

const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let ok = false;
for (const url of servers) {
  try {
    console.log(`asking ${url} for ${bbox} …`);
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(`data/osm-${name}.json`, text);
    console.log(`data/osm-${name}.json: ${(text.length / 1e6).toFixed(1)} MB`);
    ok = true;
    break;
  } catch (err) {
    console.log(`  failed: ${err.message}`);
  }
}
if (!ok) {
  console.log('\nCould not reach Overpass. You can also paste the query below into https://overpass-turbo.eu,');
  console.log(`run it, choose Export → "raw OSM data" and save it as data/osm-${name}.json:\n\n${query}\n`);
  process.exit(1);
}
