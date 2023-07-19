class Karaoke{
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.init();
  }
  async init() {
    await this.setupCoreScript();
    this.core = window.videoPlayerCore;
    this.core.parseParams(this.currentScript);
    this.setupKaraokeUI();
    await this.core.init(this.hostUrl);
    await this.core.setupWebsocket(d => this.parseMessage(d));
    this.core.sendMessage({path: "instance", data: this.core.params.instance});
    this.addYoutubeScript();
  }
  addYoutubeScript() {
    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  }
  setupKaraokeUI() {
    this.searchInput = document.querySelector('.searchInput');
    this.searchInput.addEventListener('keyup', () => this.debounceSearch(this.searchInput.value));
    
    this.fullscreenButton = document.querySelector('.fullscreenButton');
    
    this.fullscreenButton.addEventListener('click', () => {
        this.toggleVideoFullscreen();
    });
    
    
    this.autoSync = document.querySelector('#autoSync');
    
    this.autoSyncEnabled = false;
    
    this.autoSync.addEventListener('click', () => {
      this.autoSyncEnabled = !this.autoSyncEnabled;
      this.autoSync.innerText = this.autoSyncEnabled ? "Disable Auto Sync" : "Enable Auto Sync";
      this.core.sendMessage({ path: Commands.AUTO_SYNC, data: this.autoSyncEnabled});
    });
    
    this.videoPlayer = document.querySelector('#videoPlayer');
    
    this.videoPlaylistContainer = document.querySelector('.videoPlaylistContainer');
    
    this.searchBackDrop = document.querySelector('.searchBackDrop');
      
    this.searchBackDrop.addEventListener('click', () => this.hideSearch());
    
    this.videoSearchContainer = document.querySelector('.videoSearchContainer');
    
    this.loadingSpinner = document.querySelector('.loadingSpinner');
    
    this.lockPlayer = document.querySelector('#lockPlayer');
    
    this.lockPlayer.addEventListener('click', () => {
        this.core.sendMessage({ path: Commands.TOGGLE_LOCK, data: !this.core.player.locked });
    });
    
    this.takeOver = document.querySelector('#takeOver');
    
    this.takeOver.addEventListener('click', () => {
        if(this.core.player.host.id === window.user.id) {
          this.core.sendMessage({ path: Commands.TOGGLE_CAN_TAKE_OVER, data: !this.core.player.canTakeOver });
        }else{
          this.core.sendMessage({ path: Commands.TAKE_OVER });
        }
    });
    this.hostTitle = document.querySelector('.hostTitle');
  }
  setupCoreScript() {
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", `https://${this.hostUrl}/core.js`);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);
    });
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Commands.SYNC_TIME:
        const currentTime = document.querySelector('.currentTime');
        if(currentTime != null) {
          currentTime.style.width = ((json.data.currentTime / json.data.duration) * 100) + "%";
        }
        const currentTimeText = document.querySelector('.currentTimeText');
        if(currentTimeText != null) {
          currentTimeText.innerText = this.timeCode(json.data.currentTime) + " / " + this.timeCode(json.data.duration);
        }
        if(this.YtPlayer) {
          const timediff = Math.abs(this.YtPlayer.getCurrentTime() - (json.data.currentTime + this.core.currentLatency));
          if(timediff > 0.2) {
            this.YtPlayer.seekTo(json.data.currentTime + this.core.currentLatency);
          }
        }
        break;
      case Commands.PLAYBACK_UPDATE:
        this.core.player = json.data.video;
        this.updatePlaylist(this.core.player);
        break;
      case Commands.SEARCH_RESULTS:
        this.loadVideos(json.data);
        break;
      case Commands.ERROR:
        alert("I cant let you do that...");
        break;
    }
  }
  search(data) {
    console.log("search", {path: Commands.SEARCH, data })
    this.core.sendMessage({path: Commands.SEARCH, data });
  }
  updatePlaylist(player) {
    const isMe = player.host.id === window.user.id;
    this.lockPlayer.innerText = player.locked ? 'Unlock' : 'Lock';
    this.lockPlayer.className = player.locked ? 'button slim teal' : 'button slim red';
    this.lockPlayer.style.display = !isMe ? 'none' : 'inline-block';
    this.takeOver.style.display = (player.canTakeOver || isMe) ? 'inline-block' : 'none';
    const amIAPlayer = player.players.filter((p, i) => p.id === window.user.id).length > 0;
    // this.joinList.style.display = (player.locked && !isMe) || amIAPlayer ? 'none' :  'inline-block';
    // this.leaveList.style.display = !amIAPlayer ? 'none' :  'inline-block';
    this.takeOver.innerText = player.canTakeOver ? (isMe ? 'Disable Take Over' : 'Take Over') : 'Allow Take Over';
    this.takeOver.className = player.canTakeOver ? (isMe ? 'button slim red' : 'button slim teal') : 'button slim teal';
    this.hostTitle.innerText = 
      'Welcome ' + window.user.name + '.' +
      (isMe ? 'You are' : player.host.name + ' is') +
      " the host" + 
      (player.canTakeOver ? " but it can be taken over ( click " + (isMe ? "again to disable" : "to take over") + " )!": "") +
      (player.locked && !player.canTakeOver ? " and it's locked!" : !player.canTakeOver ? "." : "");
    this.videoPlaylistContainer.innerHTML = '';
    player.players.sort((a, b) => a.p - b.p);
    player.players.forEach((p, i) => {
      const videoItemContainer = this.core.makeAndAddElement('div', {background: player.currentTrack === i ? '#4f4f4f' : i % 2 === 0 ? '#8f8f8f' : '#9f9f9f'}, this.videoPlaylistContainer);

      const videoTitleAndAction = this.core.makeAndAddElement('div',{float: 'left', width: 'calc(100% - 180px)'}, videoItemContainer);
      
      const videoTitle = this.core.makeAndAddElement('div',{
        padding: '10 10 10 7', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        whiteSpace: 'nowrap', 
        fontSize: '1.7em'
      }, videoTitleAndAction);
      
      videoTitle.innerText = `${i+1}. ${p.name}`;
      this.core.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
    });
    this.videoPlayer.innerHTML = '';
    player.playlist.forEach((v, i) => {
      if(player.currentTrack === i) {
        
        this.core.makeAndAddElement('div',{clear: 'both'}, this.videoPlayer);
        
        const currentTime = this.core.makeAndAddElement('div', {
          height: '4px', 
          width: '100%',
        }, this.videoPlayer);
        const currentTimeInner = this.core.makeAndAddElement('div', {
          height: '4px', 
          background: 'red',
          transition: 'width 1s',
          transitionTimingFunction: 'linear',
          width: ((player.currentTime / player.duration) * 100) + "%",
        }, currentTime);
        
        currentTimeInner.className = "currentTime";
        
        
        const videoTitle = this.core.makeAndAddElement('div',{
          padding: '7 10 0 7', 
          textOverflow: 'ellipsis', 
          overflow: 'hidden', 
          whiteSpace: 'nowrap',
        }, this.videoPlayer);

        videoTitle.innerText = v.title;
        
        const currentTimeText = this.core.makeAndAddElement('div',{
          padding: '7 10 0 7', 
          textOverflow: 'ellipsis', 
          overflow: 'hidden', 
          whiteSpace: 'nowrap'
        }, this.videoPlayer);


        currentTimeText.className = "currentTimeText";
        currentTimeText.innerText = this.timeCode(player.currentTime) + " / " + this.timeCode(player.duration);
        if(this.YtPlayer) {
          console.log("load player!")
          this.YtPlayer.loadVideoById(this.core.getYTId(v.link), player.currentTime);
        }else{
          this.initialYoutube = v;
        }
        
      }
    })
  }
  timeCode(seconds) {
    return new Date(seconds * 1000).toISOString().substring(11, 19);
  }
  loadVideos(videos) {
    this.videoSearchContainer.innerHTML = '';
    this.loadingSpinner.style.display = 'none';
    videos.forEach((v, i) => {
      const videoItemContainer = this.core.makeAndAddElement('div', {background: i % 2 === 0 ? '#8f8f8f' : '#9f9f9f'}, this.videoSearchContainer);
      
      const videoThumbnail = this.core.makeAndAddElement('img',{height: '80px', width: '142px', float: 'left'}, videoItemContainer);
      
      const videoTitleAndAction = this.core.makeAndAddElement('div',{float: 'left', width: 'calc(100% - 180px)'}, videoItemContainer);
      
      const videoTitle = this.core.makeAndAddElement('div',{
        padding: '7 10', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        whiteSpace: 'nowrap'
      }, videoTitleAndAction);
      
      const playNow = this.core.makeAndAddElement('div',null, videoTitleAndAction);
      
      playNow.className = 'button teal';
      playNow.innerText = "Play Now";
      
      playNow.addEventListener('click', () => {
        if(this.core.player && !(this.core.player.locked || this.core.player.host === window.user.id )) {
          this.hideSearch();
          this.core.sendMessage({path: Commands.CLEAR_PLAYLIST, skipUpdate: true});
          this.core.sendMessage({path: Commands.ADD_TO_PLAYLIST, data: v });
        }
      }); 
      
      this.core.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
      
      videoThumbnail.src = v.thumbnail;
        
      videoTitle.innerText = v.title;
      
    })
  }
  debounceSearch(searchVal) {
    if(searchVal.length > 1) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.search(searchVal), 500);
      this.videoSearchContainer.style.display = 'block';
      this.searchBackDrop.style.display = 'block';
      this.loadingSpinner.style.display = 'block';
    }else{
      this.hideSearch();
    }
  }
  hideSearch() {
    this.videoSearchContainer.style.display = 'none';
    this.videoSearchContainer.innerHTML = '';
    this.searchBackDrop.style.display = 'none';
  }
  hideAddItem() {
      this.addItemContainer.style.display = 'none';
      this.addItemBackDrop.style.display = 'none';
  }
  toggleVideoFullscreen() {
    const playerContainer = document.getElementById("playerContainer");
    console.log('here');
    if(playerContainer != null) {
    console.log('here2');
      const player = document.getElementById("player");
      console.log(player.width);
      const isFullscreen = player.width != '240';
      if(isFullscreen) {
        playerContainer.style.position = "initial";
        playerContainer.style.top = "initial";
        playerContainer.style.bottom = "initial";
        playerContainer.style.left = "initial";
        playerContainer.style.right = "initial";
        player.width = '240';
        player.height = '180';
        this.fullscreenButton.innerText = "Show Fullscreen";
        this.fullscreenButton.className = "button teal fullscreenButton";
      }else{
        playerContainer.style.position = "fixed";
        playerContainer.style.top = "0";
        playerContainer.style.bottom = "0";
        playerContainer.style.left = "0";
        playerContainer.style.right = "0";
        player.width = window.innerWidth;
        player.height = window.innerHeight;
        this.fullscreenButton.innerText = "Exit Fullscreen";
        this.fullscreenButton.className = "button teal fullscreenButton fullscreenButtonOverlay";
      }
    }
  }
  setupYoutubePlayer() {
    const youtubeUrl = this.core.urlParams.has('youtube') ? this.core.urlParams.get('youtube') : 'https://www.youtube.com/watch?v=L_LUpnjgPso';
    new YT.Player('player', {
      height: '180',
      width: '240',
      videoId: this.core.getYTId(decodeURIComponent(youtubeUrl)),
      playerVars: {
        'playsinline': 1,
        'mute': 1,
        'autoplay': 1,
        'disablekb': 1,
        'controls': 1,
        'modestbranding': true,
        'cc_load_policy': 1,
        'cc_lang_pref': 'en',
        'iv_load_policy': 3,
        'origin': 'https://sq-synced-videoplayer.glitch.me',
        'start': this.start ? Number(this.start) : 0
      },
      events: {
        'onReady': (event) => {
          this.YtPlayer = event.target;
          this.YtPlayer.setVolume(0);
          if(this.initialYoutube) {
            this.YtPlayer.loadVideoById(this.core.getYTId(this.initialYoutube.link), this.core.player ? this.core.player.currentTime || 0 : 0);
          }
        }
      }
    });
  }
}
const karaoke = new Karaoke();

function onYouTubeIframeAPIReady() {
  karaoke.setupYoutubePlayer();
}