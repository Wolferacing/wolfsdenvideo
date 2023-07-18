class PlaylistPlayer {
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.setupScripts(() => this.init());
  }
  async init() {
    this.core = window.videoPlayerCore;
    this.core.parseParams(this.currentScript);
    await this.core.init(this.hostUrl);
    await this.core.setupWebsocket();
    this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
    if(this.core.params.playlist) {
      const url = `https://${this.hostUrl}/playlist/?instance=${this.core.params.instance}&playlist=${this.core.params.playlist}&user=${window.user.id}-_-${window.user.name}`;
      this.core.setupBrowserElement(url);
    }else{
      const url = `https://${this.hostUrl}/?youtube=${encodeURIComponent('https://www.youtube.com/watch?v=L_LUpnjgPso')}&start=0&user=${window.user.id}-_-${window.user.name}`;
      this.core.setupBrowserElement(url);
    }
    this.core.setupLatencyMeasure();
  }
  setupScripts(callback) {
    let myScript = document.createElement("script");
    myScript.setAttribute("src", `https://${this.hostUrl}/core.js`);
    myScript.addEventListener ("load", callback, false);
    document.body.appendChild(myScript);  
  }
}
new PlaylistPlayer();
