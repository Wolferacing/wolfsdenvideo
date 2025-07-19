var BasePlayer = class {
  constructor(currentScript) {
    // The 'currentScript' is passed in from the child class (e.g., PlaylistPlayer)
    // because document.currentScript would be null for this dynamically loaded script.
    this.currentScript = currentScript;
  }

  async init() {
    // This is the common initialization sequence shared by all player types.
    await this.setupConfigScript();
    await this.setupCoreScript();
    this.core = window.videoPlayerCore;
    this.core.hostUrl = window.APP_CONFIG.HOST_URL;
    this.core.parseParams(this.currentScript);
    await this.core.setupCommandsScript();
    await this.core.init();
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