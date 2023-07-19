class Player {
  constructor(){
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.init();
  }
  async init() {
    this.currentTime = 0;
     await this.setupCoreScript();
     this.core = window.videoPlayerCore;
     this.core.parseParams(this.currentScript);
     await this.core.init(this.hostUrl);
     await this.setupYoutubeScript();
     await this.core.setupWebsocket("player", () => this.parseMessage(event.data));
     this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
     await this.waitFor(1);
     this.startPlayerOrNot();
     // await this.waitFor(1);
     this.core.sendMessage({path: "user-video-player", data: window.user});
     this.core.setupLatencyMeasure();
     this.playPlaylist();
  }
  waitFor(seconds) {
    return new Promise(resolve => {
      setTimeout(() => resolve(), seconds * 1000);
    })
  }
  playPlaylist(shouldClear) {
    this.core.sendMessage({path: Commands.FROM_PLAYLIST, data: {id: this.core.params.playlist, shouldClear}});
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
          if(event.data == 1) {
            this.readyToPlay = true;
          }
          // console.log(event.data, Date.now());
          // if(event.data == 2 && this.player) {
          //   console.log("state paused")
          //   // this.player.playVideo();
          // }
        },
        'onReady': (event) => {
          this.player = event.target;
          this.startPlayerOrNot();
        }
      }
    });
  }
  startPlayerOrNot() {
    if(this.player && !this.isPlayerStarted && this.core.connected()) {
      this.setVolume();
      this.setMute();
      this.player.seekTo(this.currentTime ? (this.currentTime + this.core.currentLatency) : Number(this.start));
      this.player.pauseVideo();
      this.core.sendMessage({path: Commands.CLICK_BROWSER, data: {x: window.innerHeight / 2, y: window.innerWidth / 2}});
      this.isPlayerStarted = true;
    }else{
      console.log(this.player, this.isPlayerStarted, this.core.connected());
    }
  }
  showToast(text) {
    Toastify({
      text: text,
      duration: 100,
      close: true,
      gravity: "bottom", // `top` or `bottom`
      position: "right", // `left`, `center` or `right`
      stopOnFocus: true, // Prevents dismissing of toast on hover
      style: {
        background: "linear-gradient(to right, #00b09b, #96c93d)",
      },
      // onClick: function(){} // Callback after click
    }).showToast();
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Commands.SET_VOLUME:
        if(json.data >= 0 && json.data <= 100) {
          this.core.params.volume = Number(json.data);
          this.setVolume();
          this.setMute();
          this.showToast("Volume: " + (json.data) + "%");
        }
        break;
      case Commands.SKIP_BACK:
        const time = this.player.getCurrentTime() - 0.5;
        this.player.seekTo(time);
        this.showToast("Time: " + (time) + "s");
        break;
      case Commands.SKIP_FORWARD:
        const timeForward = this.player.getCurrentTime() + 0.5;
        this.player.seekTo(timeForward);
        this.showToast("Time: " + (timeForward) + "s");
        break;
      case Commands.AUTO_SYNC:
        this.autoSync = json.data;
        break;
      case Commands.PLAYBACK_UPDATE:
        console.log(json.data.type, json.data.video);
        this.playerData = json.data.video;
        if(json.data.type === "set-track" && this.readyToPlay) {
          this.playVidya(json.data.video.currentTrack, json.data.video.currentTime, true);
        }
        break;
      case Commands.MUTE:
        this.core.params.mute = json.data;
        this.showToast(this.core.params.mute === true || this.core.params.mute === 'true' ? "MUTE" : "Unmuting!");
        this.setMute();
        break;
      case Commands.MEASURE_LATENCY:
        if(this.core.measureLatencyResolve){
          this.core.measureLatencyResolve();
          this.core.measureLatencyResolve = null;
        }
        break;
      case Commands.SYNC_TIME:
        this.currentTime = json.data.currentTime;
        if(this.player && this.readyToPlay) {
          const timediff = Math.abs(this.player.getCurrentTime() - (json.data.currentTime + this.core.currentLatency));
          document.getElementById('status').innerHTML = this.player.getCurrentTime() + " - " + (json.data.currentTime + this.core.currentLatency) + " = " + timediff;
          if(timediff > 0.5 && this.autoSync) {
             this.player.seekTo(json.data.currentTime + this.core.currentLatency);
          }
          this.playVidya(json.data.currentTrack, json.data.currentTime);
        }
        break;
    }
  }
  playVidya(currentTrack, currentTime, force) {
    if(this.playerData) {
      // console.log(this.playerData.playlist[]);
      if(this.lastUrl !== this.playerData.playlist[currentTrack].link || force) {
        const url = this.playerData.playlist[currentTrack].link;
        this.player.loadVideoById(this.getId(url), currentTime);
        this.player.playVideo();
        // this.core.sendMessage({path: Commands.CLICK_BROWSER, data: {x: 150, y:150}});
        // console.log({path: Commands.CLICK_BROWSER, data: {x: 150, y:150}});
      }
      this.lastUrl = this.playerData.playlist[currentTrack].link;
    }else{
      console.log("No player data!");
    }
  }
  setMute() {
      if(this.core.params.mute == 'true' || this.core.params.volume == 0) {
        this.player.mute();
      }else{
        this.player.unMute();
      }
  }
  setVolume() {
      this.core.params.volume = Number(this.core.params.volume);
      this.player.setVolume(this.core.params.volume);
  }
  getId(url){
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : false;
  }
  setupYoutubeScript() {
    return this.setupScript("https://www.youtube.com/iframe_api");
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