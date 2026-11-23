/* Honda PGM-FI K-line diagnostic protocol (Keihin ECUs, 2008+ scooters/bikes)
 *
 * Frame:   [type] [len] [data...] [checksum]
 *   len      = total frame length in bytes (type + len + data + checksum)
 *   checksum = (-(sum of all previous bytes)) & 0xFF   (so the whole frame sums to 0)
 * Request types:  0x72 (diagnostic), 0xFE (wake-up ping)
 * Reply type:     0x02 (to 0x72), 0x0E/0xFE echo variants seen on some ECUs
 *
 * Sequence (10400 baud, 8N1):
 *   1. K-line low 70 ms, high 130 ms             (wake-up)
 *   2. FE 04 72 8C                               (ping; ECU may not answer)
 *   3. 72 05 00 F0 99   -> 02 04 00 FA           (enter diagnostic mode)
 *   4. 72 05 71 <table> <cs> -> 02 <len> 71 <table> <data...> <cs>
 *
 * Table layouts come from community reverse engineering (HondaECU project and
 * forum logs) and vary between ECU families — every decoded value is shown next
 * to its raw byte so it can be checked against a known-good scan tool.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Honda = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BAUD = 10400;

  function checksum(bytes) {
    let s = 0;
    for (const b of bytes) s = (s + b) & 0xFF;
    return (0x100 - s) & 0xFF;
  }

  // checksum8bitHonda (== `checksum` above) and checksum8bit are the two sums the Keihin K-line
  // flash protocol uses. Both verified against the open-source HondaECU project (eculib/honda.py, GPLv3).
  function checksum8bit(data) {
    let s = 0; for (const b of data) s = (s + b) & 0xFFFFFFFF;
    return (0xFF - (((s - 1) >> 8) & 0xFF)) & 0xFF;
  }
  const STR = s => Array.from(s, c => c.charCodeAt(0));

  function frame(type, data) {
    const body = [type, data.length + 3, ...data];
    return Uint8Array.from([...body, checksum(body)]);
  }

  const CMD = {
    ping: () => frame(0xFE, [0x72]),
    init: () => frame(0x72, [0x00, 0xF0]),
    readTable: t => frame(0x72, [0x71, t & 0xFF]),
    dtcCurrent: page => frame(0x72, [0x74, page & 0xFF]),
    dtcPast: page => frame(0x72, [0x73, page & 0xFF]),
    clearDtc: () => frame(0x72, [0x60, 0x03]),
    // ---- Keihin flash (HondaECU protocol). READ is safe; the rest erase/write the ECU. ----
    /** flash read: mtype 82 82 00, data = [A23..16, A7..0, A15..8, len] (format_read), 3-byte header reply */
    readFlash: (addr, n) => frame3([0x82, 0x82, 0x00], [(addr >> 16) & 255, addr & 255, (addr >> 8) & 255, n & 255]),
    /** enter write mode (sends "PGM-FI") */
    initWrite: () => [[1, 1, 1], [1, 1, 2], [1, 1, 3], [1, 2, ...STR('PGM')], [1, 3, ...STR('-FI')]].map(d => frame(0x7D, d)),
    /** recover a half-written (bricked) ECU */
    initRecover: () => [[0, 1, 1], [0, 1, 2], [0, 1, 3], [0, 2, 0x76, 0x03, 0x17], [0, 3, 0x75, 0x05, 0x13]].map(d => frame(0x7B, d)),
    /** erase flash */
    erase: () => [[1, 2], [1, 3, 0, 0], [1, 0x0B, 0, 0, 0, 0xFF, 0xFF, 0xFF], [1, 0x0E, 1, 0x90], [1, 1, 1], [1, 4, 0xFF]].map(d => frame(0x7E, d)),
    eraseStatus: () => frame(0x7E, [1, 5]),
    eraseDone: () => frame(0x7E, [1, 1, 0]),
    /** write one 128-byte page. offWords/nextWords are 16-byte-word offsets (byteOffset/16). */
    writePage: (offWords, data, nextWords) => {
      const x = [(offWords >> 8) & 255, offWords & 255, ...data, (nextWords >> 8) & 255, nextWords & 255];
      return frame(0x7E, [1, 6, ...x, checksum8bit(x), checksum(x)]);
    },
    /** finalize + verify write; ECU replies 0x0F to the last when ok */
    postWrite: () => [[1, 9], [1, 0x0A], [1, 0x0C], [1, 0x0D]].map(d => frame(0x7E, d)),
  };
  /** 3-byte-mtype frame (the flash-read command) */
  function frame3(mtype, data) {
    const body = [...mtype, mtype.length + 2 + data.length, ...data];
    return Uint8Array.from([...body, checksum(body)]);
  }

  /** Pulls complete, checksum-valid frames out of a byte buffer.
   *  Returns { frames: Uint8Array[], rest: number[] }. Bytes that cannot start a frame are dropped. */
  function parseStream(buf, hdr = 1) {
    const frames = [];
    let i = 0;
    while (i + hdr + 1 <= buf.length) {
      const len = buf[i + hdr];
      if (len < hdr + 2 || len > 255) { i++; continue; }
      if (i + len > buf.length) break;           // wait for more bytes
      const f = buf.slice(i, i + len);
      let s = 0; for (const b of f) s = (s + b) & 0xFF;
      if (s === 0) { frames.push(Uint8Array.from(f)); i += len; }
      else i++;                                   // resync
    }
    return { frames, rest: buf.slice(i) };
  }

  const u16 = (d, i) => (d[i] << 8) | d[i + 1];
  const v5 = b => +(b * 5 / 256).toFixed(2);

  /** Table 0x11 — most common live-data table (Wave 110i/125i, Click, PCX, Scoopy-i, MSX, CBR150/250…). */
  const TABLE_11 = [
    { key: 'rpm',   name: 'รอบเครื่อง',      unit: 'rpm', at: 0, len: 2, conv: (d, i) => u16(d, i), max: 12000 },
    { key: 'tpsV',  name: 'TPS (โวลต์)',      unit: 'V',   at: 2, conv: (d, i) => v5(d[i]) },
    { key: 'tps',   name: 'ลิ้นเร่ง TPS',      unit: '%',   at: 3, conv: (d, i) => +(d[i] / 1.6).toFixed(1), max: 100 },
    { key: 'ectV',  name: 'ECT (โวลต์)',      unit: 'V',   at: 4, conv: (d, i) => v5(d[i]) },
    { key: 'ect',   name: 'อุณหภูมิเครื่อง',   unit: '°C',  at: 5, conv: (d, i) => d[i] - 40, max: 130 },
    { key: 'iatV',  name: 'IAT (โวลต์)',      unit: 'V',   at: 6, conv: (d, i) => v5(d[i]) },
    { key: 'iat',   name: 'อุณหภูมิอากาศ',    unit: '°C',  at: 7, conv: (d, i) => d[i] - 40, max: 80 },
    { key: 'mapV',  name: 'MAP (โวลต์)',      unit: 'V',   at: 8, conv: (d, i) => v5(d[i]) },
    { key: 'map',   name: 'แรงดันท่อไอดี',     unit: 'kPa', at: 9, conv: (d, i) => d[i], max: 110 },
    { key: 'batt',  name: 'แบตเตอรี่',         unit: 'V',   at: 12, conv: (d, i) => +(d[i] / 10).toFixed(1), max: 16 },
    { key: 'speed', name: 'ความเร็ว',          unit: 'km/h', at: 13, conv: (d, i) => d[i], max: 160 },
    { key: 'inj',   name: 'เวลาฉีด',           unit: 'ms',  at: 14, len: 2, conv: (d, i) => +(u16(d, i) / 1000 * 4).toFixed(2), max: 20 },
    { key: 'ign',   name: 'องศาไฟจุดระเบิด',   unit: '°',   at: 16, conv: (d, i) => +(d[i] / 2 - 64).toFixed(1), max: 60 },
  ];

  /** Table 0x20/0x21 on some ECUs carries O2 sensor + STFT. */
  const TABLE_20 = [
    { key: 'o2V',   name: 'O2 เซนเซอร์',      unit: 'V',   at: 0, conv: (d, i) => +(d[i] / 256 * 1.25).toFixed(3), max: 1.25 },
    { key: 'stft',  name: 'Fuel trim',         unit: '%',   at: 1, conv: (d, i) => +((d[i] - 128) / 128 * 100).toFixed(1) },
  ];

  const TABLES = { 0x11: TABLE_11, 0x20: TABLE_20 };

  /** reply: frame 02 LEN 71 TT data... CS  →  { table, data, values[] } */
  function decodeTableReply(f) {
    if (!f || f[0] !== 0x02 || f[2] !== 0x71) return null;
    const table = f[3];
    const data = Array.from(f.slice(4, f.length - 1));
    const layout = TABLES[table] || [];
    const values = [];
    for (const fld of layout) {
      const n = fld.len || 1;
      if (fld.at + n > data.length) continue;
      values.push({ ...fld, value: fld.conv(data, fld.at), raw: data.slice(fld.at, fld.at + n) });
    }
    return { table, data, values };
  }

  /** DTC page reply: 02 LEN 74|73 PAGE  m1 s1 m2 s2 m3 s3 ... CS  → ['12-1', '7-1'] */
  function decodeDtcReply(f) {
    if (!f || f[0] !== 0x02 || (f[2] !== 0x74 && f[2] !== 0x73)) return null;
    const out = [];
    const d = f.slice(4, f.length - 1);
    for (let i = 0; i + 1 < d.length; i += 2) if (d[i]) out.push(`${d[i]}-${d[i + 1]}`);
    return out;
  }

  /** Honda MIL blink / DTC codes (common to most PGM-FI small bikes). */
  const DTC_TEXT = {
    '1-1': 'MAP sensor วงจรแรงดันต่ำ', '1-2': 'MAP sensor วงจรแรงดันสูง', '2-1': 'MAP sensor ทำงานผิดปกติ',
    '7-1': 'ECT เซนเซอร์อุณหภูมิเครื่อง แรงดันต่ำ', '7-2': 'ECT เซนเซอร์อุณหภูมิเครื่อง แรงดันสูง',
    '8-1': 'TPS เซนเซอร์ลิ้นเร่ง แรงดันต่ำ', '8-2': 'TPS เซนเซอร์ลิ้นเร่ง แรงดันสูง',
    '9-1': 'IAT เซนเซอร์อุณหภูมิอากาศ แรงดันต่ำ', '9-2': 'IAT เซนเซอร์อุณหภูมิอากาศ แรงดันสูง',
    '11-1': 'VS เซนเซอร์ความเร็ว', '12-1': 'หัวฉีด (Injector) วงจรผิดปกติ', '21-1': 'O2 เซนเซอร์',
    '23-1': 'ฮีตเตอร์ O2 เซนเซอร์', '29-1': 'IACV วาล์วควบคุมรอบเดินเบา', '33-2': 'ECU EEPROM ผิดปกติ',
    '41-1': 'Gyro / Bank angle sensor', '52-1': 'CKP เซนเซอร์เพลาข้อเหวี่ยง', '54-1': 'Bank angle sensor แรงดันต่ำ',
    '54-2': 'Bank angle sensor แรงดันสูง', '86-1': 'วงจรสัญญาณไฟ MIL', '91-1': 'Ignition coil',
  };

  return { BAUD, checksum, checksum8bit, frame, frame3, STR, CMD, parseStream, decodeTableReply, decodeDtcReply, TABLES, DTC_TEXT };
});
