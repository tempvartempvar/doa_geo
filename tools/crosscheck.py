"""Independent high-precision cross-check of the JS TDOA/FDOA physics engine.

Reads tools/reference.json (written by `node tools/dump_reference.mjs`), recomputes every quantity
from the written specification with mpmath at 50 significant digits, prints a comparison table and
exits non-zero if any check fails its tolerance.

Nothing here is transcribed from the JS: the light-time equation is solved by fixed-point iteration
at 50 digits and the received-frequency ratio is obtained by numerically differentiating that solver
(5-point central difference of te(t_r), truncation ~1e-27, roundoff ~1e-42).
"""
import json
import os
import sys

try:
    import mpmath as mp
except ImportError:  # pragma: no cover
    sys.exit("mpmath is required (no fallback implemented); it ships with sympy / pip install mpmath")

mp.mp.dps = 50
# Where the local vertical and ellipsoidal height of a MOVING emitter are evaluated: at its position at
# the emission instant (default, the spec as written) or frozen at its position at t0 (--up-at-t0).
UP_MODE = "t0" if "--up-at-t0" in sys.argv else "te"
mpf = mp.mpf
HERE = os.path.dirname(os.path.abspath(__file__))
REF = json.load(open(os.path.join(HERE, "reference.json")))

# ---------------------------------------------------------------- constants (from the spec, exact decimals)
C = mpf(299792458)
GM = mpf("3.986004418e14")
OM = mpf("7.292115e-5")
A_E = mpf(6378137)
F_E = 1 / mpf("298.257223563")
E2 = F_E * (2 - F_E)
J2 = mpf("1.08262668e-3")
W0 = mpf("62636856.0")
R_MEAN = mpf(6371000)
# The JS works with radians derived from Math.PI; inputs in reference.json are already radians.

# sanity: constants in the JSON equal the spec
for k, v in {"C": C, "GM": GM, "OMEGA_E": OM, "A": A_E, "J2": J2, "W0": W0, "R_MEAN": R_MEAN}.items():
    assert mpf(REF["constants"][k]) == mp.mpf(float(v)), k


def ulp(x):
    """Spacing of IEEE doubles at |x|."""
    x = abs(mpf(x))
    if x == 0:
        return mpf(2) ** -1074
    return mpf(2) ** (mp.floor(mp.log(x, 2)) - 52)


def V(x):
    return [mpf(c) for c in x]


def add(a, b): return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
def sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def scl(a, s): return [a[0] * s, a[1] * s, a[2] * s]
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def norm(a): return mp.sqrt(dot(a, a))
def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def rotz(ang, v):
    c, s = mp.cos(ang), mp.sin(ang)
    return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]


# ---------------------------------------------------------------- geodesy
def geod2ecef(lat, lon, h):
    sl, cl = mp.sin(lat), mp.cos(lat)
    N = A_E / mp.sqrt(1 - E2 * sl * sl)
    return [(N + h) * cl * mp.cos(lon), (N + h) * cl * mp.sin(lon), (N * (1 - E2) + h) * sl]


def ecef2geod(r):
    """Exact inversion by Newton iteration on (lat, h) at 50 digits (independent of any closed form)."""
    x, y, z = r
    p = mp.sqrt(x * x + y * y)
    lon = mp.atan2(y, x)
    lat = mp.atan2(z, p * (1 - E2))
    h = mpf(0)
    for _ in range(100):
        sl, cl = mp.sin(lat), mp.cos(lat)
        N = A_E / mp.sqrt(1 - E2 * sl * sl)
        # residuals of p = (N+h) cos lat, z = (N(1-e2)+h) sin lat ; solve for (lat, h) by Newton
        fp = (N + h) * cl - p
        fz = (N * (1 - E2) + h) * sl - z
        dN = A_E * E2 * sl * cl / (1 - E2 * sl * sl) ** mpf(1.5)
        J = [[dN * cl - (N + h) * sl, cl], [dN * (1 - E2) * sl + (N * (1 - E2) + h) * cl, sl]]
        det = J[0][0] * J[1][1] - J[0][1] * J[1][0]
        dlat = (fp * J[1][1] - fz * J[0][1]) / det
        dh = (J[0][0] * fz - J[1][0] * fp) / det
        lat -= dlat
        h -= dh
        if abs(dlat) < mpf(10) ** -45 and abs(dh) < mpf(10) ** -38:
            break
    return lat, lon, h


GEO_CACHE = {}


def up_vec(lat, lon):
    return [mp.cos(lat) * mp.cos(lon), mp.cos(lat) * mp.sin(lon), mp.sin(lat)]


# ---------------------------------------------------------------- Kepler
def kepler(el, t):
    a, e, inc, raan, argp, M0 = (mpf(el[k]) for k in ("a", "e", "i", "raan", "argp", "M0"))
    n = mp.sqrt(GM / a ** 3)
    M = M0 + n * t
    E = M if e < 0.8 else mp.pi
    for _ in range(200):
        d = (E - e * mp.sin(E) - M) / (1 - e * mp.cos(E))
        E -= d
        if abs(d) < mpf(10) ** -48:
            break
    b = mp.sqrt(1 - e * e)
    x, y = a * (mp.cos(E) - e), a * b * mp.sin(E)
    Ed = n / (1 - e * mp.cos(E))
    xd, yd = -a * mp.sin(E) * Ed, a * b * mp.cos(E) * Ed
    # perifocal -> inertial: R3(-raan) R1(-i) R3(-argp)
    def rot(v):
        v = rotz(argp, v)
        v = [v[0], mp.cos(inc) * v[1] - mp.sin(inc) * v[2], mp.sin(inc) * v[1] + mp.cos(inc) * v[2]]
        return rotz(raan, v)
    return rot([x, y, mpf(0)]), rot([xd, yd, mpf(0)])


# ---------------------------------------------------------------- measurement model
class Geometry:
    """Positions of emitter and collectors in the frame selected by the model."""

    def __init__(self, sc, model):
        self.sc, self.model = sc, model
        em = sc["emitter"]
        self.p0 = V(em["ecef"])
        self.ve = V(em["velEcef"])
        self.f0 = mpf(em["f0"])
        self.inertial = (not model["retarded"]) or model["earthRotation"]
        self.env = sc["env"]

    def emitter_ecef(self, t, t0):
        return add(self.p0, scl(self.ve, t - t0))

    def emitter(self, t, t0):
        p = self.emitter_ecef(t, t0)
        if self.inertial:
            v = add(self.ve, cross([0, 0, OM], p))
            return rotz(OM * t, p), rotz(OM * t, v)
        return p, list(self.ve)

    def collector(self, i, t):
        r, v = kepler(self.sc["elements"][i], t)
        if self.inertial:
            return r, v
        re = rotz(-OM * t, r)
        ve = sub(rotz(-OM * t, v), cross([0, 0, OM], re))
        return re, ve

    def up(self, te, t0, up_mode):
        up_mode = up_mode or UP_MODE
        # local vertical: ellipsoid normal at the emitter (position at te, or at t0 for comparison)
        p = self.emitter_ecef(te if up_mode == "te" else t0, t0)
        key = tuple(mp.nstr(c, 45) for c in p)
        if key not in GEO_CACHE:
            GEO_CACHE[key] = ecef2geod(p)
        lat, lon, h = GEO_CACHE[key]
        u = up_vec(lat, lon)
        return (rotz(OM * te, u) if self.inertial else u), h

    def excess(self, re, rc, te, t0, up_mode=None):
        """Excess paths (tropo, iono, shapiro) and elevation for a chord re -> rc."""
        m = self.model
        d = sub(rc, re)
        rho = norm(d)
        u, h = self.up(te, t0, up_mode)
        sel = dot(d, u) / rho
        el = mp.asin(sel)
        tro = ion = sha = mpf(0)
        if m["troposphere"]:
            tp = self.env["tropo"]
            Z = mpf(tp["zhd"]) * mp.exp(-h / 8000) + mpf(tp["zwd"]) * mp.exp(-h / 2000)
            tro = Z * mpf("1.001") / mp.sqrt(mpf("0.002001") + sel * sel)
        if m["ionosphere"]:
            ip = self.env["iono"]
            shell = mpf(ip["shellKm"]) * 1000
            q = R_MEAN * mp.cos(el) / (R_MEAN + shell)
            ion = mpf("40.308") * mpf(ip["vtec"]) * mpf(10) ** 16 / self.f0 ** 2 / mp.sqrt(1 - q * q)
        if m["shapiro"]:
            a, b = norm(re), norm(rc)
            sha = 2 * GM / C ** 2 * mp.log((a + b + rho) / (a + b - rho))
        return dict(rho=rho, el=el, tropo=tro, iono=ion, shapiro=sha,
                    group=tro + ion + sha, phase=tro - ion + sha)


TOL_IT = mpf(10) ** -46


def solve_backward(G, i, tr, t0, kind, up_mode=None):
    """te such that tr - te = (|r_i(tr) - r_e(te)| + X)/c."""
    rc, _ = G.collector(i, tr)
    te = tr
    for _ in range(100):
        re, _ = G.emitter(te, t0)
        x = G.excess(re, rc, te, t0, up_mode)
        new = tr - (x["rho"] + x[kind]) / C
        if abs(new - te) < TOL_IT:
            te = new
            break
        te = new
    return te


def solve_forward(G, i, te, t0, kind, up_mode=None):
    re, _ = G.emitter(te, t0)
    tr = te
    for _ in range(100):
        rc, _ = G.collector(i, tr)
        x = G.excess(re, rc, te, t0, up_mode)
        new = te + (x["rho"] + x[kind]) / C
        if abs(new - tr) < TOL_IT:
            tr = new
            break
        tr = new
    return tr


def d5(f, x, h):
    return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h)


def clock_rate(r, v):
    rm = norm(r)
    s = r[2] / rm
    q = A_E / rm
    U = GM / rm * (1 - J2 * q * q * (3 * s * s - 1) / 2)
    return 1 + (W0 - U) / C ** 2 - dot(v, v) / (2 * C ** 2)


def sagnac(pe, pc):
    return OM / C ** 2 * (pe[0] * pc[1] - pe[1] * pc[0])


def observe(sc, model, t0, up_mode=None):
    G = Geometry(sc, model)
    n = len(sc["elements"])
    t0 = mpf(t0)
    H = mpf("1e-6")
    out = []
    if model["retarded"]:
        te = solve_backward(G, 0, t0, t0, "group", up_mode)
        for i in range(n):
            tr = t0 if i == 0 else solve_forward(G, i, te, t0, "group", up_mode)
            re, ve = G.emitter(te, t0)
            rc, vc = G.collector(i, tr)
            x = G.excess(re, rc, te, t0, up_mode)
            nvec = scl(sub(rc, re), 1 / x["rho"])
            # exact ratio: derivative of emission time wrt reception time on the carrier-phase path
            D = d5(lambda t: solve_backward(G, i, t, t0, "phase", up_mode), tr, H)
            # total rate of the phase excess path per unit emission time along the wavefront sequence
            def xp(tt):
                trr = solve_forward(G, i, tt, t0, "phase", up_mode)
                a, _ = G.emitter(tt, t0)
                b, _ = G.collector(i, trr)
                return G.excess(a, b, tt, t0, up_mode)["phase"]
            xdot = d5(xp, te, H) if (model["troposphere"] or model["ionosphere"] or model["shapiro"]) else mpf(0)
            first = 1 - (dot(nvec, vc) - dot(nvec, ve)) / C - xdot / C
            out.append(dict(te=te, tr=tr, delay=tr - te, re=re, rc=rc, vc=vc, ve=ve, x=x, n=nvec,
                            Dexact=D, Dfirst=first, xdot=xdot))
    else:
        for i in range(n):
            re, ve = G.emitter(t0, t0)
            rc, vc = G.collector(i, t0)
            x = G.excess(re, rc, t0, t0, up_mode)
            nvec = scl(sub(rc, re), 1 / x["rho"])

            def xp(tt):
                a, _ = G.emitter(tt, t0)
                b, _ = G.collector(i, tt)
                return G.excess(a, b, tt, t0, up_mode)["phase"]
            xdot = d5(xp, t0, H) if (model["troposphere"] or model["ionosphere"] or model["shapiro"]) else mpf(0)
            D = (1 - dot(nvec, vc) / C) / (1 - dot(nvec, ve) / C + xdot / C)
            first = 1 - (dot(nvec, vc) - dot(nvec, ve)) / C - xdot / C
            out.append(dict(te=t0, tr=t0, delay=(x["rho"] + x["group"]) / C, re=re, rc=rc, vc=vc, ve=ve, x=x,
                            n=nvec, Dexact=D, Dfirst=first, xdot=xdot))
    for o in out:
        D = o["Dexact"] if model["dopplerExact"] else o["Dfirst"]
        if model["properTimeLO"]:
            # proper time uses the INERTIAL state at reception
            r, v = kepler(sc["elements"][out.index(o)], o["tr"])
            D = D / clock_rate(r, v)
        o["ratio"] = D
    if model["retarded"]:
        tdoa = [o["tr"] - out[0]["tr"] for o in out]
    else:
        tdoa = [o["delay"] - out[0]["delay"] for o in out]
    fdoa = [G.f0 * (o["ratio"] - out[0]["ratio"]) for o in out]
    return dict(G=G, cols=out, tdoa=tdoa, fdoa=fdoa)


# ---------------------------------------------------------------- comparison bookkeeping
ROWS = {}
INFO = []


class Check:
    """Tracks the worst |JS - reference| as a fraction of the (possibly per-sample) tolerance."""

    def __init__(self, name, tol):
        self.name, self.tol = name, mpf(tol)
        self.frac, self.diff, self.rel, self.n, self.where = mpf(-1), mpf(0), mpf(0), 0, ""

    def add(self, js, ref, where="", tol=None):
        t = self.tol if tol is None else mpf(tol)
        d = abs(mpf(js) - ref)
        self.n += 1
        if d / t > self.frac:
            self.frac, self.diff, self.where = d / t, d, where
            self.rel = d / abs(ref) if ref != 0 else mpf(0)


def ck(name, tol):
    if name not in ROWS:
        ROWS[name] = Check(name, tol)
    return ROWS[name]


def report():
    print(f"{'check':52s} {'n':>4s} {'worst|diff|':>11s} {'rel':>8s} {'tol':>8s} {'margin':>8s} result  worst at")
    bad = 0
    for r in ROWS.values():
        ok = r.frac <= 1
        bad += (not ok) and not r.name.startswith("(info)")
        margin = "inf" if r.frac == 0 else mp.nstr(1 / r.frac, 3)
        print(f"{r.name:52s} {r.n:4d} {mp.nstr(r.diff, 3):>11s} {mp.nstr(r.rel, 2):>8s} {mp.nstr(r.tol, 2):>8s} "
              f"{margin:>8s} {'PASS' if ok else ('info' if r.name.startswith('(info)') else 'FAIL')}    {r.where}")
    return bad


TS = mpf("1e-15")
ABER, SAG, ANALYTIC = [], [], []


def analytic_ratio(G, co, t0):
    """Closed-form dte/dtr = (1 - n.v_i/c - dXp/dtr|partial/c) / (1 - n.v_e/c + dXp/dte|partial/c),
    from implicit differentiation of F(te,tr) = tr - te - (|r_i(tr) - r_e(te)| + Xp)/c = 0,
    with the partial derivatives of Xp taken numerically. Used only to confirm the numerical derivative."""
    te, tr, h = co["te"], co["tr"], mpf("1e-6")
    i = co["i"]

    def X(a, b):
        re, _ = G.emitter(a, t0)
        rc, _ = G.collector(i, b)
        return G.excess(re, rc, a, t0)["phase"]
    Xa = d5(lambda a: X(a, tr), te, h)
    Xb = d5(lambda b: X(te, b), tr, h)
    n_, vc, ve = co["n"], co["vc"], co["ve"]
    return (1 - dot(n_, vc) / C - Xb / C) / (1 - dot(n_, ve) / C + Xa / C)


print("computing reference solutions at", mp.mp.dps, "digits; moving-emitter vertical evaluated at", UP_MODE, flush=True)
for sc in REF["scenarios"]:
    for run in sc["runs"]:
        mname, sw = run["model"], run["switches"]
        t0 = mpf(run["t0"])
        tag = f"{sc['name']} t={run['t0']}"
        R = observe(sc, sw, run["t0"])
        G = R["G"]
        fscale = G.f0 / mpf(10) ** 9
        P = f"[{mname}] "
        if mname == "full":
            tte = R["cols"][0]["te"]
            ck(P + "emission time te (s; tol max(1e-15, ulp(te)))", TS).add(run["te"], tte, tag, tol=max(TS, ulp(tte)))
        for i, (cj, co) in enumerate(zip(run["collectors"], R["cols"])):
            co["i"] = i
            w = f"{tag} #{i}"
            ck(P + "delay (s)", TS).add(cj["delay"], co["delay"], w)
            ck(P + "TDOA (s)", TS).add(run["tdoa"][i], R["tdoa"][i], w)
            ck(P + "ratio f_i/f0", "2e-15").add(run["ratio"][i], co["ratio"], w)
            ck(P + "FDOA (Hz; tol 1e-5 x f0/1GHz)", "1e-5").add(run["fdoa"][i], R["fdoa"][i], w, tol=mpf("1e-5") * fscale)
            ck(P + "elevation (rad)", "1e-12").add(cj["elevation"], co["x"]["el"], w)
            ck(P + "range (m)", "1e-7").add(cj["range"], co["x"]["rho"], w)
            if mname == "full":
                for k in ("tropo", "iono", "shapiro"):
                    ck(f"{P}{k} group path (m; tol c*1e-15)", C * TS).add(cj[k], co["x"][k], w)
                ck(P + "phaseRate dXp/dte (m/s; tol 2e-15*c)", 2 * C * TS).add(cj["phaseRate"], co["xdot"], w)
                rc, vc = kepler(sc["elements"][i], co["tr"])
                re_ = rotz(-OM * co["tr"], rc)
                ve_ = sub(rotz(-OM * co["tr"], vc), cross([0, 0, OM], re_))
                for k in range(3):
                    ck(P + "rEci at reception (m)", "1e-7").add(cj["rEci"][k], rc[k], w)
                    ck(P + "vEci at reception (m/s)", "1e-9").add(cj["vEci"][k], vc[k], w)
                    ck(P + "rEcef at reception (m)", "1e-7").add(cj["rEcef"][k], re_[k], w)
                    ck(P + "vEcef at reception (m/s)", "1e-9").add(cj["vEcef"][k], ve_[k], w)
                pe = G.emitter_ecef(co["te"], t0)
                ck(P + "sagnac field (s)", TS).add(cj["sagnac"], sagnac(pe, re_), w)
                ck(P + "rangeRate = n.(v_i - v_e) (m/s)", "1e-9").add(cj["rangeRate"], dot(co["n"], sub(co["vc"], co["ve"])), w)
                ANALYTIC.append((w, analytic_ratio(G, co, t0) - co["Dexact"]))
                # aberration: elevation from the ECEF chord (air rest frame) instead of the ECI chord
                lat, lon, h = ecef2geod(pe)
                el_ecef = mp.asin(dot(sub(re_, pe), up_vec(lat, lon)) / norm(sub(re_, pe)))
                tp = sc["env"]["tropo"]
                Z = mpf(tp["zhd"]) * mp.exp(-h / 8000) + mpf(tp["zwd"]) * mp.exp(-h / 2000)
                m = lambda e: Z * mpf("1.001") / mp.sqrt(mpf("0.002001") + mp.sin(e) ** 2)
                ABER.append((w, el_ecef - co["x"]["el"], (m(el_ecef) - m(co["x"]["el"])) / C))
                if any(sc["emitter"]["velEcef"]):
                    R2 = observe(sc, sw, run["t0"], up_mode="t0")
                    c2 = R2["cols"][i]
                    INFO.append(f"{w}: vertical/height taken at emitter(t0) instead of emitter(te): "
                                f"d(delay)={mp.nstr(c2['delay'] - co['delay'], 3)} s, d(ratio)={mp.nstr(c2['ratio'] - co['ratio'], 3)}, "
                                f"d(el)={mp.nstr(c2['x']['el'] - co['x']['el'], 3)} rad")
            if mname in ("noRetard", "noRotation", "firstOrder"):
                ck(P + "phaseRate (m/s; tol 2e-15*c)", 2 * C * TS).add(cj["phaseRate"], co["xdot"], w)
            if mname == "properTime":
                rc, vc = kepler(sc["elements"][i], co["tr"])
                ck(P + "clockRate field (dtau/dt)", "2e-15").add(cj["clockRate"], clock_rate(rc, vc), w)
            if mname == "vacuum":
                pe = G.emitter_ecef(co["te"], t0)
                re_ = rotz(-OM * co["tr"], co["rc"])
                SAG.append((w, sagnac(pe, re_), co["delay"] - norm(sub(re_, pe)) / C - sagnac(pe, re_)))
    print("  done", sc["name"], flush=True)

# ---------------------------------------------------------------- geodesy
for g in REF["geod"]:
    lat, lon, h = mpf(g["lat"]), mpf(g["lon"]), mpf(g["h"])
    w = f"lat={mp.nstr(lat * 180 / mp.pi, 8)} h={g['h']}"
    ex = geod2ecef(lat, lon, h)
    for k in range(3):
        ck("geodeticToEcef (m)", "1e-7").add(g["ecef"][k], ex[k], w)
    la, lo, hh = ecef2geod(V(g["ecef"]))  # exact inverse of the JS double ECEF point
    ck("ecefToGeodetic lat (rad)", "1e-12").add(g["back"]["lat"], la, w)
    ck("ecefToGeodetic lon (rad)", "1e-12").add(g["back"]["lon"], lo, w)
    ck("ecefToGeodetic h (m)", "1e-7").add(g["back"]["h"], hh, w)
    ck("round trip lat (rad)", "1e-12").add(g["back"]["lat"], lat, w)
    ck("round trip h (m)", "1e-7").add(g["back"]["h"], h, w)

# ---------------------------------------------------------------- Kepler
for kk in REF["kep"]:
    el = kk["el"]
    eps, hs = [], []
    for s in kk["states"]:
        t = mpf(s["t"])
        r, v = kepler(el, t)
        w = f"a={el['a']:.4g} e={el['e']} t={s['t']}"
        # conditioning of double precision: M = M0 + n t carries ~ulp(M) rounding, moving r by |v|/n per rad
        nmean = mp.sqrt(GM / mpf(el["a"]) ** 3)
        ktol = 2 * norm(v) / nmean * ulp(mpf(el["M0"]) + nmean * t)
        for k in range(3):
            ck("(info) keplerState r (m; strict spec tol)", "1e-7").add(s["r"][k], r[k], w)
            ck("keplerState r (m; tol max(1e-7, 2|v|/n*ulp(M)))", "1e-7").add(s["r"][k], r[k], w, tol=max(mpf("1e-7"), ktol))
            ck("keplerState v (m/s)", "1e-9").add(s["v"][k], v[k], w)
        h = mpf("1e-8")
        for k in range(3):
            dv = d5(lambda tt: kepler(el, tt)[0][k], t, h)
            ck("own Kepler v - d(own r)/dt (m/s, internal)", "1e-20").add(dv, v[k], w)
        rj, vj = V(s["r"]), V(s["v"])
        eps.append(dot(vj, vj) / 2 - GM / norm(rj))
        hs.append(cross(rj, vj))
    e0 = -GM / (2 * mpf(el["a"]))
    for e in eps:
        ck("JS energy vs -GM/2a (relative)", "1e-14").add(e / e0, mpf(1), f"a={el['a']:.4g} e={el['e']}")
    hn = norm(hs[0])
    for hv in hs:
        ck("JS |h(t) - h(t1)|/|h| (relative)", "1e-14").add(norm(sub(hv, hs[0])) / hn, mpf(0), f"a={el['a']:.4g} e={el['e']}")
for kd in REF["kepDeriv"]:
    el = kd["el"]
    w = f"a={el['a']:.4g} e={el['e']}"
    _, v = kepler(el, mpf(kd["t"]))
    for k in range(3):
        fd = (mpf(kd["rp"][k]) - mpf(kd["rm"][k])) / (2 * mpf(kd["h"]))
        # truncation h^2/6 |jerk| ~ 1e-8 m/s; roundoff ulp(r)/2h ~ 5e-7 m/s: indicative only
        ck("JS central diff of JS r (h=1ms) vs v (m/s; tol 4ulp(r)/2h)", "1e-6").add(fd, v[k], w, tol=max(mpf("1e-6"), 4 * ulp(norm(V(kd["rp"]))) / (2 * mpf(kd["h"]))))

# ---------------------------------------------------------------- frozen trajectories
for fz in REF["frozen"]:
    t = mpf(fz["tc"]) + mpf(fz["dt"])
    r, v = kepler(fz["el"], t)
    w = f"tc={fz['tc']} dt={fz['dt']}"
    for k in range(3):
        ck("freezeTrajectory r vs exact (m; spec tol)", "1e-7").add(fz["r"][k], r[k], w)
        ck("(info) freezeTrajectory r vs exact (m; 1 nm)", "1e-9").add(fz["r"][k], r[k], w)
        ck("(info) freezeTrajectory r - JS keplerState r (m; 1 nm)", "1e-9").add(mpf(fz["r"][k]) - mpf(fz["rk"][k]), mpf(0), w)
        ck("freezeTrajectory v - JS keplerState v (m/s)", "1e-9").add(mpf(fz["v"][k]) - mpf(fz["vk"][k]), mpf(0), w)
        ck("freezeTrajectory v vs exact (m/s)", "1e-9").add(fz["v"][k], v[k], w)

# ---------------------------------------------------------------- clocks
for cl in REF["clocks"]:
    r, v = V(cl["r"]), V(cl["v"])
    ref = clock_rate(r, v)
    ck("clockRate (dtau/dt)", "2e-15").add(cl["rate"], ref, cl["name"])
    INFO.append(f"clockRate {cl['name']}: dtau/dt - 1 (ours) = {mp.nstr(ref - 1, 6)}  (JS: {mp.nstr(mpf(cl['rate']) - 1, 6)})")
U_eq = GM / A_E * (1 + J2 / 2)
W_eq = U_eq + (OM * A_E) ** 2 / 2
INFO.append(f"equator, sea level: W = U(J2) + w^2a^2/2 = {mp.nstr(W_eq, 12)} m^2/s^2, W0 = {W0}; "
            f"(W0 - W)/c^2 = {mp.nstr((W0 - W_eq) / C ** 2, 4)}")

# ---------------------------------------------------------------- Stein
for st in REF["stein"]:
    p = {k: mpf(v) for k, v in st["p"].items()}
    Bs = p.get("Bs", p["B"])
    g = 1 / ((1 / p["snr1"] + 1 / p["snr2"] + 1 / (p["snr1"] * p["snr2"])) / 2)
    beta = mp.pi * Bs / mp.sqrt(3)
    Te = mp.pi * p["T"] / mp.sqrt(3)
    s_t = 1 / (beta * mp.sqrt(p["B"] * p["T"] * g))
    s_f = 1 / (Te * mp.sqrt(p["B"] * p["T"] * g))
    ck("stein.tdoaSigma vs header formula (relative)", "1e-15").add(mpf(st["tdoa"]) / s_t, mpf(1), str(st["p"]))
    ck("stein.fdoaSigma vs header formula (relative)", "1e-15").add(mpf(st["fdoa"]) / s_f, mpf(1), str(st["p"]))

# ---------------------------------------------------------------- output
print()
bad = report()
print()
print("Instant pairing: spec ratio (d te/d tr on the PHASE path at tr) minus closed-form implicit derivative evaluated at the "
      "GROUP-path pair (te, tr) (the pairing the JS uses; same model otherwise). Size of that convention difference:")
print("   max |diff| =", mp.nstr(max(abs(d) for _, d in ANALYTIC), 3))
print("Sagnac claim (vacuum): ECI light time - |ECEF chord|/c - (w/c^2)(x_e y_i - y_e x_i):")
for w, s, r in SAG:
    print(f"   {w:28s} sagnac={mp.nstr(s, 6):>14s} s  residual={mp.nstr(r, 3):>10s} s")
print("Aberration: elevation from ECEF chord (air rest frame) minus from ECI chord, and resulting tropo delay change:")
for w, de, dt in ABER:
    print(f"   {w:28s} d_el={mp.nstr(de, 3):>10s} rad   d_tropo={mp.nstr(dt, 3):>10s} s")
for s in INFO:
    print(s)
print()
print(f"FAILURES: {bad}" if bad else "ALL CHECKS PASS")
sys.exit(1 if bad else 0)
