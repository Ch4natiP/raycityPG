/* ECU part-number catalogue: dump size, start address and checksum byte (file offset, 8-bit sum-to-zero).
 * Small-bike Keihin rows come from a shop's reference sheet shown in a HondaECU read tutorial,
 * plus file-name conventions ("_4000-FFFF", "0-DFEF") and offsets confirmed from paired original/tuned files.
 * checksum: null = file has no 8-bit sum byte the flasher expects us to fix (large ECUs: the flash tool computes its own).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Catalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const K = (part, model, kb, start, checksum, src = 'sheet') => ({ part, model, kb, start, checksum, src });
  const ROWS = [
    K('38770-K03-H01', 'Wave 110i', 64, 0x8000, null), K('38770-K03-T61', 'Wave 110i', 48, 0x4000, 0x9FFE),
    K('38770-K58-T81', 'Wave 110i', 64, 0x8000, null), K('38770-K58-TC0', 'Wave 110i', 64, 0x8000, null),
    K('38770-K58-TC1', 'Wave 110i', 64, 0x8000, null), K('38770-K58-TC2', 'Wave 110i', 64, 0x8000, null),
    K('38770-KWW-601', 'Wave 110i', 56, 0x0000, 0x7FEF), K('38770-KWW-642', 'Dream 110i', 48, 0x4000, 0x9FFE),
    K('38770-KWW-643', 'Dream 110i', 48, 0x4000, 0x9FFE), K('38770-KZV-A61', 'Dream 110i', 64, 0x8000, null),
    K('38770-KZV-T61', 'Dream 110i', 48, 0x4000, 0x9FFE), K('38770-K73-T32', 'Wave 125i', 64, 0x8000, null),
    K('38770-K73-T61', 'Wave 125i', 64, 0x8000, null), K('38770-K76-T61', 'Dream 110i', 64, 0x8000, null),
    K('38770-K76-T62', 'Dream 110i', 64, 0x8000, null), K('38770-KYL-T01', 'Wave 125i', 56, 0x0000, 0x7FEF),
    K('38770-KYZ-T03', 'Wave 125i', 48, 0x4000, 0x9FFE), K('38770-KYZ-T41', 'Wave 125i', 64, 0x8000, null),
    K('38770-K26-901', 'MSX 125i', 48, 0x4000, 0x9FFE), K('38770-K26-911', 'MSX 125i', 48, 0x4000, 0x9FFE),
    K('38770-K26-B02', 'MSX 125i', 64, 0x8000, null),
    K('38770-KVB-T03', 'Click 110i', 56, 0x0000, 0xDFEF, 'files'), K('38770-KVB-S53', 'Click 110i', 48, 0x4000, 0x9FFE, 'files'),
    K('38770-K20-901', 'Zoomer-X 110i', 48, 0x4000, 0x9FFE, 'files'),
    K('30400-K60F-T01', 'Click 125i (2014-2015)', 384, 0, null, 'xdf'), K('30400-K60S-T71', 'Click 125i (2016-2017)', 384, 0, null, 'xdf'),
    K('30400-K59K-T11', 'Click 150i (2018-2020)', 384, 0, null, 'xdf'), K('30400-K2SF-T01', 'Click 160', 256, 0, null, 'files'),
    K('30400-K36F-T01', 'PCX 150 (2014-2015)', 384, 0, null, 'xdf'), K('30400-K36S-T31', 'PCX 150 (2016-2017)', 384, 0, null, 'xdf'),
    K('30400-K1ZF-T01', 'PCX 160 (2020-2021)', 384, 0, null, 'xdf'), K('30400-K0WF-T01', 'ADV 150 (2017-2019)', 384, 0, null, 'xdf'),
    K('30400-K97F-T01', 'PCX/ADV', 384, 0, null, 'xdf'), K('30400-K20J-T21', 'Zoomer-X (2015-2017)', 256, 0, null, 'xdf'),
    K('30400-K2TA-T02', 'Lead 125 4V (2022)', 256, 0, null, 'files'), K('30400-K3MF-T01', 'Giorno 125', 256, 0, null, 'files'),
    K('30400-K2F-T01', 'Scoopy-i', 256, 0, null, 'files'),
  ];
  // internal ECU id (first 5 bytes of diagnostic table 0x00) → part number. From Zar file names and a real K60S read.
  const ID = {
    '0101D00D01': '30400-K60F-T01', '01030A0D01': '30400-K60S-T71', '0103070D01': '30400-K59K-T11',
    '01037C0D01': '30400-K0WF-T01', '0103D00D01': '30400-K1ZF-T01', '0103CF0D01': '30400-K1ZF-T11',
    '0101FF0D01': '30400-K20J-T21', '0101990D01': '30400-K36F-T01', '0102180D01': '30400-K36S-T31',
    '0104780D01': '30400-K2TA-T02',
  };
  /** identify a model from the ECU id bytes read on connect (array or hex string) */
  function matchId(bytes) {
    const hex = Array.isArray(bytes) ? bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('') : String(bytes).replace(/[^0-9a-f]/gi, '').toUpperCase();
    const key = hex.slice(0, 10);
    const part = ID[key]; if (!part) return null;
    return ROWS.find(r => r.part === part) || null;
  }
  const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  /** best catalogue row for a file name or ECU id text (matches "K73-T32", "38770K73T32", …) */
  function match(text) {
    const t = norm(text);
    let best = null;
    for (const r of ROWS) {
      const core = norm(r.part.replace(/^(38770|30400)-/, ''));
      if (t.includes(core) && (!best || core.length > best.core)) best = { ...r, core: core.length };
    }
    if (best) return best;
    const m = String(text).match(/(?:^|[^0-9A-F])([0-9A-F]{4})-([0-9A-F]{4})(?:[^0-9A-F]|$)/i);   // "4000-FFFF" style range in file names
    return null;
  }
  /** checksum byte hinted by a file name such as "0-DFEF" or "4000 FFFF 9FFE" */
  function nameChecksum(name) {
    const m = String(name).match(/(?:^|[ _-])(?:0|4000|8000)[ _-]+([0-9A-F]{4})(?:[ _.-]|$)/i);
    if (m && /^[79D]FE[EF]$|^9FFE$/i.test(m[1])) return parseInt(m[1], 16);
    const z = String(name).match(/\b(9FFE|7FEF|DFEF)\b/i);
    return z ? parseInt(z[1], 16) : null;
  }
  return { ROWS, ID, match, matchId, nameChecksum };
});
