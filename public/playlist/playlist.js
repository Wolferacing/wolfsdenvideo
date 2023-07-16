class Playlist {
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.setupScripts(() => this.init());
  }
  async init() {
    this.core = window.videoPlayerCore;
    this.core.parseParams(this.currentScript);
    await this.core.init(this.hostUrl);
    await this.core.setupWebsocket(d => this.parseMessage(d));
    this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
  }
  playPlaylist(shouldClear) {
    this.sendMessage({path: Commands.FROM_PLAYLIST, data: {id: this.playlistId, shouldClear}, u: window.user});
  }
  clearPlaylist() {
    this.sendMessage({path: Commands.CLEAR_PLAYLIST, u: window.user});
  }
  generateGuestUser() {
    const id = this.getUniquId();
    window.user = {id, name: "Guest " + id};
    localStorage.setItem('user', JSON.stringify(window.user));
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Responses.SYNC_TIME:
          this.core.playVidya(json.data.currentTrack, json.data.currentTime);
        break;
      case Responses.PLAYBACK_UPDATE:
          this.core.player = json.data.video;
          if(json.data.type === "set-track") {
            this.core.playVidya(json.data.video.currentTrack, json.data.video.currentTime, true);
          }
        break;
      case Responses.ERROR:
        alert("I cant let you do that...");
        break;
    }
  }
  setupScripts(callback) {
    let myScript = document.createElement("script");
    myScript.setAttribute("src", `https://${this.hostUrl}/core.js`);
    myScript.addEventListener ("load", callback, false);
    document.body.appendChild(myScript);  
  }
}
new Playlist();