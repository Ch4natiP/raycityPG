// Map layout: a grid of city blocks with roads on the grid lines.
// Units are metres, Y is up, north is -Z (top of the minimap).
// Thailand drives on the LEFT: a vehicle heading along f=(fx,fz) keeps to (fz,-fx).

export const N = 10;            // blocks per side
export const BLOCK = 100;       // node-to-node distance
export const HALF = (N * BLOCK) / 2;
export const SIDEWALK = 3.2;    // sidewalk ring inside every block
export const CURB = 0.18;       // sidewalk height

export const nodeX = (i) => i * BLOCK - HALF;
export const isMain = (i) => i % 5 === 0;
export const roadW = (i) => (isMain(i) ? 26 : 14);
export const MEDIAN = 3;        // main roads have a raised median

// Lane centre offsets from the road centre line (to the left of travel).
export const laneOffsets = (i) => (isMain(i) ? [MEDIAN / 2 + 1.85, MEDIAN / 2 + 5.55, MEDIAN / 2 + 9.25] : [3.4]);

// The BTS skytrain runs above this east-west main road.
export const BTS_ROW = 5;
export const BTS_Y = 10;

// Districts: the map is cut into 3x3 areas.
export const DISTRICTS = [
  ['จตุจักร', 'อนุสาวรีย์ชัยฯ', 'รัชดา'],
  ['ข้าวสาร', 'สยาม', 'สุขุมวิท'],
  ['เยาวราช', 'สีลม', 'คลองเตย'],
];
export const districtOf = (x, z) => {
  const a = Math.min(2, Math.max(0, Math.floor(((x + HALF) / (N * BLOCK)) * 3)));
  const b = Math.min(2, Math.max(0, Math.floor(((z + HALF) / (N * BLOCK)) * 3)));
  return DISTRICTS[b][a];
};

// Road names: north-south roads (x = const) and east-west roads (z = const).
export const NS_ROADS = ['ถ.จักรพงษ์', 'ถ.ราชดำเนิน', 'ถ.หลานหลวง', 'ถ.บรรทัดทอง', 'ถ.อังรีดูนังต์', 'ถ.พญาไท', 'ถ.ราชดำริ', 'ถ.วิทยุ', 'ถ.นานาเหนือ', 'ถ.อโศกมนตรี', 'ถ.รัชดาภิเษก'];
export const EW_ROADS = ['ถ.พหลโยธิน', 'ถ.วิภาวดีรังสิต', 'ถ.ราชวิถี', 'ถ.ศรีอยุธยา', 'ถ.เพชรบุรี', 'ถ.พระราม 1 / สุขุมวิท', 'ถ.เพลินจิต', 'ถ.สาทร', 'ถ.สีลม', 'ถ.เยาวราช', 'ถ.พระราม 4'];

export const BTS_STATIONS = [
  { block: 1, name: 'สนามกีฬาแห่งชาติ' },
  { block: 3, name: 'สยาม' },
  { block: 6, name: 'ชิดลม' },
  { block: 8, name: 'อโศก' },
];

// Block x/z range (inside the road edges).
export function blockRect(bi, bj) {
  return {
    x0: nodeX(bi) + roadW(bi) / 2,
    x1: nodeX(bi + 1) - roadW(bi + 1) / 2,
    z0: nodeX(bj) + roadW(bj) / 2,
    z1: nodeX(bj + 1) - roadW(bj + 1) / 2,
  };
}

// Seeded random so the city is the same every time.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DIRS = [
  [0, -1], // 0 north
  [1, 0],  // 1 east
  [0, 1],  // 2 south
  [-1, 0], // 3 west
];

// Bikes the player can own. speed in m/s, accel in m/s^2.
export const BIKES = [
  { id: 'wave', name: 'รถครอบครัว 110cc', price: 0, level: 1, top: 22, accel: 6.5, grip: 1.0, color: 0xc81e1e },
  { id: 'scoot', name: 'สกู๊ตเตอร์ 160cc', price: 1500, level: 3, top: 27, accel: 8, grip: 1.1, color: 0x1f4fbf },
  { id: 'sport', name: 'สปอร์ต 250cc', price: 4500, level: 6, top: 34, accel: 10, grip: 1.2, color: 0x16a34a },
  { id: 'big', name: 'บิ๊กไบค์ 650cc', price: 12000, level: 10, top: 42, accel: 12.5, grip: 1.3, color: 0x111111 },
];
