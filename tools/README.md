# tools/ — independent cross-check of the JS physics core

    node tools/dump_reference.mjs        # runs js/core on the test scenarios -> tools/reference.json
    python tools/crosscheck.py           # recomputes everything with mpmath (50 digits), prints the table
    python tools/crosscheck.py --up-at-t0

Requires Node (ES modules) and Python 3 with `mpmath`. Run both from the repository root.

`crosscheck.py` re-derives the light-time solution, TDOA, received-frequency ratio (as the numerical
derivative d te / d t_r of its own 50-digit light-time solver on the carrier-phase path), reduced
models, geodesy, Kepler states, frozen trajectories, clock rates and the Stein bounds from the written
specification, and compares them with the JS. Each row shows the worst |JS - reference|, the tolerance
and the margin (tolerance / worst; < 1 is a FAIL). Rows prefixed `(info)` are reported but not counted.
Exit status is non-zero if any counted row fails.

Both the reference and the JS evaluate a moving emitter's local vertical and height at its position
at the emission instant. (`--up-at-t0` switches the reference to the older convention of freezing them
at the emitter's position at t0; it exists only to document that the two conventions differ by ~3e-14
in the frequency ratio for a 25 m/s emitter, and scenario D fails under it by design.)
