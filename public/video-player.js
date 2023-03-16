
const Responses = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results',
  ERROR:'error'
}

const Commands = {
  SEARCH: 'search',
  SET_TIME: 'set-time',
  SET_TRACK: 'set-track',
  TOGGLE_LOCK: 'toggle-lock',
  TOGGLE_CAN_TAKE_OVER: 'toggle-can-take-over',
  ADD_TO_PLAYLIST: 'add-to-playlist',
  MOVE_PLAYLIST_ITEM: 'move-playlist-item',
  REMOVE_PLAYLIST_ITEM: 'remove-playlist-item',
  TAKE_OVER: 'take-over'
} 

class GameSystem {
  constructor(){
    this.init();
  }
  async init() {
    if(window.isPlaylist) {
      this.setupPlaylistUI();
    }
    if(window.isBanter) {
      await this.awaitExistance(window, 'user');
    }else{
      try{
        //window.user = JSON.parse(localStorage.getItem('user'));
        if(!window.user) {
          this.generateGuestUser();
        }
      }catch{
        this.generateGuestUser()
      }
    } 
    this.urlParams = new URLSearchParams(window.location.search);
    this.instanceId = this.urlParams.get("instanceId");
    await this.getInstanceId();
    await this.setupWebsocket();
  }
  generateGuestUser() {
    const id = this.getUniquId();
    window.user = {id, name: "Guest " + id};
    localStorage.setItem('user', JSON.stringify(window.user));
  }
  setupWebsocket(){
    return new Promise(resolve => {
      this.ws = new WebSocket('wss://' + location.host + '/');
      this.ws.onopen = (event) => {
        this.sendMessage({path: "instance", data: this.instanceId, u: window.user});
        resolve();
      };
      this.ws.onmessage = (event) => {
        if(typeof event.data === 'string'){
          this.parseMessage(event.data);
        }
      }
      this.ws.onclose =  (event) => {
        setTimeout(() => {
          if(window.isBanter) {
            this.setupWebsocket();
          }else{
            window.location.reload();
          } 
        }, 1000);
      };
    });
  } 
  playVidya(vidya, currentTrack, currentTime, force) {
    if(this.player) {
      if(this.lastUrl !== this.player.playlist[currentTrack].link || force) {
        vidya.currentTime = currentTime;
        vidya.src = this.player.playlist[currentTrack].link;
      }
      if(Math.abs(currentTime - vidya.currentTime) > 5) {
        // vidya.currentTime = json.data.currentTime;
      }
      this.lastUrl = this.player.playlist[currentTrack].link;
    }
  }
  parseMessage(msg) {
    const vidya = document.getElementById('youtube-video');
    const json = JSON.parse(msg);
    switch(json.path) {
      case Responses.SYNC_TIME:
        if(!window.isPlaylist) {
          if(vidya) {
            this.playVidya(vidya, json.data.currentTrack, json.data.currentTime);
          }
        }else{
          const currentTime = document.querySelector('.currentTime');
          if(currentTime != null) {
            currentTime.style.width = ((json.data.currentTime / json.data.duration) * 100) + "%";
          }
          
          const currentTimeText = document.querySelector('.currentTimeText');
          if(currentTimeText != null) {
            currentTimeText.innerText = this.timeCode(json.data.currentTime) + " / " + this.timeCode(json.data.duration);
          }
        }
        break;
      case Responses.PLAYBACK_UPDATE:
        this.player = json.data.video;
        if(window.isPlaylist) {
          this.updatePlaylist(this.player);
        }else{
          if(vidya && json.data.type === "set-track") {
            this.playVidya(vidya, json.data.video.currentTrack, json.data.video.currentTime, true);
          }
        }
        break;
      case Responses.SEARCH_RESULTS:
        if(window.isPlaylist) {
          this.loadVideos(json.data);
        }
        break;
      case Responses.ERROR:
        alert("I cant let you do that...");
        break;
    }
  }
  getUniquId() {
    return (Math.random() + 1).toString(36).substring(7);
  }
  async getInstanceId() {
    return new Promise(resolve => {
      if(!this.instanceId) {
        let id = this.getUniquId();
        if(location.href.includes('?')) {
          window.location.href = location.href + "&instanceId=" + id;
        }else{
          window.location.href = location.href + "?instanceId=" + id;
        }
      }else{
        resolve();
      }
    });
  }
  awaitExistance(parent, object) {
    return new Promise(resolve => {
      this.waitAndTry(parent, object, resolve);
    })
  }
  waitAndTry(parent, object, callback){
    if(parent[object]) {
        callback();
    }else{
        setTimeout(() => this.waitAndTry(parent, object, callback));
    }
  }
  sendMessage(msg){
    this.ws.send(JSON.stringify(msg));
  }
  makeAndAddElement(type, style, parent) {
    const element = document.createElement(type);
    Object.assign(element.style, style || {});
    (parent ? parent : document.body).appendChild(element);
    return element;
  }
  search(data) {
    this.sendMessage({path: 'search', data });
  }
  updatePlaylist(player) {
    const isMe = player.host.id === window.user.id;
    this.lockPlayer.innerText = player.locked ? 'Unlock' : 'Lock';
    this.lockPlayer.className = player.locked ? 'button slim teal' : 'button slim red';
    this.takeOver.style.display = (player.canTakeOver || isMe) ? 'inline-block' : 'none';
    this.takeOver.innerText = player.canTakeOver ? (isMe ? 'Disable Transfer' : 'Take Over')'rocket_launch' : 'rocket';
    this.hostTitle.innerText = 
      'Welcome ' + window.user.name + '.' +
      (isMe ? 'You are' : player.host.name + ' is') +
      " the host" + 
      (player.canTakeOver ? " but it can be taken over ( click the rocket " + (isMe ? "again to disable" : "to take over") + " )!": "") +
      (player.locked && !player.canTakeOver ? " and it's locked!" : !player.canTakeOver ? "." : "");
    this.videoPlaylistContainer.innerHTML = '';
    player.playlist.forEach((v, i) => {
      const videoItemContainer = this.makeAndAddElement('div', {background: player.currentTrack === i ? '#4f4f4f' : i % 2 === 0 ? '#8f8f8f' : '#9f9f9f'}, this.videoPlaylistContainer);
      
      const videoThumbnail = this.makeAndAddElement('img',{height: '80px', width: '142px', float: 'left'}, videoItemContainer);
      
      const videoTitleAndAction = this.makeAndAddElement('div',{float: 'left', width: 'calc(100% - 180px)'}, videoItemContainer);
      
      const videoTitle = this.makeAndAddElement('div',{
        padding: '7 10', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        whiteSpace: 'nowrap'
      }, videoTitleAndAction);
      
      videoThumbnail.src = v.thumbnail;
      
      videoTitle.innerText = v.title;
      if(player.currentTrack !== i) {
      
        const playTrack = this.makeAndAddElement('div',null, videoTitleAndAction);

      
        playTrack.className = 'button green';
        playTrack.innerText = "Play Now";

        playTrack.addEventListener('click', () => {
          this.sendMessage({path: Commands.SET_TRACK, data: i });
        });

        const moveDown = this.makeAndAddElement('div',null, videoTitleAndAction);

        moveDown.className = 'button teal';
        moveDown.innerText = "Move Down";

        moveDown.addEventListener('click', () => {
          this.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: i + 1}  });
        });

        const moveUp = this.makeAndAddElement('div',null, videoTitleAndAction);
        moveUp.className = 'button teal';
        moveUp.innerText = "Move Up";

        moveUp.addEventListener('click', () => {
          this.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: i - 1} });
        });

        const remove = this.makeAndAddElement('div',null, videoTitleAndAction);

        remove.className = 'button red';
        remove.innerText = "Remove";

        remove.addEventListener('click', () => {
          this.sendMessage({path: Commands.REMOVE_PLAYLIST_ITEM, data: i });
        });
      }else{
        
        const videoTitle = this.makeAndAddElement('div',{
          padding: '7 10', 
          textOverflow: 'ellipsis', 
          overflow: 'hidden', 
          whiteSpace: 'nowrap'
        }, videoTitleAndAction);


        videoTitle.className = "currentTimeText";
        videoTitle.innerText = this.timeCode(player.currentTime) + " / " + this.timeCode(player.duration);
      }
      
      this.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
      
      if(player.currentTrack === i) {
        const currentTime = this.makeAndAddElement('div', {
          height: '4px', 
          width: '100%',
        }, videoItemContainer);
        const currentTimeInner = this.makeAndAddElement('div', {
          height: '4px', 
          background: 'red',
          transition: 'width 3s',
          transitionTimingFunction: 'linear',
          width: ((player.currentTime / player.duration) * 100) + "%",
        }, currentTime);
        
        currentTimeInner.className = "currentTime";
      }
    })
  }
  timeCode(seconds) {
    return new Date(seconds * 1000).toISOString().substring(14, 19);
  }
  loadVideos(videos) {
    this.videoSearchContainer.innerHTML = '';
    this.loadingSpinner.style.display = 'none';
    videos.forEach((v, i) => {
      const videoItemContainer = this.makeAndAddElement('div', {background: i % 2 === 0 ? '#8f8f8f' : '#9f9f9f'}, this.videoSearchContainer);
      
      const videoThumbnail = this.makeAndAddElement('img',{height: '80px', width: '142px', float: 'left'}, videoItemContainer);
      
      const videoTitleAndAction = this.makeAndAddElement('div',{float: 'left', width: 'calc(100% - 180px)'}, videoItemContainer);
      
      const videoTitle = this.makeAndAddElement('div',{
        padding: '7 10', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        whiteSpace: 'nowrap'
      }, videoTitleAndAction);
      
      const addToPlaylist = this.makeAndAddElement('div',null, videoTitleAndAction);
      
      addToPlaylist.className = 'button teal';
      addToPlaylist.innerText = "Add To Playlist";
      
      addToPlaylist.addEventListener('click', () => {
        this.sendMessage({path: Commands.ADD_TO_PLAYLIST, data: v });
      }); 
      
      
      const playNow = this.makeAndAddElement('div',null, videoTitleAndAction);
      
      playNow.className = 'button teal';
      playNow.innerText = "Play Now";
      
      playNow.addEventListener('click', () => {
        this.hideSearch();
        this.sendMessage({path: Commands.ADD_TO_PLAYLIST, data: v });
        this.sendMessage({path: Commands.SET_TRACK, data: this.player.playlist.length });
      }); 
      
      const playNext = this.makeAndAddElement('div',null, videoTitleAndAction);
      
      playNext.className = 'button teal';
      playNext.innerText = "Play Next";
      
      playNext.addEventListener('click', () => {
        this.sendMessage({path: Commands.ADD_TO_PLAYLIST, data: v });
        this.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: this.player.currentTrack + 1} });
      }); 
      
      
      this.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
      
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
  setupPlaylistUI() {
    
    this.searchInput = document.querySelector('.searchInput');
    this.searchInput.addEventListener('keyup', () => this.debounceSearch(this.searchInput.value))
    
    this.videoPlaylistContainer = document.querySelector('.videoPlaylistContainer');
    
    this.searchBackDrop = document.querySelector('.searchBackDrop');
      
    this.searchBackDrop.addEventListener('click', () => this.hideSearch());
    
    this.videoSearchContainer = document.querySelector('.videoSearchContainer');
    
    this.loadingSpinner = document.querySelector('.loadingSpinner');
    
    this.lockPlayer = document.querySelector('#lockPlayer');
    
    this.lockPlayer.addEventListener('click', () => {
        this.sendMessage({ path: Commands.TOGGLE_LOCK, data: !this.player.locked });
    });
    
    this.takeOver = document.querySelector('#takeOver');
    
    this.takeOver.addEventListener('click', () => {
        if(this.player.host.id === window.user.id) {
          this.sendMessage({ path: Commands.TOGGLE_CAN_TAKE_OVER, data: !this.player.canTakeOver });
        }else{
          this.sendMessage({ path: Commands.TAKE_OVER });
        }
    });
    
    this.hostTitle = document.querySelector('.hostTitle');
  }
}

window.gameSystem = new GameSystem();