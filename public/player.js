const SKIP_AMOUNT_SECONDS = 5;

class Player {
  constructor(){
    this.currentScript = document.currentScript;
    this.autoSyncInterval = null;
    this.pendingTrackChange = null;
    this.init();
  }
  async init() {
     await this.setupConfigScript();
     await this.setupBrowserMessaging();
     this.initialSyncComplete = false;
     this.currentTime = 0;
     await this.setupCoreScript();
     this.core = window.videoPlayerCore;
     this.core.parseParams(this.currentScript);
     await this.core.init(window.APP_CONFIG.HOST_URL);
     await this.core.setupCommandsScript();
     await this.core.setupWebsocket("player", () => this.parseMessage(event.data), () => {
       this.setupYoutubeScript();
       this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
       this.core.sendMessage({path: "user-video-player", data: window.user});
     }, ()=>{
        this.core.showToast("Reconnecting...");
     });
     this.playPlaylist();
     window.seek = this.seek.bind(this);
  }
  setupBrowserMessaging() {
     window.addEventListener("bantermessage", (e) => this.parseMessage(e.detail.message));
  }
  sendBrowserMessage(msg) {
    if (!window.bantermessage) {
      console.log("No banter message, is this banter?");
    } else {
      window.bantermessage(JSON.stringify(msg));
    }
  }
  waitFor(seconds) {
    return new Promise(resolve => {
      setTimeout(() => resolve(), seconds * 1000);
    })
  }
  playPlaylist(shouldClear) {
    this.core.sendMessage({path: Commands.FROM_PLAYLIST, data: {id: this.core.params.playlist, shouldClear, fromPlayer: true}});
  }
  onYouTubeIframeAPIReady() {
    new YT.Player('player', {
      height: window.innerHeight,
      width: window.innerWidth,
      videoId: this.core.getId(decodeURIComponent(this.core.params.youtube)),
      playerVars: {
        'playsinline': 1,
        'autoplay': 1,
        'disablekb': 1,
        'controls': 0,
        'modestbranding': true,
        'cc_load_policy': 1,
        'cc_lang_pref': 'en',
        'iv_load_policy': 3,
        'origin': 'https://www.youtube.com',
        'start': this.start ? Number(this.start) : 0,
         'vq': 'hd1080'
      },
      events: {
        onStateChange: event => {
          if (event.data === YT.PlayerState.PLAYING) {
            if (!this.readyToPlay) {
              this.readyToPlay = true;
              // First time player is playing. Check for pending changes or initial sync.
              if (this.pendingTrackChange) {
                // A track change was received before we were ready. Apply it now.
                const data = this.pendingTrackChange;
                if (data.playlist) {
                  this.playerData.playlist = data.playlist;
                }
                this.playerData.currentTrack = data.newTrackIndex;
                this.playerData.lastStartTime = data.newLastStartTime;
                const startTime = data.newCurrentTime || 0;
                this.playVidya(this.playerData.currentTrack, startTime, true);
                this.initialSyncComplete = true;
                this.pendingTrackChange = null; // Clear the cached message
              } else if (this.playerData && this.playerData.playlist && this.playerData.playlist.length > 0 && !this.initialSyncComplete) {
                // This handles rejoining an instance that already has a playlist.
                this.playVidya(this.playerData.currentTrack, this.playerData.currentTime, true);
                this.initialSyncComplete = true;
              }
            }
          } else if (this.readyToPlay && event.data !== YT.PlayerState.PLAYING) {
            // This logic tries to force the video to keep playing.
            this.player.playVideo();
          }
        },
        onError: event => {
          // Error 150: The video owner has not made this video available in your country.
          // Error 101 is a variation of this.
          if (event.data === 150 || event.data === 101) {
            const currentVideo = this.playerData.playlist[this.playerData.currentTrack];
            if (currentVideo) {
              this.core.showToast(`Video unavailable in your region: ${currentVideo.title}`);
              this.core.sendMessage({ path: Commands.VIDEO_UNAVAILABLE, data: { link: currentVideo.link } });
            }
          }
          console.log("YT Player Error:", event.data);
        },
        onApiChange: async event => {
        },
        onReady: async event => {
          this.player = event.target; 
          this.setVolume();
          this.setMute();
          // setTimeout(() => this.startPlayerOrNot(), 500);
        }
      }
    });
  }
  startPlayerOrNot() {
    if(this.player && !this.isPlayerStarted && this.core.connected() && !this.readyToPlay) {
      this.core.sendMessage({path: Commands.CLICK_BROWSER, data: {x: window.innerHeight / 2, y: window.innerWidth / 2}});
      this.isPlayerStarted = true;
    }
  }
  seek(time) {
    if(this.player) {
      const timeForward = this.player.getCurrentTime() + time;
      this.player.seekTo(timeForward);
      return "Seeking to: " + timeForward;
    }
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Commands.SET_VOLUME:
        if(json.data >= 0 && json.data <= 100) {
          this.core.params.volume = Number(json.data);
          this.setVolume(json.type);
          this.setMute();
          this.sendBrowserMessage(json);
        }
        break;
      case Commands.SKIP_BACK:
        const time = this.player.getCurrentTime() - SKIP_AMOUNT_SECONDS;
        this.player.seekTo(time);
        this.core.showToast(`-${SKIP_AMOUNT_SECONDS}s`);
        break;
      case Commands.SKIP_FORWARD:
        const timeForward = this.player.getCurrentTime() + SKIP_AMOUNT_SECONDS;
        this.player.seekTo(timeForward);
        this.core.showToast(`+${SKIP_AMOUNT_SECONDS}s`);
        break;
      case Commands.AUTO_SYNC:
        this.autoSync = json.data;
        if (this.autoSync) {
          if (!this.autoSyncInterval) {
            this.core.showToast("AutoSync has been enabled.");
            this.autoSyncInterval = setInterval(() => {
              this.core.sendMessage({ path: Commands.REQUEST_SYNC, data: { clientTimestamp: Date.now() } });
            }, 5000); // Request sync every 5 seconds
          }
        } else if (this.autoSyncInterval) {
          this.core.showToast("AutoSync has been disabled.");
          clearInterval(this.autoSyncInterval);
          this.autoSyncInterval = null;
        }
        break;
      case Commands.PLAYBACK_UPDATE:
        // Merge new data into the existing player state.
        // This prevents the playlist from being wiped out on updates that don't include it.
        this.playerData = Object.assign(this.playerData || {}, json.data.video);
        // The specific 'set-track' logic is now handled by the TRACK_CHANGED command.
        if (json.data.type === "stop" && this.readyToPlay) {
          this.player.loadVideoById(this.core.getId("https://www.youtube.com/watch?v=_VUKfrA9oLQ"), 0);
        }
        // The initial sync is now handled by the onStateChange event when the player is ready.
        break;
      case Commands.TRACK_CHANGED:
        // This is the new authoritative command for changing tracks.
        if (this.playerData && this.readyToPlay) { // Player is ready, apply immediately.
          // If the message includes a new playlist (e.g., from add-and-play), update it.
          if (json.data.playlist) {
            this.playerData.playlist = json.data.playlist;
          }
          this.playerData.currentTrack = json.data.newTrackIndex;
          this.playerData.lastStartTime = json.data.newLastStartTime;
          // The server now provides the definitive start time.
          const startTime = json.data.newCurrentTime || 0;
          this.playVidya(this.playerData.currentTrack, startTime, true);
          this.initialSyncComplete = true; // A track change is a definitive sync.
        } else {
          // Player isn't ready. Cache the track change data to be applied when it is.
          this.pendingTrackChange = json.data;
        }
        break;
      case Commands.MUTE:
        this.core.params.mute = json.data;
        this.core.showToast(this.core.params.mute === true || this.core.params.mute === 'true' ? "mute" : "unmute");
        this.setMute();
        break;
      case Commands.SYNC_TIME:
        this.currentTime = json.data.currentTime;
        if(this.player && this.readyToPlay) {
          // Calculate latency on-the-fly from the echoed timestamp
          const roundTripTime = Date.now() - json.data.clientTimestamp;
          const latency = roundTripTime / 2 / 1000; // latency in seconds

          const serverTime = json.data.currentTime + latency;
          const localTime = this.player.getCurrentTime();
          // Positive timediff means client is BEHIND server. Negative means client is AHEAD.
          const timediff = serverTime - localTime;
          document.getElementById('status').innerHTML = `Drift: ${Math.round(timediff * 1000)}ms | Latency: ${Math.round(latency * 1000)}ms`;

          if (this.autoSync) {
            const largeDriftThreshold = 0.5; // Over this, we do a hard seek.
            const smallDriftThreshold = 0.1; // Under this, we are considered in-sync.

            if (Math.abs(timediff) > largeDriftThreshold) {
              // Large drift, a hard seek is necessary for a quick correction.
              this.core.showToast(`Resyncing: ${Math.round(timediff * 100) / 100}s`);
              this.player.seekTo(serverTime);
              this.player.setPlaybackRate(1.0); // Ensure rate is normal after a seek.
            } else if (Math.abs(timediff) > smallDriftThreshold) {
              // Small drift, adjust playback speed for a smooth, unnoticeable correction.
              // If we are behind (timediff > 0), speed up. If we are ahead (timediff < 0), slow down.
              this.player.setPlaybackRate(timediff > 0 ? 1.05 : 0.95);
            } else {
              // We are in sync, ensure playback rate is normal.
              if (this.player.getPlaybackRate() !== 1.0) {
                this.player.setPlaybackRate(1.0);
              }
            }
          }
        }
        break;
    }
  }
  playVidya(currentTrack, currentTime, force, volume) {
    if(this.playerData) {
      if(this.lastUrl !== this.playerData.playlist[currentTrack].link || force) {
        const url = this.playerData.playlist[currentTrack].link;
        this.player.loadVideoById(this.core.getId(url), currentTime);
        this.player.playVideo();
        this.core.showToast("Playing: " + this.playerData.playlist[currentTrack].title);
        this.setVolume("spatial");
      }
      this.lastUrl = this.playerData.playlist[currentTrack].link;
    }else{
      console.log("No player data!");
    }
  }
  setMute() {
    if(this.core.params.mute === 'true' || this.core.params.volume === 0) {
      this.player.mute();
    }else{
      this.player.unMute();
    }
  }
  setVolume(type) {
    this.core.params.volume = Number(this.core.params.volume);
    if(this.player.getVolume() != this.core.params.volume) {
      this.player.setVolume(this.core.params.volume);
      const isSpatial = type === "spatial";
      const showToast = () => this.core.showToast((isSpatial ? "(spatial) " : "") + "vol: " + (this.core.params.volume) + "%");
      if(isSpatial) {
        clearTimeout(this.spatialUpdateTimeout);
        this.spatialUpdateTimeout = setTimeout(() => showToast(), 600);
      }else{
        showToast();
      }
    }
  }
  setupYoutubeScript() {
    return this.setupScript("https://www.youtube.com/iframe_api");
  }
  setupCoreScript() {
    return this.setupScript(`https://${window.APP_CONFIG.HOST_URL}/core.js`);
  }
  setupConfigScript() {
    // Use the script's own src attribute to reliably find the config file.
    const scriptUrl = new URL(this.currentScript.src);
    const configUrl = `${scriptUrl.origin}/config.js`;
    return this.setupScript(configUrl);
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