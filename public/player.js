class Player {
  constructor(){
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.init();
  }
  async init() {
     this.core = window.videoPlayerCore;
     this.core.parseParams(this.currentScript);
     await this.core.init(this.hostUrl);
     await this.core.setupWebsocket();
     this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
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
}