class KaraokePlayer {
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.setupScripts(() => this.init());
  }
  async init() {
    this.core = window.videoPlayerCore;
    this.core.isKaraoke = true;
    this.core.parseParams(this.currentScript);
    this.core.setupBrowserElement();
    await this.core.init(this.hostUrl);
    await this.core.setupWebsocket();
    this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
    const youtubeUrl = this.core.urlParams.has('youtube') ? this.core.urlParams.get('youtube') : 'https://www.youtube.com/watch?v=L_LUpnjgPso';
    const url = `https://${this.hostUrl}/?user=${window.user.id}-_-${window.user.name}&youtube=${encodeURIComponent(youtubeUrl)}&start=0`;
    this.core.browser.setAttribute('sq-browser','url: ' + url);
    this.core.setupJoinLeaveButton();
    const time = Date.now();
    await this.core.measureLatency();
    this.latency = Date.now()-time;
    console.log("latency", );
  }
  setupScripts(callback) {
    let myScript = document.createElement("script");
    myScript.setAttribute("src", `https://${this.hostUrl}/core.js`);
    myScript.addEventListener ("load", callback, false);
    document.body.appendChild(myScript);  
  }
}
new KaraokePlayer();
