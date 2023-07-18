class Player {
  constructor(){
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.init();
  }
  async init() {
     await this.setupCoreScript();
     this.core = window.videoPlayerCore;
     this.core.parseParams(this.currentScript);
     await this.core.init(this.hostUrl);
    console.log(Commands);
    
     await this.setupYoutubeScript();
     await this.core.setupWebsocket(() => this.parseMessage(event.data));
     console.log({path: "instance", data: this.core.params.instance, u: window.user});
     this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
     this.core.sendMessage({path: "user-video-player", data: window.user});
     this.core.setupLatencyMeasure();
  }
  onYouTubeIframeAPIReady() {
    new YT.Player('player', {
      height: window.innerHeight,
      width: window.innerWidth,
      videoId: this.getId(decodeURIComponent(this.core.params.youtube)),
      playerVars: {
        'playsinline': 1,
        'autoplay': 0,
        'disablekb': 1,
        'controls': 0,
        'modestbranding': true,
        'cc_load_policy': 1,
        'cc_lang_pref': 'en',
        'iv_load_policy': 3,
        'origin': 'https://sq-video-player.glitch.me',
        'start': this.start ? Number(this.start) : 0
      },
      events: {
        'onStateChange': (event) => {
          // if(event.data == 2 && this.player) {
          //   this.player.playVideo();
          // }
        },
        'onReady': (event) => {
          this.player = event.target;
          this.setVolume();
          this.setMute();
          this.player.seekTo(Number(this.start));

        }
      }
    });
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Commands.LINK_ME:
        if(json.data === window.user.id) {
          console.log("Websocket connected.");
          this.sendMessage({path: "user-video-player", data: window.user});
        }
        break;
      case Commands.SET_VOLUME:
        if(json.data >= 0 && json.data <= 100) {
          this.volume = Number(json.data);
          this.setVolume();
          this.setMute();
        }
        break;
      case Commands.SKIP_BACK:
        this.player.seekTo(this.player.getCurrentTime() - 0.3);
        break;
      case Commands.SKIP_FORWARD:
        this.player.seekTo(this.player.getCurrentTime() + 0.3);
        break;
      case Commands.AUTO_SYNC:
        this.autoSync = json.data;
        break;
      case Commands.PLAYBACK_UPDATE:
          this.playerData = json.data.video;
          if(json.data.type === "set-track") {
            this.playVidya(json.data.video.currentTrack, json.data.video.currentTime, true);
          }
        break;
      case Commands.MUTE:
        this.mute = json.data;
        this.setMute();
        break;
      case Commands.MEASURE_LATENCY:
        if(this.measureLatencyResolve){
          this.measureLatencyResolve();
          this.measureLatencyResolve = null;
        }
        break;
      case Commands.SYNC_TIME:
        const timediff = Math.abs(this.player.getCurrentTime() - json.data.currentTime + this.currentLatency);
        document.getElementById('status').innerHTML = this.player.getCurrentTime() + " - " + json.data.currentTime + " = " + timediff;
        if(timediff > 0.75 && this.autoSync) {
           this.player.seekTo(json.data.currentTime + this.currentLatency);
        }
        this.playVidya(json.data.currentTrack, json.data.currentTime);
        break;
    }
  }
  playVidya(currentTrack, currentTime, force) {
    if(this.playerData) {
      if(this.lastUrl !== this.playerData.playlist[currentTrack].link || force) {
        const url = this.playerData.playlist[json.data.video.currentTrack].link;
        this.player.loadVideoById(this.getId(url), currentTime);
        console.log("Playing video:", url);
      }
      this.lastUrl = this.playerData.playlist[currentTrack].link;
    }else{
      console.log("No player data!");
    }
  }
  setMute() {
      if(this.mute == 'true' || this.volume == 0) {
        this.player.mute();
      }else{
        this.player.unMute();
      }
  }
  setVolume() {
      this.volume = Number(this.volume);
      this.player.setVolume(this.volume);
  }
  getId(url){
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : false;
  }
  setupYoutubeScript() {
    return this.setupScript("https://www.youtube.com/iframe_api");
    // var tag = document.createElement('script');
    // tag.src = "https://www.youtube.com/iframe_api";
    // var firstScriptTag = document.getElementsByTagName('script')[0];
    // firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    
  }
  setupCoreScript() {
    return this.setupScript(`https://${this.hostUrl}/core.js`);
  }
  setupScript(script) {
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", script);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);  
    });
  }
}
const player = new Player();
function onYouTubeIframeAPIReady() {
  player.onYouTubeIframeAPIReady();
}