var KaraokePlayer = class {
  constructor() {
    this.currentScript = document.currentScript;
    this.init();
  }
  async init() {
    await this.setupConfigScript();
    await this.setupCoreScript();
    this.core = window.videoPlayerCore;
    this.core.hostUrl = window.APP_CONFIG.HOST_URL;
    this.core.isKaraoke = true;
    this.core.parseParams(this.currentScript);
    await this.core.setupCommandsScript(); // Load Commands before core.init
    await this.core.init();
    await this.core.setupWebsocket("space", null, () => {
      this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
      this.core.sendMessage({path: Commands.SET_INSTANCE_MODE, data: 'karaoke'});
    });
    const url = `https://${window.APP_CONFIG.HOST_URL}/?youtube=${
    encodeURIComponent(this.core.params.youtube)
      }&start=0&playlist=${this.core.params.playlist
      }&mute=${this.core.params.mute
      }&volume=${this.core.tempVolume
      }&instance=${this.core.params.instance
      }&user=${window.user.id}-_-${encodeURIComponent(window.user.name)}`;
    this.core.setupBrowserElement(url);
    this.core.setupJoinLeaveButton();
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
  setupYoutubePlayer() {
    const youtubeUrl = 'https://www.youtube.com/watch?v=GiwStUzx8fg'; // Default video (Silence)
    new YT.Player('player', {
      height: '100%',
      width: '100%',
      videoId: this.core.getId(decodeURIComponent(youtubeUrl)),
      playerVars: {
        'playsinline': 1,
        'mute': 1,
        'autoplay': 1,
        'disablekb': 1,
        'controls': 0,
        'modestbranding': true,
        'cc_load_policy': 1,
        'cc_lang_pref': 'en',
        'iv_load_policy': 3,
        'origin': window.location.origin,
        'start': this.start ? Number(this.start) : 0
      },
      events: {
        'onReady': (event) => {
          this.YtPlayer = event.target;
          this.YtPlayer.setVolume(0);
        }
      }
    });
  }
}
window.karaokePlayerInstance = new KaraokePlayer();

function onYouTubeIframeAPIReady() {
  if (window.karaokeUiInstance) {
    window.karaokeUiInstance.setupYoutubePlayer();
  }
}