/**
 * The scene (R1–R3): the land, its plants and its animals from the state stream, filmed
 * by the documentary camera (`director.ts`), with the chronicle's notable entries on a
 * scroll (`captions.ts`) and, in the local view, a card naming the animal followed
 * (`card.ts`, R5); drawn at 512×300 art pixels and stretched to the screen
 * without smoothing. The picture is drawn a pixel larger all round and slid by the
 * camera's fraction of a pixel, so that slow pans glide instead of stepping a whole art
 * pixel at a time.
 *
 * The camera starts on the map. The view button (V, space or Enter on a keyboard, a tap
 * on a phone; on the desk the hardware button, S2) steps map → middle → local → map;
 * fifteen minutes after the last press it goes back to the map. A click or tap on the
 * screen is the button too.
 *
 *   /                          the creatures' recording (`public/stream/life.json`, 28
 *                              days from the v9 fixture) played at `speed`
 *   ?recording=autumn|winter   the land recordings of R1 (no creatures): 3 August to
 *                              28 September, or 15 January to 5 February with snow
 *   ?speed=1800                sim-seconds to a wall second (the default for `life`;
 *                              a sim-day in 48 s)
 *   ?every=1000                instead, wall milliseconds between messages (0: all at
 *                              once, the last day; the default for `autumn`/`winter`)
 *   ?view=map|middle|local     pin the camera to a view (no director), and
 *   ?x=120&y=60                where it looks, in cells (the island's middle by default)
 *   ?follow=20&idle=60         seconds on one animal and before the map comes back (tests)
 *   ?seed=7                    the camera's random draws (default: a new one each start)
 *   ?source=ws://host/stream   the server's stream instead of a recording (S1)
 *   ?still                     the sea does not move (pictures that must not change)
 *   ?quiet                     no captions of the stream's entries (pictures of the land;
 *                              those handed to `__receive` are still shown)
 *   ?painter=inline            paint the ground on the page's thread, not in a worker
 *   ?film                      R4's films: the scene stands still until `__frame(seconds)`
 *                              moves it on by that much and draws it (a recording plays on
 *                              the same clock), so that a film has exactly its frame rate
 *   ?file=report/fire.json     R4: any recording under `stream/` (the report's, written
 *                              by `npm run atmosphere`), played as the creatures' one
 *   ?recording=office          R4: two weeks of the owner's office hours (dusks, nights,
 *                              the Long Night) with the rain god power twice
 *   ?recording=end             R4: a day, then the world ends (the herd starved) and the
 *                              next one begins: the apocalypse sequence
 *   ?show=night,fire,meteor    R4: the light and events asked for, made up on the land in
 *                              sight (`atmosphere/demo.ts`; the stream's own sky is then
 *                              not taken): day, dusk, dawn, night, moon, rain, fire,
 *                              volcano, quake, meteor, seed, ark, end. With `?still` the
 *                              atmosphere stands still too, moved on only by `__advance`
 *   ?cap=30                    R5: at most this many frames a second (`framecap.ts`): the
 *                              kiosk's cap on the board, which has no fan
 *   ?season=autumn:0.8         R5: the stream's clock says this season, this far into it
 *                              (0–1, 0.5 if left out): the land, the plants and the
 *                              leaves blown off the trees as in that season
 *   ?bushes=whole              R5: the local view's bushes drawn whole, as before the owner
 *                              chose them in pieces (`plants/pieces.ts`), to compare
 *   ?ground=fresh              R5: paint all the ground anew, nothing taken from what is
 *                              kept between visits (`terrain/groundcache.ts`)
 *   ?bench                     R5: the benchmark (`bench.ts`): the scenarios of
 *                              `benchplan.ts` on the recordings, the results POSTed to
 *                              `?post=` (`tools/kiosk_bench.py`)
 *
 * The desk's build (`npm run build:kiosk`, into `dist-kiosk/`) leaves the demo paths out:
 * with no `?source=` it takes the server's stream from the host that served the page,
 * `ws://<host>/stream` (S1), and `?film`, `?file=`, `?show=` and `?recording=` do
 * nothing, but for `?bench`, whose scenarios play the committed recordings and make up
 * what they lack as `?show=` does: the one way off the server the desk keeps, so that the
 * board can be measured from the build it runs.
 *
 * Over the scene the atmosphere (R4, `atmosphere/`): the light of the moment, what glows,
 * the weather of events, and the end of a world, during which the camera stays on the map
 * and the button does nothing.
 */
import { Application, Container, Sprite, Texture, WebGLRenderer } from "pixi.js";
import { Ambient } from "./atmosphere/ambient";
import { Leaves } from "./atmosphere/leaves";
import { Atmosphere } from "./atmosphere/atmosphere";
import { demoMessages, showsOf, type Timed } from "./atmosphere/demo";
import { sight, within, type Point } from "./camera";
import { Captions, PAPER, lantern } from "./captions";
import { NameCard, type CardPhase } from "./card";
import {
  Director,
  NEXT,
  TIMINGS,
  type Motion,
  type Scene,
  type Shot,
  type Visit,
} from "./director";
import { Herd } from "./herd";
import { IRIS_FROM, Iris } from "./iris";
import { useArtCache, type PlantLayer } from "./plants/plants";
import { Landscape, PAINTER_CODE, TILES, VIEWS, type ViewName } from "./landscape";
import { makeArtCache } from "./plants/artcache";
import { PlaceMarker } from "./marker";
import type { ClockMessage, CreaturesMessage, Message, SkyMessage } from "./protocol";
import { FrameMeter } from "./showcase/meter";
import { Overlay } from "./showcase/overlay";
import { Showcase } from "./showcase/showcase";
import { mulberry32 } from "./rng";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "./scene";
import { creatureAtlas } from "./creatures/atlas";
import { PROBE } from "./frameprobe";
import { Portraits } from "./creatures/portrait";
import { heightAt } from "./creatures/habitat";
import type { RareLook } from "./creatures/rare";
import { Recording, SocketSource, type Source } from "./stream";
import { makeGroundCache } from "./terrain/groundcache";
import { GpuGround } from "./terrain/gpuground";
import {
  InlinePainter,
  WorkerPainter,
  makePainter,
  paintRequest,
  type PaintRequest,
} from "./terrain/painter";
import { Bench, type BootMarks } from "./bench";
import type { Rgb } from "./atmosphere/light";
import { FieldGuide, type MiracleStatus } from "./fieldguide";
import { createFrameCap } from "./framecap";
import { KeyBar } from "./keybar";
import {
  SETTINGS_STORAGE_KEY,
  loadSettings,
  nightVeilAlpha,
  saveSettings,
  type SmerdinoSettings,
} from "./settings";

/** Screen pixels per art pixel (ADR 0007). */
const ART = 2;
const WIDTH = DESIGN_WIDTH / ART;
const HEIGHT = DESIGN_HEIGHT / ART;
/** The deepest sea: what shows beyond the world. */
const BACKGROUND = "#24529c";
/** What a dip between views goes to: night, toward plum (`palette.ts`). */
/** Seconds between two asks for the ground round the next animal the local view will follow. */
const AHEAD_EVERY_S = 0.5;
/** The dip between views: the night's deep purple. */
const DIP_COLOUR = 0x10081c;
/** Art pixels drawn beyond the screen on every side: room to slide the picture by a fraction. */
const MARGIN = 1;
/** The name card waits until a dip between views is this clear before it unrolls (0–1). */
const CARD_DIM = 0.5;
/** The camera's moves away from the animal followed, during which the card is put away. */
const AWAY: ReadonlySet<Motion> = new Set<Motion>(["visit", "return"]);
/** The places of this many of the latest notable entries are kept, for the scroll to mark. */
const PLACES_KEPT = 16;
/** The committed recordings (`tools/stream.py`). */
const RECORDINGS: Readonly<Record<string, string>> = {
  life: "stream/life.json",
  autumn: "stream/recording.json",
  winter: "stream/winter.json",
  office: "stream/office.json",
  end: "stream/end.json",
};
/** The recordings of creatures, played at `LIFE_SPEED` unless told otherwise. */
const LIVING = ["life", "office", "end"];
/** Sim-seconds a wall second, playing the creatures' recording: two sim-hours in 4 s. */
const LIFE_SPEED = 1800;
/**
 * The desk's build (`vite build --mode kiosk`): the demo paths are compiled out (the
 * bundler drops every branch behind `!KIOSK`) and the page takes the server's stream.
 */
/** Milliseconds in a sim-day (the benchmark's new land comes a day after the last). */
const MS_PER_DAY = 86_400_000;
const KIOSK = import.meta.env.MODE === "kiosk";
/** Each view's size in cells. */
const VIEW_CELLS: Readonly<Record<ViewName, { width: number; height: number }>> = {
  map: { width: WIDTH / TILES.map, height: HEIGHT / TILES.map },
  middle: { width: WIDTH / TILES.middle, height: HEIGHT / TILES.middle },
  local: { width: WIDTH / TILES.local, height: HEIGHT / TILES.local },
};

/** The server's stream (S1), from the host that served the page. */
function serverStream(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/stream`;
}

/** Derive the HTTP `/god-power` endpoint matching `socketUrl` (supports remote `?source=`). */
function miracleUrlOf(socketUrl: string | null): string | null {
  if (socketUrl === null) return null;
  try {
    const parsed = new URL(socketUrl, window.location.href);
    const scheme = parsed.protocol === "wss:" ? "https:" : "http:";
    return `${scheme}//${parsed.host}/god-power`;
  } catch {
    return "/god-power";
  }
}

declare global {
  interface Window {
    /** True once the view shows the latest day, fully painted (the visual tests wait for it). */
    __sceneSettled?: () => boolean;
    /** Textures alive on the GPU: what a leak would make grow (tests). */
    __textures?: () => number;
    /** Hand the scene a message as if the stream had sent it (tests and measurements). */
    __receive?: (message: Message) => void;
    /** Press the view button (tests; S2's hardware button reaches the page this way too). */
    __press?: () => void;
    /** What the camera shows and does (tests). */
    __camera?: () => Shot & { motion: string; dipping: boolean; visit: Visit | null };
    /** What the scroll shows (tests). */
    __captions?: () => {
      phase: string;
      text: string | null;
      waiting: number;
      lamp: number;
      kind: string | null;
      icon: string | null;
      initial: number | null;
    };
    /** What the name card of the animal followed shows (tests; S3 shows the same card). */
    /** Paint `request` on the land shown with the colour pass on the CPU and on the GPU: how many pixels differ (tests). */
    __paintBoth?: (request: PaintRequest) => { differ: number; pixels: number } | null;
    /** Paintings of the ground made with the colour pass on the GPU and on the CPU (`WorkerPainter.made`). */
    __groundMade?: () => { gpu: number; cpu: number } | null;
    /** Whether the followed animal's portrait, read back without waiting, is the one read at once (tests). */
    __portraitCheck?: () => boolean | null;
    __card?: () => {
      phase: CardPhase;
      open: number;
      /** The lamp it is lit by (0xRRGGBB): 0xffffff by day, dim and warm at night. */
      lamp: number;
      /** Whether the animal's portrait is on the card's plate. */
      portrait: boolean;
      id?: number;
      name?: string;
      traits?: string;
      icons?: string[];
    };
    /** What the atmosphere shows (tests). */
    __atmosphere?: () => Atmosphere["state"] & Atmosphere["counts"];
    __colours?: () => ReturnType<Herd["colourTable"]>;
    __swash?: (x: number, y: number) => boolean;
    __pin?: (id: number, x: number, y: number, heading: number) => boolean;
    __send?: (id: number, x: number, y: number) => boolean;
    __feed?: (id: number, food: "none" | "plants" | "meat") => boolean;
    __hunt?: (hunterId: number, preyId: number) => boolean;
    __birth?: (motherId: number, childId: number, egg?: boolean) => boolean;
    /** Draw animal `id` with a rare gene by its look too (R5: rare genes in action, staged). */
    __grant?: (id: number, look: RareLook) => boolean;
    /** Animal `id`'s sleep (R5): night-active, asleep, how far lying down. */
    __sleep?: (id: number) => ReturnType<Herd["sleepOf"]>;
    /** What the small life about the island shows (R5): fireflies lit, dust, birds, butterflies. */
    __ambient?: () => Ambient["state"];
    /** Autumn leaves in the air and on the ground (R5). */
    __leaves?: () => Leaves["state"];
    /** What falls from the sky from now on (R5, staging the animals in rain): a sky message as the last, with `rain`. */
    __rain?: (rain: SkyMessage["rain"]) => boolean;
    __standing?: (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => ReturnType<PlantLayer["standing"]>;
    /** Where cell point (x, y) is on the screen, in CSS pixels (staging the look by hand). */
    __screenOf?: (x: number, y: number) => { x: number; y: number };
    /** Whether a body of radius `margin` at cell point (x, y) is in a plant's footprint. */
    __blocked?: (x: number, y: number, margin: number) => boolean;
    /** The land drawn at cell (x, y): height, cover class, biomass and scorch (tests). */
    __landAt?: (
      x: number,
      y: number,
    ) => { height: number; cover: string; biomass: number; scorch: number } | null;
    /** With `?film`: move the whole scene on by this many seconds and draw it. */
    __frame?: (seconds: number) => void;
    /** Whether the ground is still being painted (films wait for it between frames). */
    __painting?: () => boolean;
    /** Move the atmosphere on by this many seconds (tests; with `?still` the only way it moves). */
    __advance?: (seconds: number) => void;
    /** Inspect or toggle the naturalist's field guide (tests). */
    __guide?: () => { open: boolean; tab: string; species: number; totalCreatures: number };
  }
}

function pinnedView(name: string | null): ViewName | null {
  return (VIEWS as readonly string[]).includes(name ?? "") ? (name as ViewName) : null;
}

async function start(): Promise<void> {
  // The benchmark (R5): with `?bench` it gives the scene its options for the scenario at
  // hand, and once the scene is built it is handed the hooks it measures with (below).
  const bench = await Bench.start(window.location.search, VIEW_CELLS);
  const params = bench?.params ?? new URLSearchParams(window.location.search);
  // When the page got going (R5, the optimization plan; the benchmark reads them).
  const boot: BootMarks = { script: performance.now(), land: null, laidOut: null, painted: null };
  const pinned = pinnedView(params.get("view"));
  // The showcase (R5): a scripted tour of the scene on a recording, kept in the desk's
  // build so that it runs on the board as the desk would (`showcase/`).
  const showcasing = params.get("showcase") !== null;
  const desktop = params.get("desktop") !== null;

  const app = new Application();
  await app.init({
    width: WIDTH + 2 * MARGIN,
    height: HEIGHT + 2 * MARGIN,
    background: BACKGROUND,
    antialias: false,
    roundPixels: true,
    resolution: 1,
    autoDensity: false,
  });
  // The screen: a box the size of the scene, which crops the canvas's margin; the dip and
  // the scroll lie over it, still while the canvas slides.
  const frame = document.createElement("div");
  frame.dataset.testid = "stage";
  frame.style.position = "absolute";
  frame.style.overflow = "hidden";
  document.body.appendChild(frame);
  // No pointer on the desk (the owner, on the board: the kiosk showed it).
  if (KIOSK && !desktop) document.documentElement.style.cursor = "none";
  const canvas = app.canvas;
  canvas.style.imageRendering = "pixelated";
  canvas.style.position = "absolute";
  canvas.style.left = `${(-100 * MARGIN) / WIDTH}%`;
  canvas.style.top = `${(-100 * MARGIN) / HEIGHT}%`;
  canvas.style.width = `${(100 * (WIDTH + 2 * MARGIN)) / WIDTH}%`;
  canvas.style.height = `${(100 * (HEIGHT + 2 * MARGIN)) / HEIGHT}%`;
  canvas.style.willChange = "transform";
  frame.appendChild(canvas);
  /** Screen pixels to the art pixel, as the page is laid out now. */
  let artPixel = ART;
  const layout = (): void => {
    const fit = fitToViewport(window.innerWidth, window.innerHeight);
    frame.style.width = `${DESIGN_WIDTH * fit.scale}px`;
    frame.style.height = `${DESIGN_HEIGHT * fit.scale}px`;
    frame.style.left = `${fit.offsetX}px`;
    frame.style.top = `${fit.offsetY}px`;
    artPixel = ART * fit.scale;
  };
  window.addEventListener("resize", layout);
  layout();

  const world = new Container({ isRenderGroup: true });
  // The grey under cloud is a full-screen pass: it is told the canvas as its area, or Pixi
  // measures the bounds of the whole world for it every frame (R5: a seventh of a frame on
  // the board in rain).
  world.filterArea = app.screen;
  let graded = false;
  app.stage.addChild(world);
  const painter = params.get("painter") === "inline" ? new InlinePainter() : makePainter();
  // How many of the ground's paintings had their colour pass on the painters' GPU (tests, the benchmark).
  window.__groundMade = () => (painter instanceof WorkerPainter ? { ...painter.made } : null);
  const landscape = new Landscape(painter, undefined, undefined, params.get("still") !== null);
  landscape.bushPieces = params.get("bushes") !== "whole";
  landscape.groundOnGpu = params.get("painter") !== "cpu";
  // The ground painted is kept between visits (R5); `?ground=fresh` paints it all anew.
  if (params.get("ground") !== "fresh") {
    landscape.cache = makeGroundCache();
    // The plants' drawings kept too, read in now, long before the first lay-out (R5).
    useArtCache(makeArtCache(PAINTER_CODE));
  }
  world.addChild(landscape.container);
  const seed = Number(params.get("seed") ?? Date.now() % 2 ** 31);
  const atlas = creatureAtlas();
  const herd = new Herd(atlas, mulberry32(seed + 1), () => landscape.current);
  // Live, a page's first animals are drawn over its first frames (the start's longest
  // wait on the board); films and stills draw them at once, the same frames every time.
  herd.spreadPlacing = params.get("film") === null && params.get("still") === null;
  // The name card's portraits, drawn by the scene's own renderer (R5).
  // Read back without waiting for the GPU while the scene runs live; at once for films and
  // stills, so that a frame is the same however fast the machine is.
  const portraits = new Portraits(
    app.renderer,
    atlas,
    params.get("film") === null && params.get("still") === null,
  );
  herd.swash = (x, y) => landscape.swashCovers(x, y);
  world.addChild(...herd.containers);
  // Small life about the island (R5): fireflies, dust from running feet, birds, butterflies.
  const ambient = new Ambient(seed + 3);
  herd.footfall = (x, y) => ambient.dust(x, y);
  world.addChild(ambient.over);
  // Autumn leaves blown off the trees (R5), among the plants of the view.
  const leaves = new Leaves(seed + 4, ambient.over);
  const still = params.get("still") !== null;

  // Over the scene: the captions (the dip between views is drawn on the canvas, `dip`).
  // The initial of an entry about a species is in the species' colour, as the herd draws it.
  const captions = new Captions(
    WIDTH,
    HEIGHT,
    (species) => herd.colourTable().find((row) => row.id === species)?.body ?? null,
  );
  // The name card of the animal followed, in the top-left corner (R5).
  const card = new NameCard(WIDTH, HEIGHT);
  // The naturalist's double-page field guide (`Tab` / `M`) and bottom-right key hint bar.
  const fieldGuide = new FieldGuide(WIDTH, HEIGHT);
  const keyBar = new KeyBar(WIDTH, HEIGHT);
  frame.append(captions.element, card.element, fieldGuide.element, keyBar.element);
  // The showcase's lines and titles, and its frame counter with `?fps`.
  const overlay = showcasing ? new Overlay(WIDTH, HEIGHT) : null;
  if (overlay !== null) frame.append(overlay.title, overlay.line, overlay.counter);

  // Where each notable entry happened, by its number, for the marker and the local view's
  // visit while its scroll is out (R5); entries with no one place are not kept.
  const places = new Map<number, Visit>();
  const placeOf = (message: Message): void => {
    if (message.type !== "chronicle") return;
    for (const entry of message.entries) {
      if (entry.importance < message.notable_importance || entry.x < 0 || entry.y < 0) continue;
      places.set(entry.number, { entry: entry.number, x: entry.x, y: entry.y });
    }
    // The oldest go first: a Map keeps the order they came in.
    for (const number of places.keys()) {
      if (places.size <= PLACES_KEPT) break;
      places.delete(number);
    }
  };
  const marker = new PlaceMarker();

  const quiet = params.get("quiet") !== null;
  let date: string | null = null;
  let lastMs = 0;
  let lastCreatures: CreaturesMessage | null = null;
  let lastSky: SkyMessage | null = null;
  let lastClock: ClockMessage | null = null;
  const deliver = (message: Message): void => {
    if (message.type === "clock") {
      date = message.date;
      lastClock = message;
    }
    if (message.type === "sky") lastSky = message;
    if (message.type === "creatures") lastCreatures = message;
    if ("t_ms" in message) lastMs = message.t_ms;
    if (message.type === "chronicle") {
      captions.take(message, date);
      placeOf(message);
    }
    landscape.receive(message);
    herd.receive(message);
    atmosphere.receive(message);
    ambient.receive(message);
    leaves.receive(message);
  };
  // The director comes later; a world's end sends the camera to the map through this.
  let toMap = (): void => undefined;
  const atmosphere = new Atmosphere(deliver, {
    random: mulberry32(seed + 2),
    onEnd: () => {
      toMap();
      // The last of them died: the dead leave the scene with the world they lived in.
      herd.receive({
        type: "creatures",
        protocol: 1,
        t_ms: lastMs,
        ids: [],
        positions: [],
        born: [],
      });
    },
  });
  world.addChild(atmosphere.ground);
  atmosphere.lights.addChild(ambient.lights);
  landscape.floor.addChild(atmosphere.floor, herd.remains.floor, ...herd.floors);
  // Nothing stands on a cone or in a crater the scene draws.
  landscape.covered = (x, y) => atmosphere.covers(x, y);
  app.stage.addChild(
    atmosphere.veil,
    atmosphere.tint,
    atmosphere.weather,
    atmosphere.lights,
    marker.container,
    atmosphere.sky,
  );
  // Optional bedroom night-dimming veil (Smerdino screensaver), beneath dip and iris.
  const nightDim = new Sprite(Texture.WHITE);
  nightDim.tint = DIP_COLOUR;
  nightDim.width = app.screen.width;
  nightDim.height = app.screen.height;
  nightDim.alpha = 0;
  nightDim.visible = false;
  app.stage.addChild(nightDim);
  // The dip between views, drawn last on the canvas itself (R5, the owner on the board: an
  // element laid over the canvas left what was drawn before showing through), over the
  // whole canvas with its margin.
  const dip = new Sprite(Texture.WHITE);
  dip.tint = DIP_COLOUR;
  dip.width = app.screen.width;
  dip.height = app.screen.height;
  dip.alpha = 0;
  dip.visible = false;
  app.stage.addChild(dip);
  // Live, the iris in its place (R5, `iris.ts`): it closes on the middle, a ring turns while
  // the next view's ground comes, and it opens as far as that ground is painted.
  const iris = new Iris(app.screen.width, app.screen.height, DIP_COLOUR, PAPER);
  app.stage.addChild(iris.sprite);
  // An animal burnt to death (or, in streams without causes, that dies in a burning
  // cell) leaves a puff of ash.
  herd.onGone = (x, y, cause) => {
    const land = landscape.current;
    if (land === null) return;
    const burning = atmosphere.isBurning(Math.floor(y) * land.width + Math.floor(x));
    if (cause === "burnt" || (cause === undefined && burning)) atmosphere.burnt(x, y);
  };
  // The ark's newcomers come into being where its light is.
  herd.arrival = (x, y) => atmosphere.arrival(x, y);
  const receive = (message: Message): void => {
    const begun = PROBE.enabled ? performance.now() : 0;
    if (message.type === "land" && boot.land === null) boot.land = performance.now();
    PROBE.note(message.type);
    // Until the first ground is painted, each message's handling is marked for a trace or
    // a look from the board (R5: where a start goes); none after, so that none pile up.
    const starting = boot.painted === null;
    const from = starting ? performance.now() : 0;
    if (!atmosphere.hold(message)) deliver(message);
    if (starting) performance.measure(`lineage:start:${message.type}`, { start: from });
    if (PROBE.enabled) PROBE.charge("messages", performance.now() - begun);
  };
  // Made-up light and events: a demo path, kept in the desk's build only for the benchmark.
  const shows = KIOSK && bench === null ? [] : showsOf(params.get("show"));

  // The desk's build takes the server's stream unless benchmarked.
  const socket =
    params.get("source") ?? (KIOSK && bench === null && !showcasing ? serverStream() : null);
  // `?file=` plays any recording under `stream/` (the report's, R4), as a creatures' one.
  const file = KIOSK ? null : params.get("file");
  const name = file === null ? (params.get("recording") ?? "life") : "life";
  const recording =
    file !== null && /^[\w/-]+\.json$/.test(file)
      ? `stream/${file}`
      : (RECORDINGS[name] ?? RECORDINGS["life"] ?? "");
  const every = params.get("every");
  const speed = Number(
    params.get("speed") ?? (every === null && LIVING.includes(name) ? LIFE_SPEED : 0),
  );
  const film = !KIOSK && params.get("film") !== null;
  const source: Source =
    socket !== null
      ? new SocketSource(socket)
      : await Recording.load(recording, Number(every ?? 1000), speed);
  if (film && source instanceof Recording) source.playManually();
  // `?season=autumn:0.8` (staging, R5): the clock says that season, so far into it.
  const [seasonAsked, seasonShare] = (KIOSK ? "" : (params.get("season") ?? "")).split(":");
  const seasonNamed = ["spring", "summer", "autumn", "winter"].find((one) => one === seasonAsked);
  // The desk's view button, sent by the server (S1); the button's handler comes later.
  let viewPressed = (): void => undefined;
  source.listen((message) => {
    if (message.type === "view") {
      viewPressed();
      return;
    }
    if (quiet && message.type === "chronicle") return;
    if (seasonNamed !== undefined && message.type === "clock") {
      const progress = Number(seasonShare ?? 0.5);
      message = {
        ...message,
        season: seasonNamed as typeof message.season,
        season_progress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0.5,
      };
    }
    // Shown on demand, the light is the one asked for, not the recording's.
    if (shows.length > 0 && message.type === "sky") return;
    receive(message);
  });

  const number = (key: string, otherwise: number): number => {
    const value = Number(params.get(key) ?? otherwise);
    return Number.isFinite(value) && value > 0 ? value : otherwise;
  };
  const follow = params.get("follow");
  const director = new Director(VIEW_CELLS, mulberry32(seed), {
    idleS: number("idle", TIMINGS.idleS),
    followMinS: follow === null ? TIMINGS.followMinS : number("follow", 1) * 0.8,
    followMaxS: follow === null ? TIMINGS.followMaxS : number("follow", 1) * 1.2,
  });
  // Live, the next animal to follow is chosen ahead and its ground painted (the director's
  // choices drawn earlier); films and stills draw them when they always did.
  director.looksAhead = params.get("film") === null && params.get("still") === null;

  const hasSavedSettings = (() => {
    try {
      return (
        typeof localStorage !== "undefined" && localStorage.getItem(SETTINGS_STORAGE_KEY) !== null
      );
    } catch {
      return false;
    }
  })();
  let settings: SmerdinoSettings = loadSettings();
  const urlCap = params.get("cap");
  if (!hasSavedSettings && (urlCap !== null || desktop)) {
    settings = { ...settings, fpsCap: urlCap !== null ? (Number(urlCap) >= 60 ? 60 : 30) : 60 };
  }
  director.autoTour =
    pinned === null && !film && !still && !showcasing && bench === null && settings.autoTour;

  let applyFpsCap: (fps: number) => void = () => undefined;
  const updateSettings = (next: SmerdinoSettings): void => {
    settings = next;
    saveSettings(settings);
    director.autoTour =
      pinned === null && !film && !still && !showcasing && bench === null && settings.autoTour;
    if (bench === null && !film) {
      applyFpsCap(settings.fpsCap === 60 ? 0 : 30);
    }
  };

  // Live server `/god-power` status polling and weekly miracle invocation.
  const miracleUrl = miracleUrlOf(socket);
  const pollMiracle = async (): Promise<void> => {
    if (miracleUrl === null) return;
    try {
      const resp = await fetch(miracleUrl, { cache: "no-store" });
      if (!resp.ok) return;
      const data = (await resp.json()) as MiracleStatus;
      fieldGuide.setMiracleStatus(data);
    } catch {
      // Offline or static server: keep miracle seal gracefully disabled.
    }
  };

  let invokingMiracle = false;
  const invokeMiracle = async (fromShortcut = false): Promise<void> => {
    if (invokingMiracle) return;
    if (miracleUrl === null) {
      if (fromShortcut && !fieldGuide.open && !atmosphere.ending) {
        fieldGuide.setTab("island");
        fieldGuide.toggle();
      }
      return;
    }
    invokingMiracle = true;
    try {
      const resp = await fetch(miracleUrl, { method: "POST" });
      const data = (await resp.json()) as MiracleStatus & {
        invoked?: boolean;
        power?: string | null;
      };
      if (data.invoked === true) {
        const powerLabel = (data.power ?? "miracle").toUpperCase();
        fieldGuide.setMiracleStatus(data, `Miracle granted: ${powerLabel}!`);
        if (fieldGuide.open) fieldGuide.close();
      } else {
        fieldGuide.setMiracleStatus(data, "Still recharging (7-day seal)");
        if (fromShortcut && !fieldGuide.open && !atmosphere.ending) {
          fieldGuide.setTab("island");
          fieldGuide.toggle();
        }
      }
    } catch {
      // Ignore network hiccup.
    } finally {
      invokingMiracle = false;
    }
  };

  if (socket !== null && !film && !still && bench === null) {
    window.setTimeout(() => void pollMiracle(), 1200);
    window.setInterval(() => void pollMiracle(), 30_000);
  }

  toMap = () => {
    fieldGuide.close();
    if (pinned === null) director.toMap();
  };

  // The view button: a key on a keyboard, a tap on a phone. Not while a world ends.
  const press = (): void => {
    if (pinned === null && !atmosphere.ending) director.press();
  };
  viewPressed = press;

  const automatedRun = film || still || showcasing || bench !== null || quiet;
  let userInteracted = false;

  const guideCallbacks = {
    onFollowSpecies: (speciesId: number): void => {
      if (pinned === null && !atmosphere.ending) director.followSpecies(speciesId);
    },
    onChangeSettings: updateSettings,
    onInvokeMiracle: (): void => {
      void invokeMiracle(false);
    },
  };

  const toggleGuide = (): void => {
    if (atmosphere.ending) return;
    const followedSpecies = shot.subject === null ? null : herd.speciesOf(shot.subject);
    fieldGuide.toggle(followedSpecies !== null && followedSpecies > 0 ? followedSpecies : null);
    if (fieldGuide.open) void pollMiracle();
  };

  const toggleSleep = (): void => {
    updateSettings({ ...settings, sleepMode: !settings.sleepMode });
    if (settings.sleepMode && fieldGuide.open) fieldGuide.close();
  };

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    userInteracted = true;
    keyBar.wake();
    if (event.key === "n" || event.key === "N") {
      toggleSleep();
      return;
    }
    if (fieldGuide.open) {
      if (event.key === "Tab") event.preventDefault();
      fieldGuide.handleKey(event.key, herd.speciesGuide(), settings, guideCallbacks);
      return;
    }
    if (event.key === "Tab" || event.key === "m" || event.key === "M") {
      if (event.key === "Tab") event.preventDefault();
      toggleGuide();
      return;
    }
    if (event.key === "g" || event.key === "G") {
      void invokeMiracle(true);
      return;
    }
    if (event.key === "v" || event.key === "V" || event.key === " " || event.key === "Enter") {
      press();
    }
  });

  let lastPtr = { x: -1, y: -1 };
  window.addEventListener("pointermove", (event) => {
    if (Math.hypot(event.clientX - lastPtr.x, event.clientY - lastPtr.y) < 3) return;
    lastPtr = { x: event.clientX, y: event.clientY };
    if (!automatedRun) keyBar.wake();
  });

  // A click or tap steers the key bar, field guide, or steps the camera view.
  frame.addEventListener("pointerdown", (event) => {
    userInteracted = true;
    keyBar.wake();
    const rect = frame.getBoundingClientRect();
    const artX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH;
    const artY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * HEIGHT;
    const barHit = keyBar.hitAt(artX, artY);
    if (barHit !== null) {
      if (barHit === "guide") toggleGuide();
      else if (barHit === "night") toggleSleep();
      else if (barHit === "view") {
        fieldGuide.close();
        press();
      } else if (barHit === "miracle") {
        void invokeMiracle(true);
      } else if (barHit === "close") {
        fieldGuide.close();
      } else if (barHit === "tabs") {
        fieldGuide.handleKey("]", herd.speciesGuide(), settings, guideCallbacks);
      } else if (barHit === "follow") {
        fieldGuide.handleKey("Enter", herd.speciesGuide(), settings, guideCallbacks);
      }
      return;
    }
    if (fieldGuide.handlePointer(artX, artY, settings, guideCallbacks)) return;
    press();
  });

  let currentNightAlpha = settings.sleepMode ? nightVeilAlpha(1, settings.nightDimmer, true) : 0;
  let shot: Shot = { view: pinned ?? "map", centre: { x: 0, y: 0 }, dim: 0, subject: null };
  window.__sceneSettled = () => landscape.settled;
  window.__receive = receive;
  window.__press = press;
  window.__camera = () => ({ ...shot, ...director.state, view: shot.view });
  let advance = 0;
  window.__atmosphere = () => ({ ...atmosphere.state, ...atmosphere.counts });
  window.__colours = () => herd.colourTable();
  window.__swash = (x, y) => landscape.swashCovers(x, y);
  // Debugging the look: an animal placed by hand, and where the trees and bushes stand.
  window.__pin = (id, x, y, heading) => herd.pin(id, x, y, heading);
  window.__send = (id, x, y) => herd.send(id, x, y);
  window.__feed = (id, food) => herd.feed(id, food);
  window.__hunt = (hunterId, preyId) => herd.hunt(hunterId, preyId);
  window.__birth = (motherId, childId, egg) => herd.birth(motherId, childId, egg);
  window.__grant = (id, look) => herd.grant(id, look);
  window.__sleep = (id) => herd.sleepOf(id);
  window.__ambient = () => ambient.state;
  window.__leaves = () => leaves.state;
  window.__rain = (rain) => {
    if (lastSky === null) return false;
    receive({ ...lastSky, rain });
    return true;
  };
  window.__standing = (x0, y0, x1, y1) => landscape.hosts?.standing({ x0, y0, x1, y1 }) ?? [];
  window.__screenOf = (x, y) => world.toGlobal({ x, y });
  window.__blocked = (x, y, margin) => landscape.hosts?.blocked(x, y, margin) ?? false;
  window.__landAt = (x, y) => {
    const land = landscape.current;
    if (land === null) return null;
    const cell = Math.floor(y) * land.width + Math.floor(x);
    return {
      height: land.heights[cell] ?? 0,
      cover: land.coverClasses[land.cover[cell] ?? 0] ?? "",
      biomass: land.biomass[cell] ?? 0,
      scorch: land.scorch?.[cell] ?? 0,
    };
  };
  window.__advance = (seconds) => {
    advance += seconds;
  };
  window.__guide = () => {
    const snap = herd.speciesGuide();
    return {
      open: fieldGuide.open,
      tab: fieldGuide.tab,
      species: snap.livingSpeciesCount,
      totalCreatures: snap.totalCreatures,
    };
  };
  window.__card = () => card.state;
  if (!KIOSK) {
    let gpu: GpuGround | null | undefined;
    window.__paintBoth = (request) => {
      const land = landscape.current;
      gpu ??= GpuGround.create();
      if (land === null || gpu === null) return null;
      const cpu = paintRequest(land, request);
      const onGpu = paintRequest(land, request, gpu);
      let differ = 0;
      for (let at = 0; at < cpu.rgba.length; at += 4) {
        if (
          cpu.rgba[at] !== onGpu.rgba[at] ||
          cpu.rgba[at + 1] !== onGpu.rgba[at + 1] ||
          cpu.rgba[at + 2] !== onGpu.rgba[at + 2]
        )
          differ += 1;
      }
      return { differ, pixels: cpu.rgba.length / 4 };
    };
    window.__portraitCheck = () => {
      const subject = shot.subject;
      const look = subject === null ? null : herd.portraitOf(subject);
      const kept = look === null ? null : portraits.of(look);
      if (look === null || kept === null) return null;
      const atOnce = new Portraits(app.renderer, atlas, false).of(look);
      return (
        atOnce !== null &&
        atOnce.rgba.length === kept.rgba.length &&
        atOnce.rgba.every((value, at) => value === kept.rgba[at])
      );
    };
  }
  window.__captions = () => {
    const { phase, caption, waiting, lamp, icon, initial } = captions.state;
    return {
      phase,
      text: caption?.text ?? null,
      waiting,
      lamp,
      kind: caption?.kind ?? null,
      icon,
      initial,
    };
  };
  // PixiJS leaves a freed texture's place empty (null) rather than taking it out: count the rest.
  const textures = (): number =>
    app.renderer instanceof WebGLRenderer
      ? app.renderer.texture.managedTextures.filter((source) => source !== null).length
      : -1;
  window.__textures = textures;

  const scene: Scene = {
    width: 0,
    height: 0,
    isLand: (x, y) => {
      const land = landscape.current;
      return land !== null && heightAt(land, x, y) > land.seaLevel;
    },
    get subjects() {
      return herd.subjects();
    },
    ready: false,
  };
  // The view first, so that the first land is laid out for it alone.
  landscape.show(shot.view, { x0: 0, y0: 0, x1: 0, y1: 0 });
  let shown = shows.length === 0;
  // The demo's later messages, on the atmosphere's clock (so `__advance` moves them too).
  let later: Timed[] = [];
  // The showcase visits a few places: the rest of the island is not painted ahead for it.
  if (showcasing) landscape.paintAhead = false;
  const showcase = showcasing
    ? new Showcase({
        size: () => landscape.size,
        landMessage: () => landscape.lastMessage,
        clock: () => lastClock,
        receive: (message) => receive(message),
        demo: (asked, x, y) => {
          const land = landscape.current;
          if (land === null) return;
          const world = { land, landMessage: landscape.lastMessage, creatures: lastCreatures };
          later.push(...demoMessages(asked, world, x, y, lastMs));
        },
        advance: (seconds) => {
          advance += seconds;
        },
        groundShown: () => landscape.groundShown,
        sky: (light, present, rain) => {
          receive({ type: "sky", protocol: 1, t_ms: lastMs, light, present, rain, burning: [] });
        },
        prefetch: (view, centre) => {
          const tile = TILES[view];
          landscape.prefetch(view, sight(centre, WIDTH / tile, HEIGHT / tile));
        },
        herd,
      })
    : null;
  /** The light of the moment as last drawn (the animals sleep by it, R5). */
  let sceneLight = 1;
  /** What fell from the sky as last drawn (no birds or fireflies in it, R5). */
  let sceneRain: SkyMessage["rain"] = "none";
  /** Seconds since the ground round the next animal to follow was last asked for. */
  let aheadS = 0;
  /** Move the scene on by `deltaMS` and lay it out for drawing. */
  const step = (deltaMS: number): void => {
    PROBE.enter("director");
    const size = landscape.size;
    if (size === null) {
      // Nothing drawn until the first land: let it be laid out.
      landscape.update(0);
      return;
    }
    const dtS = deltaMS / 1000;
    // The entry on the scroll, and where it happened: marked while the scroll is out,
    // visited by the local view while it is open (as the scroll was last frame).
    const scroll = captions.state;
    const entry =
      scroll.caption === null || scroll.phase === "gap"
        ? null
        : (places.get(scroll.caption.number) ?? null);
    const scripted = showcase?.update(dtS) ?? null;
    if (scripted !== null) {
      // Kept inside the world, as the director keeps its own views (past its edge there is
      // nothing to draw); the map shows the whole of it.
      const tile = TILES[scripted.view];
      const centre =
        scripted.view === "map"
          ? { x: size.width / 2, y: size.height / 2 }
          : within(scripted.centre, WIDTH / tile, HEIGHT / tile, size.width, size.height);
      shot = { ...scripted, centre };
    } else if (pinned === null) {
      scene.width = size.width;
      scene.height = size.height;
      // Live, the iris opens once the middle of the view is painted (`openTo`, and as far
      // as it is); films and stills keep waiting for all of it, as they were made.
      scene.ready = director.looksAhead ? landscape.openTo >= IRIS_FROM : landscape.settled;
      scene.place = scroll.phase === "roll-up" || atmosphere.ending ? null : entry;
      shot = director.update(dtS, scene);
    } else {
      // The map shows the whole world whatever is asked.
      const centre: Point =
        pinned === "map"
          ? { x: size.width / 2, y: size.height / 2 }
          : // Kept inside the world, as the director keeps its own views: past its edge
            // there is nothing to draw.
            within(
              {
                x: Number(params.get("x") ?? size.width / 2),
                y: Number(params.get("y") ?? size.height / 2),
              },
              WIDTH / TILES[pinned],
              HEIGHT / TILES[pinned],
              size.width,
              size.height,
            );
      shot = { view: pinned, centre, dim: 0, subject: null };
    }
    const tile = TILES[shot.view];
    const cells = sight(shot.centre, WIDTH / tile, HEIGHT / tile);
    // Ahead of the view button (R5, the optimization plan): the views not shown are laid
    // out in the background (their plants drawn in a worker), and every so often the
    // ground the next views will open on (where the middle view will come down, round the
    // animal the local view will follow) is painted and kept, so that they come painted.
    if (director.looksAhead) {
      landscape.prepareAhead();
      aheadS += deltaMS / 1000;
      // The view the button leads to next, and the one after it behind it (on the map,
      // the middle view's place, then the local view's animal).
      if (aheadS >= AHEAD_EVERY_S) {
        aheadS = 0;
        const coming = NEXT[shot.view];
        for (const view of [coming, NEXT[coming]]) {
          const at = view === "local" ? director.upcoming : director.upcomingMiddle;
          if (view === "map" || at === null) continue;
          const tile = TILES[view];
          landscape.prefetch(view, sight(at, WIDTH / tile, HEIGHT / tile), view !== coming);
        }
      }
    }
    PROBE.enter("landscape");
    const laying = boot.painted === null ? performance.now() : 0;
    landscape.show(shot.view, cells);
    landscape.update(dtS);
    if (laying > 0) performance.measure("lineage:start:landscape", { start: laying });
    if (boot.laidOut === null && landscape.current !== null) boot.laidOut = performance.now();
    if (boot.painted === null && landscape.settled) boot.painted = performance.now();
    PROBE.enter("herd");
    // The animals sleep by the light of the moment (R5), as last drawn.
    herd.nightfall(sceneLight, atmosphere.overcastNow);
    // Out in the rain they shake it off when it ends, and hunch in a thunderstorm (R5).
    herd.weather(sceneRain);
    herd.update(dtS, shot.view, cells, landscape.hosts, shot.subject);
    const land = landscape.current;
    if (!shown && land !== null) {
      shown = true;
      const centre = shot.view === "map" ? { x: land.width / 2, y: land.height / 2 } : shot.centre;
      const world = { land, landMessage: landscape.lastMessage, creatures: lastCreatures };
      later = demoMessages(shows, world, centre.x, centre.y, lastMs);
    }
    const stepS = (still ? 0 : dtS) + advance;
    if (later.length > 0) {
      for (const timed of later) timed.afterS -= stepS;
      const due = later.filter((timed) => timed.afterS <= 0);
      later = later.filter((timed) => !due.includes(timed));
      for (const { message } of due) receive(message);
      if (due.some(({ message }) => message.type === "sky")) atmosphere.settleLight();
    }
    if (still) atmosphere.settleLight();
    PROBE.enter("atmosphere");
    const shake = atmosphere.update(stepS, {
      view: shot.view,
      cells,
      tile,
      width: WIDTH + 2 * MARGIN,
      height: HEIGHT + 2 * MARGIN,
      land,
      glowing: herd.glowing(cells),
      margin: MARGIN,
      rows: landscape.hosts,
    });
    ambient.update(stepS, {
      view: shot.view,
      cells,
      tile,
      land,
      light: sceneLight,
      raining: sceneRain !== "none",
      ending: atmosphere.ending,
    });
    leaves.update(stepS, {
      view: shot.view,
      cells,
      tile,
      plants: landscape.hosts,
      wind: still ? null : atmosphere.wind,
      ending: atmosphere.ending,
    });
    advance = 0;
    // The plants lean in the atmosphere's wind from the next frame on; a picture that must
    // not change keeps them straight.
    landscape.wind = still ? null : atmosphere.wind;
    world.scale.set(tile);
    // Under cloud the world is greyed (one filter pass); none on a clear day.
    if (atmosphere.graded !== graded) {
      graded = atmosphere.graded;
      world.filters = graded ? [atmosphere.grade] : [];
    }
    // Whole art pixels in the canvas, the fraction left by sliding the canvas itself.
    const x = -cells.x0 * tile;
    const y = -cells.y0 * tile;
    world.position.set(Math.floor(x) + MARGIN + shake.x, Math.floor(y) + MARGIN + shake.y);
    atmosphere.lights.scale.set(tile);
    atmosphere.lights.position.copyFrom(world.position);
    marker.update(stepS, entry, shot.view, cells, tile, world.position);
    // In whole device pixels: a browser smooths a picture placed between them.
    const device = window.devicePixelRatio || 1;
    const slide = (value: number): number =>
      Math.round((value - Math.floor(value)) * artPixel * device) / device;
    // Written only when they change: each write makes the browser restyle the page.
    const transform = `translate(${slide(x)}px, ${slide(y)}px)`;
    if (canvas.style.transform !== transform) canvas.style.transform = transform;
    // How dark the screen is between views: the dip's, or live the iris's (shut, 1).
    let dark = shot.dim;
    if (director.looksAhead) {
      iris.update(dtS, shot.dim, landscape.openTo);
      dark = Math.max(shot.dim, 1 - iris.open);
    } else {
      if (dip.alpha !== shot.dim) dip.alpha = shot.dim;
      if (dip.visible !== shot.dim > 0) dip.visible = shot.dim > 0;
    }
    // The scrolls lie over the canvas, out of the tint's reach: lit like a lantern by the
    // light of the moment instead (the same light the tint was made from this frame).
    const { light, tint, rain } = atmosphere.state;
    sceneLight = light;
    sceneRain = rain;
    const targetNight = automatedRun
      ? 0
      : nightVeilAlpha(sceneLight, settings.nightDimmer, settings.sleepMode);
    if (still || film) {
      currentNightAlpha = targetNight;
    } else if (currentNightAlpha < targetNight) {
      currentNightAlpha = Math.min(targetNight, currentNightAlpha + dtS * 2.6);
    } else if (currentNightAlpha > targetNight) {
      currentNightAlpha = Math.max(targetNight, currentNightAlpha - dtS * 2.6);
    }
    const wantTint = settings.sleepMode || currentNightAlpha > 0.6 ? 0x020206 : DIP_COLOUR;
    if (nightDim.tint !== wantTint) nightDim.tint = wantTint;
    if (nightDim.alpha !== currentNightAlpha) nightDim.alpha = currentNightAlpha;
    if (nightDim.visible !== currentNightAlpha > 0) nightDim.visible = currentNightAlpha > 0;

    const rawLamp = lantern(light, tint, atmosphere.ending);
    const lamp: Rgb =
      currentNightAlpha > 0.65
        ? [
            rawLamp[0] * (1 - currentNightAlpha * 0.8),
            rawLamp[1] * (1 - currentNightAlpha * 0.84),
            rawLamp[2] * (1 - currentNightAlpha * 0.88),
          ]
        : currentNightAlpha > 0
          ? [
              rawLamp[0] * (1 - currentNightAlpha * 0.5),
              rawLamp[1] * (1 - currentNightAlpha * 0.5),
              rawLamp[2] * (1 - currentNightAlpha * 0.5),
            ]
          : rawLamp;

    if (KIOSK && !desktop) {
      const wantCursor = fieldGuide.open ? "default" : "none";
      if (document.documentElement.style.cursor !== wantCursor) {
        document.documentElement.style.cursor = wantCursor;
      }
    }

    PROBE.enter("overlays");
    captions.update(dtS, lamp);
    if (!settings.showCaptions || fieldGuide.showing) {
      captions.element.style.display = "none";
    }

    const guideOpenOrClosing = fieldGuide.open || fieldGuide.showing;
    const guideSnap = guideOpenOrClosing ? herd.speciesGuide() : null;

    if (guideOpenOrClosing && guideSnap !== null) {
      card.update(dtS, null, lamp);
      const repId = fieldGuide.wantedPortraitId(guideSnap);
      const repLook = repId === null ? null : herd.portraitOf(repId);
      const repPortrait =
        repLook === null ? null : (portraits.of(repLook) ?? portraits.latestOf(repLook.id));
      fieldGuide.update(dtS, {
        guide: guideSnap,
        settings,
        portrait: repPortrait,
        clock: lastClock,
        sky: lastSky,
        lamp,
      });
    } else {
      // The card is out while the local view follows an animal and is not dipped to dark,
      // nor away visiting the place of an entry (or on its way back): it would name an
      // animal off screen.
      const away = AWAY.has(director.state.motion);
      // Its portrait is drawn as soon as the animal is chosen, in the dark of the dip (R5,
      // the optimization plan's Phase 1), over a few frames; the card waits for it, or shows
      // the animal's last one while it grows into the next.
      const chosen = shot.view === "local" && shot.subject !== null ? shot.subject : null;
      const look = chosen === null ? null : herd.portraitOf(chosen);
      const portrait = look === null ? null : (portraits.of(look) ?? portraits.latestOf(look.id));
      const following = shot.view === "local" && dark < CARD_DIM && !away ? shot.subject : null;
      const facts =
        following === null || (look !== null && portrait === null) ? null : herd.cardOf(following);
      card.update(dtS, facts === null ? null : { ...facts, portrait }, lamp);
    }

    const scrollNow = captions.state;
    const scrollShowing =
      settings.showCaptions && scrollNow.caption !== null && scrollNow.phase !== "gap";
    const miracleDot =
      fieldGuide.miracleStatus === null
        ? undefined
        : fieldGuide.miracleStatus.ready
          ? "ready"
          : "cooldown";
    const effectiveBarMode = automatedRun && !userInteracted ? "hidden" : settings.keyBarMode;
    keyBar.update(dtS, {
      mode: effectiveBarMode,
      guideOpen: fieldGuide.open,
      tab: fieldGuide.tab,
      ...(miracleDot === undefined ? {} : { miracleDot }),
      sleepMode: settings.sleepMode,
      scrollShowing,
      lamp,
    });

    if (showcase !== null && overlay !== null) {
      const { act } = showcase.now;
      overlay.show(act.line, act.title ?? "", showcase.caption, act.top === true);
    }
    // Pixi draws next (the benchmark ends the phase after the draw).
    PROBE.enter("render");
  };
  if (film) {
    // Still until a film moves it, on its own clock: the recording plays on the same one.
    app.ticker.stop();
    let clockMs = 0;
    window.__frame = (seconds) => {
      clockMs += seconds * 1000;
      if (source instanceof Recording) source.pump(clockMs);
      step(seconds * 1000);
      app.render();
    };
  } else {
    // The showcase's frame counter (`?fps`) and its reports to who runs it (`?post=`).
    const post = showcasing ? params.get("post") : null;
    const meter =
      showcase === null
        ? null
        : new FrameMeter(
            (fps) => {
              if (params.get("fps") !== null) overlay?.count(`${Math.round(fps)} FPS`);
            },
            post === null
              ? null
              : (report) => {
                  void fetch(post, { method: "POST", body: JSON.stringify(report) }).catch(
                    () => undefined,
                  );
                },
          );
    app.ticker.add((ticker) => {
      step(ticker.deltaMS);
      if (meter !== null && showcase !== null) {
        const { index, loop } = showcase.now;
        meter.frame(performance.now(), index, loop, showcase.time);
      }
    });
    // The kiosk's cap on the board (R5, ADR 0022): configurable live in Smerdino settings.
    const initialCap =
      bench !== null
        ? Number(params.get("cap") ?? 0)
        : hasSavedSettings
          ? settings.fpsCap === 60
            ? 0
            : 30
          : urlCap !== null
            ? Number(urlCap) >= 60
              ? 0
              : Number(urlCap)
            : KIOSK && !desktop
              ? 30
              : 0;
    const frameCapper = createFrameCap(app.ticker, initialCap);
    applyFpsCap = (fps: number) => {
      frameCapper.set(fps);
    };
  }
  window.__painting = () => landscape.painting;

  // The benchmark's hooks (R5, `bench.ts`): what it may do to the scene and read of it.
  bench?.attach({
    app,
    artScale: ART,
    press,
    receive,
    advance: (seconds) => {
      advance += seconds;
    },
    settled: () => landscape.settled,
    holdDay: (held) => {
      landscape.holdDay = held;
    },
    dayDue: () => landscape.dayDue,
    groundMade: () => (painter instanceof WorkerPainter ? { ...painter.made } : null),
    groundTimings: () => (painter instanceof WorkerPainter ? [...painter.timings] : []),
    boot: () => ({ ...boot }),
    newLand: () => {
      const message = landscape.lastMessage;
      if (message !== null) receive({ ...message, t_ms: message.t_ms + MS_PER_DAY });
    },
    camera: () => ({ view: shot.view, dipping: director.state.dipping }),
    sight: () => sight(shot.centre, WIDTH / TILES[shot.view], HEIGHT / TILES[shot.view]),
    land: () => landscape.current,
    animals: () => herd.subjects(),
    simMs: () => lastMs,
    creatures: () => lastCreatures,
    atmosphere: () => ({ ...atmosphere.state, ...atmosphere.counts }),
    textures,
    layers: { land: landscape.container, creatures: herd.containers },
  });
}

void start();
