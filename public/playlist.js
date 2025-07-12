class PlaylistPlayer {
  constructor() {
    this.currentScript = document.currentScript;
    this.init();
  }
  async init() {
    await this.setupConfigScript();
    await this.setupCoreScript();
    this.core = window.videoPlayerCore;
    this.core.parseParams(this.currentScript);
    // this.core.setupBrowserElement();
    await this.core.init(window.APP_CONFIG.HOST_URL);
    await this.core.setupCommandsScript();
    await this.core.setupWebsocket("space", null, () => {
      this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
    });
    const url = `https://${window.APP_CONFIG.HOST_URL}/?youtube=${encodeURIComponent(this.core.params.youtube)}&start=0&playlist=${this.core.params.playlist}&mute=${this.core.params.mute}&volume=${this.core.tempVolume}&instance=${this.core.params.instance}&user=${window.user.id}-_-${window.user.name}`;
    this.core.setupBrowserElement(url);
  }
  setupCoreScript() {
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", `https://${window.APP_CONFIG.HOST_URL}/core.js`);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);
    });
  }
  setupConfigScript() {
    // Use the script's own src attribute to reliably find the config file.
    const scriptUrl = new URL(this.currentScript.src);
    const configUrl = `${scriptUrl.origin}/config.js`;
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", configUrl);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);
    });
  }
}
new PlaylistPlayer();
