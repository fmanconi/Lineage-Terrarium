/**
 * The state stream's messages, generated from server/lineage_server/protocol/schema.json
 * by `npm run protocol` (json-schema-to-typescript). Do not edit by hand.
 */

/**
 * The state stream from the server to every renderer (desk kiosk and phone), one JSON message per WebSocket frame (CLAUDE.md §4.7). The TypeScript types in renderer/src/protocol.ts are generated from this file (`cd renderer && npm run protocol`); the Python encoder is server/lineage_server/protocol/encode.py. A renderer that meets a message type it does not know ignores it. Bump `protocol` only for a change an older renderer would misread.
 */
export type Message =
  | ClockMessage
  | LandMessage
  | FaunaMessage
  | CreaturesMessage
  | SpeciesMessage
  | RareMessage
  | ChronicleMessage
  | SkyMessage
  | EventsMessage
  | ViewMessage;
/**
 * Version of this protocol.
 */
export type Protocol = 1;
/**
 * Sim time in milliseconds since the world was created.
 */
export type SimTime = number;
export type Season = "spring" | "summer" | "autumn" | "winter";

/**
 * Where the world is in time. Sent on connect and then often (every server tick): cheap.
 */
export interface ClockMessage {
  type: "clock";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * The calendar date in the world (UTC), YYYY-MM-DD.
   */
  date: string;
  season: Season;
  /**
   * Share of the current season gone by, 0–1.
   */
  season_progress: number;
  day_of_year: number;
  days_in_year: number;
}
/**
 * The land and what grows on it, every cell. Sent on connect and whenever it changes (once a sim-day, after the plants grow, and after terrain events). The palette is not sent: the renderer has the report maps' own (renderer/src/terrain/palette.json). Grids: heights: Height of each cell, 0–1 (u16le, scale 65535). cover: Land-cover class of each cell: an index into `cover_classes` (u8, scale 1). biomass: Plant biomass of each cell, 0–1 (u8, scale 255). snow: Depth of lying snow on each cell, 0–1 (u8, scale 255), as the simulation has it from the season and the height. plant_height: HEIGHT gene of the plant on each cell, 0–1 (u8, scale 255); 0 where none grows. plant_evergreen: EVERGREEN gene of the plant on each cell, 0–1 (u8, scale 255); 0 where none grows. plant_rare: Rare genes of the plant on each cell, as a bit mask (u8, scale 1): bit k is `rare_genes[k]`.
 */
export interface LandMessage {
  type: "land";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * Which world this is: a new continent after an apocalypse has another seed.
   */
  world: {
    seed: number;
  };
  /**
   * Cells across.
   */
  width: number;
  /**
   * Cells down.
   */
  height: number;
  /**
   * Height of the sea, 0–1.
   */
  sea_level: number;
  /**
   * Land-cover class names, in the order of their numbers in `cover`.
   */
  cover_classes: string[];
  heights: Grid;
  cover: Grid;
  biomass: Grid;
  snow: Grid;
  plant_height: Grid;
  plant_evergreen: Grid;
  plant_rare: Grid;
  /**
   * Names of the plants' rare genes, bit 0 first.
   */
  rare_genes: string[];
  scorch?: Grid1;
  algae?: Grid2;
}
/**
 * A grid of the world's cells, row by row from the top-left cell, as little-endian whole numbers in base64. A cell's value is its number divided by `scale`.
 */
export interface Grid {
  /**
   * u8: one byte per cell; u16le: two bytes per cell, little-endian.
   */
  encoding: "u8" | "u16le";
  /**
   * What a cell's whole number is divided by: 1 for classes and bit masks, 255 or 65535 for shares.
   */
  scale: number;
  data: string;
}
/**
 * A grid of the world's cells, row by row from the top-left cell, as little-endian whole numbers in base64. A cell's value is its number divided by `scale`.
 */
export interface Grid1 {
  /**
   * u8: one byte per cell; u16le: two bytes per cell, little-endian.
   */
  encoding: "u8" | "u16le";
  /**
   * What a cell's whole number is divided by: 1 for classes and bit masks, 255 or 65535 for shares.
   */
  scale: number;
  data: string;
}
/**
 * A grid of the world's cells, row by row from the top-left cell, as little-endian whole numbers in base64. A cell's value is its number divided by `scale`.
 */
export interface Grid2 {
  /**
   * u8: one byte per cell; u16le: two bytes per cell, little-endian.
   */
  encoding: "u8" | "u16le";
  /**
   * What a cell's whole number is divided by: 1 for classes and bit masks, 255 or 65535 for shares.
   */
  scale: number;
  data: string;
}
/**
 * What every creature's body is derived from (R2). Sent on connect and when it changes. The renderer derives bodies itself (renderer/src/creatures/phenotype.ts); derived values are never sent.
 */
export interface FaunaMessage {
  type: "fauna";
  protocol: Protocol;
  /**
   * Creature gene names, in genome order.
   */
  genes: string[];
  /**
   * The [fauna] config keys the phenotype function reads (lineage_sim.fauna.phenotype.CONFIG_KEYS): numbers, and `learning` a boolean.
   */
  phenotype_config: {
    [k: string]: number | boolean;
  };
  /**
   * The [fauna] config values the renderer needs to draw rare genes (M7, R2): lineage_sim.rare.render_config(cfg), keys rare.RENDER_KEYS (now giant_mass_factor). Empty before rare genes exist.
   */
  rare_config: {
    [k: string]: number;
  };
}
/**
 * Where every living creature is (R2). Sent after every fauna tick. A creature's genome comes once, the first time its id is sent; an id missing from `ids` has died.
 */
export interface CreaturesMessage {
  type: "creatures";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * Every living creature, by an id it keeps for its life.
   */
  ids: number[];
  /**
   * Where each of `ids` is, in cells: [x, y].
   */
  positions: [number, number][];
  /**
   * The species of each of `ids` (M6; 0 for none yet). Absent before species exist.
   */
  species?: number[];
  /**
   * Creatures not sent before (all of them on connect): id and genome, genes in `FaunaMessage.genes` order, each 0–1.
   */
  born: {
    id: number;
    genome: number[];
    /**
     * Its rare genes, as the bits of `RareMessage.genes` of kingdom creature (M7); fixed for life. Absent before rare genes exist.
     */
    slots?: number;
    /**
     * The mother it was born to on the island since the last creatures message (R5: drawn beside her; a clone's only parent). Absent for those not born since (on connect, landed, older streams).
     */
    parent?: number;
  }[];
  /**
   * Ids of the creatures that are torpid now (hibernating, lying still: M7). Absent before rare genes exist.
   */
  torpid?: number[];
  /**
   * The creatures not yet of age (R5): id and how far grown toward coming of age, in sixteenths (0 newborn, 15 nearly grown). Those absent are grown. Absent from streams recorded before R5.
   */
  young?: [number, number][];
  /**
   * How full each of `ids` is, in the same order: its energy over its body's capacity, in sixteenths (0 nearly starved, 15 full). Drawn by the Health Bars mod. Absent from streams recorded before.
   */
  energy?: number[];
  /**
   * The creatures sent before that died since the last creatures message, and of what (R5): starved, old_age, killed (by a hunter), drowned, burnt (in a fire) or blast (a meteor, a cone or crater rising under it). Absent when none died, and from streams recorded before R5's deaths.
   */
  died?: {
    id: number;
    cause: "starved" | "old_age" | "killed" | "drowned" | "burnt" | "blast";
    /**
     * The hunter that killed it (R5: drawn running to it and striking), when the cause is killed. Absent for other causes, a blast, and from streams recorded before.
     */
    by?: number;
  }[];
  /**
   * The creatures among `ids` that landed from the sea since the last creatures message (R5): founders, strangers, the ark's. Absent when none did, and from streams recorded before R5's arrivals.
   */
  landed?: number[];
  /**
   * Ids of the creatures that ate plants or algae in the last tick (R5: drawn grazing). Absent from streams recorded before.
   */
  grazing?: number[];
  /**
   * Ids of the creatures that ate meat, a kill or carrion, in the last tick (R5: drawn feeding). Absent from streams recorded before.
   */
  feeding?: number[];
}
/**
 * Every species that has lived (M6). Sent on connect and when a species is born or dies out.
 */
export interface SpeciesMessage {
  type: "species";
  protocol: Protocol;
  species: {
    id: number;
    name: string;
    /**
     * The species it split from; null for one of the first.
     */
    parent: number | null;
    extinct?: boolean;
  }[];
}
/**
 * The rare genes of both kingdoms and how each shows (M7): lineage_sim.rare.signature_table(). Sent on connect. Bits are stable; new genes only append. A creature's genes are the bits of its `slots`, a plant's the bits of `LandMessage.plant_rare`.
 */
export interface RareMessage {
  type: "rare";
  protocol: Protocol;
  genes: {
    kingdom: "creature" | "plant";
    /**
     * The gene's bit value in the kingdom's mask (1, 2, 4, …).
     */
    bit: number;
    name: string;
    /**
     * A key naming the visual signature, for the renderer to draw by.
     */
    signature: string;
    /**
     * What the signature looks like, in words.
     */
    look: string;
  }[];
}
/**
 * New lines of the island's history (M9, R3): the chronicle's entries written since the last chronicle message, oldest first. Not sent on connect; a renderer captions the notable ones as they come. The full history is the API's (S3).
 */
export interface ChronicleMessage {
  type: "chronicle";
  protocol: Protocol;
  /**
   * Entries at this importance and above are notable ([chronicle] notable_importance): the desk captions them.
   */
  notable_importance: number;
  /**
   * Entries at this importance and above are major ([chronicle] major_importance): pushed to the phone (S4).
   */
  major_importance: number;
  entries: {
    /**
     * The entry's number in the chronicle, from 1.
     */
    number: number;
    t_ms: SimTime;
    /**
     * What kind of event it tells of (lineage_sim.chronicle Kind values: speciation, extinction, fire…).
     */
    kind: string;
    /**
     * 1 (background) to 5 (historic).
     */
    importance: number;
    /**
     * The entry, in English.
     */
    text: string;
    /**
     * The species it is about; 0 for none.
     */
    species: number;
    /**
     * The cell where it happened; -1 when it has no one place.
     */
    x: number;
    /**
     * The cell where it happened; -1 when it has no one place.
     */
    y: number;
  }[];
}
/**
 * The island's weather of the moment (R4): the light, whether the owner is at the desk, what rain falls, and the cells on fire. Sent on connect and then at every presence tick (10 sim-minutes): the renderer eases the scene's light between them.
 */
export interface SkyMessage {
  type: "sky";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * The light of the moment ([presence]: 1 by day, night_light at night, the moonlight floor after a long absence), 0–1.
   */
  light: number;
  /**
   * Whether the owner is at the desk (the light is rising toward day, or day).
   */
  present: boolean;
  /**
   * What falls now: none; rain, thunder (rain with thunder, seen and heard only) or storm (a thunderstorm, whose lightning sets fires), the island's own weather; or soaking, the rain god power's rain, which puts fires out; or cloud, an overcast sky with nothing falling (seen only).
   */
  rain: "none" | "rain" | "thunder" | "storm" | "soaking" | "cloud";
  /**
   * The cells on fire, as indices y × width + x of the land's grid, in increasing order.
   */
  burning: number[];
}
/**
 * What just happened on the island that the scene shows as weather or a sequence (R4), oldest first: fires, volcanoes, earthquakes, craters, god powers, and the end of a world and the beginning of the next. Not sent on connect. After world_ended, every message is of the next world until the next world_ended.
 */
export interface EventsMessage {
  type: "events";
  protocol: Protocol;
  events: {
    /**
     * fire_started (lightning in a thunderstorm) and fire_ended, volcano, earthquake and crater (the terrain's events), god_power (a power fired), creatures_arrived (newcomers landed: the ark, or strangers), world_ended and world_began (M10).
     */
    kind:
      | "fire_started"
      | "fire_ended"
      | "volcano"
      | "earthquake"
      | "crater"
      | "god_power"
      | "creatures_arrived"
      | "world_ended"
      | "world_began";
    t_ms: SimTime;
    /**
     * The cell where it happened (fire_started, volcano, earthquake, crater, god_power, creatures_arrived).
     */
    x?: number;
    /**
     * The cell where it happened (fire_started, volcano, earthquake, crater, god_power, creatures_arrived).
     */
    y?: number;
    /**
     * How far it reached, in cells (volcano, earthquake, crater).
     */
    radius_cells?: number;
    /**
     * Which power fired (god_power): meteor, rain, seed or ark.
     */
    power?: string;
    /**
     * Cells burnt (fire_ended).
     */
    cells?: number;
    /**
     * Sim-hours it burnt (fire_ended).
     */
    hours?: number;
    /**
     * The world's number, from 1 (world_ended: the one that ended; world_began: the new one).
     */
    world?: number;
    /**
     * The world's seed (world_ended, world_began).
     */
    seed?: number;
    /**
     * Why the world ended (world_ended).
     */
    cause?: string;
    /**
     * How many landed (creatures_arrived).
     */
    count?: number;
  }[];
}
/**
 * The desk's view button was pressed (S1, ADR 0020): the scene steps to its next view, as a key or click does. Sent by the server only to the desk's own kiosk (a client on the device itself), never to a phone, which steers its own view.
 */
export interface ViewMessage {
  type: "view";
  protocol: Protocol;
}
