// A sample user mod (mods/README.md): plain JavaScript, loaded by the renderer at run time
// from /user-mods/sample-banner/index.js. It conforms to the Mod interface of
// renderer/src/mods/types.ts: metadata, init, enable, disable, isEnabled.

export default class SampleBannerMod {
  meta = {
    id: "sample-banner",
    name: "Sample Banner",
    version: "1.0.0",
    description: "A sample user mod: a small banner at the top of the screen saying user mods are loaded.",
    author: "Lineage",
    defaultEnabled: false,
  };

  #enabled = false;
  #banner = null;

  init(ctx) {
    const banner = document.createElement("div");
    banner.textContent = "USER MODS LOADED";
    Object.assign(banner.style, {
      position: "absolute",
      top: "1%",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "2px 8px",
      background: "rgba(62, 36, 24, 0.85)",
      color: "#faf3e1",
      font: "12px monospace",
      pointerEvents: "none",
      display: "none",
    });
    ctx.frame.append(banner);
    this.#banner = banner;
  }

  enable() {
    this.#enabled = true;
    if (this.#banner) this.#banner.style.display = "";
  }

  disable() {
    this.#enabled = false;
    if (this.#banner) this.#banner.style.display = "none";
  }

  isEnabled() {
    return this.#enabled;
  }
}
