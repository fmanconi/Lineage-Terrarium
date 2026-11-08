"""Bootstrap a local Lineage island 400 Gregorian years into the future (Year 2426).

Combines:
1. Deep geological & botanical time (~398.5 years of continental plate drift, volcanic cones,
   fault scarps, meteor craters, soil fertility, and ancient climax forest succession), and
2. Multi-generational fauna evolution, speciation, neural learning, and chronicle history
   leading right up to ``now + years_ahead`` at the live 10-minute ``default.toml`` schedule.
"""

from __future__ import annotations

import argparse
import dataclasses
import logging
import time
from pathlib import Path

from lineage_server.main import DEFAULT_CONFIG, _years_ahead_offset_ms
from lineage_server.store import Store
from lineage_sim import clock
from lineage_sim.config import Config, parse_config
from lineage_sim.state import io
from lineage_sim.world import World

log = logging.getLogger("bootstrap_400y")


def build_future_world(
    data_dir: Path,
    years_ahead: int = 400,
    seed: int = 242607,
    force: bool = False,
) -> Path:
    store = Store(data_dir)
    store.clean()
    offset_ms = _years_ahead_offset_ms(years_ahead)
    now_ms = time.time_ns() // 1_000_000
    target_ms = now_ms + offset_ms

    if not force:
        existing = store.load_newest(io.loads)
        if existing is not None:
            log.info("Existing future island save found: %s", existing.path)
            return existing.path

    base_cfg: Config = parse_config(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    live_cfg = dataclasses.replace(
        base_cfg,
        presence=dataclasses.replace(base_cfg.presence, solar_cycle=True),
    )

    # Stage 1: ~398.4 years of deep geological tectonics & botanical succession up to spring
    # ~570 days before target_ms, so founding creatures land immediately in lush spring growth.
    evo_days = 570
    evo_start_ms = target_ms - evo_days * clock.MS_PER_DAY
    evo_start_ms -= evo_start_ms % clock.MS_PER_DAY

    t0 = time.perf_counter()
    world, _ = World.create(live_cfg, seed, now_ms)
    geo_target_t = evo_start_ms - now_ms
    geo_step_ms = 730 * clock.MS_PER_DAY

    cur_t = world.t_ms
    while cur_t < geo_target_t:
        nxt_t = min(geo_target_t, cur_t + geo_step_ms)
        dt_s = (nxt_t - cur_t) / 1000.0
        world._t_ms = nxt_t
        geo_out = world.terrain.tick(world._context(world.terrain, dt_s))
        flora_out = world.flora.tick(world._context(world.flora, dt_s))
        world.witness([*geo_out, *flora_out])
        cur_t = nxt_t

    continent_state = world.snapshot()
    log.info(
        "Stage 1 (%.1f yrs tectonics & flora) finished in %.1fs: %d land cells, %d vegetated",
        geo_target_t / (365.25 * clock.MS_PER_DAY),
        time.perf_counter() - t0,
        int(world.terrain.land.sum()),
        int((world.flora.biomass > 0.05).sum()),
    )

    # Stage 2: Multi-generational fauna evolution (40-min fauna cadence), finishing the final
    # 7 days at exact 10-minute live cadence right up to the live shifted wall clock.
    evo_sched = dict(live_cfg.schedule)
    evo_sched["fauna"] = 2400.0
    evo_sched["presence"] = 2400.0
    evo_sched["weather"] = 7200.0
    evo_sched["fire"] = 7200.0
    evo_cfg = dataclasses.replace(live_cfg, schedule=evo_sched)

    for attempt in range(4):
        t1 = time.perf_counter()
        trial_state = dataclasses.replace(continent_state, seed=seed + attempt)
        evo_world = World.restore(evo_cfg, trial_state)
        fine_handoff_ms = target_ms - 7 * clock.MS_PER_DAY
        chunk_ms = 30 * clock.MS_PER_DAY
        while evo_world.unix_ms < fine_handoff_ms:
            evo_world.advance_to_unix(min(fine_handoff_ms, evo_world.unix_ms + chunk_ms))

        # Switch to exact live 10-minute default schedule for the final week up to right now
        live_now_ms = (time.time_ns() // 1_000_000) + offset_ms
        final_world = World.restore(live_cfg, io.loads(io.dumps(evo_world.snapshot())))
        final_world.advance_to_unix(live_now_ms)

        alive_sp = sum(1 for r in final_world.species.records() if r.alive)
        total_sp = len(final_world.species.records())
        log.info(
            "Stage 2 attempt %d finished in %.1fs: date=%s creatures=%d alive_sp=%d total_sp=%d",
            attempt + 1,
            time.perf_counter() - t1,
            final_world.instant.date.isoformat(),
            final_world.fauna.count,
            alive_sp,
            total_sp,
        )
        if final_world.fauna.count >= 25 and alive_sp >= 2:
            saved_path = store.save(io.dumps(final_world.snapshot()), final_world.unix_ms)
            log.info("Saved 400-year future island to %s", saved_path)
            return saved_path

    saved_path = store.save(io.dumps(final_world.snapshot()), final_world.unix_ms)
    log.info("Saved future island to %s", saved_path)
    return saved_path


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    parser = argparse.ArgumentParser(description="Bootstrap a 400-year future Lineage island.")
    parser.add_argument("--data", type=Path, required=True, help="data directory for the save")
    parser.add_argument(
        "--years", type=int, default=400, help="Gregorian years ahead (default 400)"
    )
    parser.add_argument("--seed", type=int, default=242607, help="initial seed")
    parser.add_argument("--force", action="store_true", help="rebuild even if save exists")
    args = parser.parse_args()
    build_future_world(args.data, years_ahead=args.years, seed=args.seed, force=args.force)


if __name__ == "__main__":
    main()
