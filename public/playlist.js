class Playlist {
  constructor() {
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.setupScripts(() => this.init());
  }
  async init() {
    this.core = window.videoPlayerCore;
    this.core.parseParams(this.currentScript);
    await this.core.init(this.params);
    await this.core.setupWebsocket(d => this.parseMessage(d));
    this.core.sendMessage({path: "instance", data: this.params.instance, u: window.user});
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Responses.SYNC_TIME:
        // if(!window.isPlaylist) {
          if(this.vidya) {
            this.playVidya(this.vidya, json.data.currentTrack, json.data.currentTime);
          }
        // }else{
//           const currentTime = document.querySelector('.currentTime');
//           if(currentTime != null) {
//             currentTime.style.width = ((json.data.currentTime / json.data.duration) * 100) + "%";
//           }
          
//           const currentTimeText = document.querySelector('.currentTimeText');
//           if(currentTimeText != null) {
//             currentTimeText.innerText = this.timeCode(json.data.currentTime) + " / " + this.timeCode(json.data.duration);
//           }
        // }
        break;
      case Responses.PLAYBACK_UPDATE:
        // this.player = json.data.video;
        // if(window.isPlaylist) {
          // this.updatePlaylist(this.player);
        // }else{
          if(this.vidya && json.data.type === "set-track") {
            this.playVidya(this.vidya, json.data.video.currentTrack, json.data.video.currentTime, true);
          }
        // }
        break;
      // case Responses.SEARCH_RESULTS:
      //   if(window.isPlaylist) {
      //     this.loadVideos(json.data);
      //   }
      //   break;
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
