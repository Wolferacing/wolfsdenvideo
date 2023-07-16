class Playlist {
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.setupScripts(() => this.init());
  }
  async init() {
    this.core = window.videoPlayerCore;
    this.coreparseAttributes();
    await window.videoPlayerCore.init(this.params);
  }
  setupScripts(callback) {
    let myScript = document.createElement("script");
    myScript.setAttribute("src", `https://${this.hostUrl}/core.js`);
    myScript.addEventListener ("load", callback, false);
    document.body.appendChild(myScript);  
  }
}
new Playlist();
