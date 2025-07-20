// Capture the current script element immediately.
const karaokePlayerScript = document.currentScript;

// Dynamically load the base player script.
const baseScript = document.createElement("script");
const currentScriptUrl = new URL(karaokePlayerScript.src);
baseScript.setAttribute("src", `${currentScriptUrl.origin}/base-player.js`);

// Once the base player script is loaded, define and instantiate our specific player.
baseScript.addEventListener("load", () => {
  var KaraokePlayer = class extends BasePlayer {
    constructor() {
      // Pass the original script element to the base class.
      super(karaokePlayerScript);
      this.init();
    }

    async init() {
      // Run the common initialization sequence from BasePlayer.
      await super.init();

      // Now run the karaoke-specific setup.
      this.core.isKaraoke = true; // Set mode after core init
      await this.core.setupWebsocket("space", null, () => {
        this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
        this.core.sendMessage({path: Commands.SET_INSTANCE_MODE, data: 'karaoke'});
      });
      const url = `https://${window.APP_CONFIG.HOST_URL}/?youtube=${encodeURIComponent(this.core.params.youtube)}&start=${this.core.params.start}&playlist=${this.core.params.playlist}&mute=${this.core.params.mute}&volume=${this.core.tempVolume}&instance=${this.core.params.instance}&user=${window.user.id}-_-${encodeURIComponent(window.user.name)}&mode=karaoke`;
      this.core.setupBrowserElement(url);
      this.core.setupJoinLeaveButton();
    }
  }
  window.karaokePlayerInstance = new KaraokePlayer();
}, false);

document.body.appendChild(baseScript);