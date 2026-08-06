"""Generate the compact Smart Coop base and lid STL exports.

No CAD application is required for these exports. Dimensions match
smart_coop_enclosure.scad; keep that file as the editable source of truth.
"""
from math import cos, sin, pi, sqrt
from pathlib import Path
from struct import pack

ROOT = Path(__file__).resolve().parent.parent


class Mesh:
    def __init__(self):
        self.triangles = []

    def tri(self, a, b, c):
        ux, uy, uz = (b[i] - a[i] for i in range(3))
        vx, vy, vz = (c[i] - a[i] for i in range(3))
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = sqrt(nx * nx + ny * ny + nz * nz) or 1
        self.triangles.append(((nx / length, ny / length, nz / length), a, b, c))

    def box(self, x0, x1, y0, y1, z0, z1):
        v = [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),
             (x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
        for a,b,c,d in ((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):
            self.tri(v[a],v[b],v[c]); self.tri(v[a],v[c],v[d])

    def annular_boss(self, x, y, z0, z1, outer, inner, steps=32):
        for i in range(steps):
            a, b = 2*pi*i/steps, 2*pi*(i+1)/steps
            ooa=(x+outer*cos(a),y+outer*sin(a)); oob=(x+outer*cos(b),y+outer*sin(b))
            oia=(x+inner*cos(a),y+inner*sin(a)); oib=(x+inner*cos(b),y+inner*sin(b))
            p=[(ooa[0],ooa[1],z0),(oob[0],oob[1],z0),(oob[0],oob[1],z1),(ooa[0],ooa[1],z1),
               (oia[0],oia[1],z0),(oib[0],oib[1],z0),(oib[0],oib[1],z1),(oia[0],oia[1],z1)]
            for q in ((0,1,2,3),(4,7,6,5),(3,2,6,7),(0,4,5,1)):
                self.tri(p[q[0]],p[q[1]],p[q[2]]); self.tri(p[q[0]],p[q[2]],p[q[3]])

    def circular_hole_corners(self, x, y, radius, z0, z1, steps=12):
        """Fill the four square corners around a circular void with curved patches."""
        arcs = [
            ((x+radius, y+radius), pi/2, 0),
            ((x-radius, y+radius), pi, pi/2),
            ((x-radius, y-radius), -pi/2, -pi),
            ((x+radius, y-radius), 0, -pi/2),
        ]
        for corner, start, end in arcs:
            points = [corner]
            for i in range(steps + 1):
                a = start + (end-start)*i/steps
                points.append((x + radius*cos(a), y + radius*sin(a)))
            # Fan-fill the top and bottom of this patch; its inner edge is a true circle.
            for i in range(1, len(points)-1):
                a=(points[0][0],points[0][1],z1); b=(points[i][0],points[i][1],z1); c=(points[i+1][0],points[i+1][1],z1)
                self.tri(a,b,c)
                self.tri((a[0],a[1],z0),(c[0],c[1],z0),(b[0],b[1],z0))
            for i in range(len(points)):
                a=points[i]; b=points[(i+1) % len(points)]
                self.tri((a[0],a[1],z0),(b[0],b[1],z0),(b[0],b[1],z1))
                self.tri((a[0],a[1],z0),(b[0],b[1],z1),(a[0],a[1],z1))

    def write(self, path):
        with open(path, "wb") as f:
            f.write(b"Smart Coop compact enclosure - units: millimetres (mm)".ljust(80, b"\0"))
            f.write(pack("<I", len(self.triangles)))
            for normal, a, b, c in self.triangles:
                f.write(pack("<12fH", *normal, *a, *b, *c, 0))


# Outside 104 x 78 x 30; 1.8 wall and 1.6 floor.
def base():
    m = Mesh()
    m.box(-52, 52, -39, 39, 0, 1.6)
    # Left side ventilation: four 2 mm × 10 mm slots, protected by solid top/bottom rails.
    m.box(-52, -50.2, -39, 39, 1.6, 10)
    m.box(-52, -50.2, -39, 39, 20, 30)
    for y0, y1 in ((-39, -26), (-24, -18), (-16, -10), (-8, -2), (0, 39)):
        m.box(-52, -50.2, y0, y1, 10, 20)
    m.box(50.2, 52, -39, 39, 1.6, 30)
    # KCD1 snap-in rocker switch front cutout: 19.2 x 13.2 mm.
    # Standard nominal cutout is 19 x 13 mm; 0.2 mm extra accommodates FDM shrinkage.
    m.box(-50.2, 50.2, -39, -37.2, 1.6, 8.4)
    m.box(-50.2, 50.2, -39, -37.2, 21.6, 30)
    m.box(-50.2, 13.4, -39, -37.2, 8.4, 21.6)
    m.box(32.6, 50.2, -39, -37.2, 8.4, 21.6)
    # Solid rear wall: the former large cable opening has been removed.
    m.box(-50.2, 50.2, 37.2, 39, 1.6, 30)
    for x in (-47, 47):
        for y in (-34, 34):
            m.annular_boss(x, y, 1.6, 30, 3.1, 1.2)
    m.box(-17.6, -16.4, -37.2, 37.2, 1.6, 6.6)
    return m


# A 1.6 mm lid with a 30.5 mm display opening, sensor apertures, and locating skirt.
def lid():
    m = Mesh()
    # The tiled plate leaves real apertures (including the fastener holes) in the STL.
    holes = [
        (9.75, 40.25, -15.25, 15.25),    # 1088AS / MAX7219 8x8 display
    ]
    circles = [
        (-28, 0, 11.75),  # HC-SR501 PIR lens: Ø23.5 mm
        (-30, 24, 2.75),  # LDR: Ø5.5 mm
        (-5, 27, 2.7),    # red 5 mm LED: Ø5.4 mm FDM clearance
        (4, 27, 2.7),     # green 5 mm LED: Ø5.4 mm FDM clearance
    ]
    # Nine circular Ø2.5 mm sound ports above the display form a buzzer grille.
    for x in (16, 21, 26):
        for y in (22, 27, 32):
            circles.append((x, y, 1.25))
    for x in (-47, 47):
        for y in (-34, 34):
            circles.append((x, y, 1.45))  # M2.5 screw: Ø2.9 mm clearance
    # Reserve each circular hole's bounding square, then fill its four outer corners
    # with curved mesh patches. This produces genuine round openings in the STL.
    holes.extend((x-r, x+r, y-r, y+r) for x,y,r in circles)
    xs = sorted({-52, 52, *[v for h in holes for v in h[:2]]})
    ys = sorted({-39, 39, *[v for h in holes for v in h[2:]]})
    for x0, x1 in zip(xs, xs[1:]):
        for y0, y1 in zip(ys, ys[1:]):
            cx, cy = (x0+x1)/2, (y0+y1)/2
            if not any(a < cx < b and c < cy < d for a,b,c,d in holes):
                m.box(x0, x1, y0, y1, 0, 1.6)
    for x, y, r in circles:
        m.circular_hole_corners(x, y, r, 0, 1.6)
    # 5 mm-tall skirt, 0.25 mm clearance to base inner walls.
    m.box(-49.95, -48.15, -36.95, 36.95, -5, 0)
    m.box(48.15, 49.95, -36.95, 36.95, -5, 0)
    m.box(-48.15, 48.15, -36.95, -35.15, -5, 0)
    m.box(-48.15, 48.15, 35.15, 36.95, -5, 0)
    return m


base().write(ROOT / "coop_enclosure_BASE.stl")
lid().write(ROOT / "coop_lid_v4_corrected.stl")
print("Wrote compact base and lid STL files")
