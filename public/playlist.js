// Capture the current script element immediately.
const playlistPlayerScript = document.currentScript;

// Dynamically load the base player script.
const baseScript = document.createElement("script");
const currentScriptUrl = new URL(playlistPlayerScript.src);
baseScript.setAttribute("src", `${currentScriptUrl.origin}/base-player.js`);

// Once the base player script is loaded, define and instantiate our specific player.
baseScript.addEventListener("load", () => {
  var PlaylistPlayer = class extends BasePlayer {
    constructor() {
      // Pass the original script element to the base class.
      super(playlistPlayerScript);
      this.init();
    }

    async init() {
      // Run the common initialization sequence from BasePlayer.
      await super.init();

      // Now run the playlist-specific setup.
      await this.core.setupWebsocket("space", null, () => {
        this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
        this.core.sendMessage({path: Commands.SET_INSTANCE_MODE, data: 'playlist'});
      });
      // Pass the mode to the player iframe so it knows which skip time to use.
      const url = `https://${window.APP_CONFIG.HOST_URL}/?youtube=${encodeURIComponent(this.core.params.youtube)}&start=${this.core.params.start}&playlist=${this.core.params.playlist}&mute=${this.core.params.mute}&volume=${this.core.tempVolume}&instance=${this.core.params.instance}&user=${window.user.id}-_-${encodeURIComponent(window.user.name)}&mode=playlist`;
      this.core.setupBrowserElement(url);
    }
  }
  window.playlistPlayerInstance = new PlaylistPlayer();
}, false);

document.body.appendChild(baseScript);
