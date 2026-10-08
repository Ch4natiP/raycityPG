import struct, sys

def find_geoms(d):
    out = []
    o = 0
    while o + 30 < len(d):
        try:
            bb = struct.unpack_from('<6f', d, o)
            n = struct.unpack_from('<H', d, o + 24)[0]
        except struct.error:
            break
        mn, mx = bb[:3], bb[3:]
        if 3 <= n < 20000 and all(-50 < mn[i] <= mx[i] < 50 for i in range(3)) and any(mx[i] - mn[i] > 0.01 for i in range(3)):
            p = o + 26
            end = p + 12 * n
            if end + 2 <= len(d) and struct.unpack_from('<H', d, end)[0] == n:
                pos = [struct.unpack_from('<3f', d, p + 12 * i) for i in range(n)]
                tol = 1e-3
                if all(mn[k] - tol <= v[k] <= mx[k] + tol for v in pos for k in range(3)):
                    out.append((o, n))
                    o = end
                    continue
        o += 1
    return out

for fn in sys.argv[1:]:
    d = open(fn, 'rb').read()
    print('==', fn, len(d))
    for o, n in find_geoms(d):
        p = o + 26 + 12 * n + 2 + 12 * n  # after normals
        tail = d[p:p + 12].hex(' ')
        print(f'  geom @0x{o:x} verts={n} after-normals: {tail}')
