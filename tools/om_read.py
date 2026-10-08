import struct, sys
sys.path.insert(0, 'tools')
from om_probe import find_geoms

def read_geom(d):
    o, n = find_geoms(d)[0]
    p = o + 26
    pos = [struct.unpack_from('<3f', d, p + 12 * i) for i in range(n)]
    p += 12 * n
    assert struct.unpack_from('<H', d, p)[0] == n
    p += 2
    nrm = [struct.unpack_from('<3f', d, p + 12 * i) for i in range(n)]
    p += 12 * n
    c = struct.unpack_from('<H', d, p)[0]; p += 2
    assert c == 0, c
    m = struct.unpack_from('<H', d, p)[0]; p += 2
    uv = [struct.unpack_from('<2f', d, p + 8 * i) for i in range(m)]
    p += 8 * m
    ni = struct.unpack_from('<H', d, p)[0]; p += 2
    idx = struct.unpack_from(f'<{ni}H', d, p); p += 2 * ni
    return dict(start=o, pos=pos, nrm=nrm, uv=uv, idx=idx, end=p)

if __name__ == '__main__':
    for fn in sys.argv[1:]:
        d = open(fn, 'rb').read()
        g = read_geom(d)
        print(fn, 'verts', len(g['pos']), 'uv', len(g['uv']), 'idx', len(g['idx']), 'end', g['end'], 'filesize', len(d), 'max idx', max(g['idx']))
