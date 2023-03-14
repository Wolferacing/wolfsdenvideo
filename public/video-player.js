
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
  ADD_TO_PLAYLIST: 'add-to-playlist',
  MOVE_PLAYLIST_ITEM: 'move-playlist-item',
  REMOVE_PLAYLIST_ITEM: 'remove-playlist-item'
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
  parseMessage(msg) {
    const json = JSON.parse(event.data);
    switch(json.path) {
      case Responses.SYNC_TIME:
        if(!window.isPlaylist) {
          const vidya = document.getElementById('youtube-video');
          if(vidya) {
            if(vidya.src !== json.data.playlist[json.data.currentTrack].link) {
              vidya.src = json.data.playlist[json.data.currentTrack].link;
            }
            if(Math.abs(json.data.currentTime - vidya.currentTime) > 5) {
              vidya.currentTime = json.data.currentTime;
            }
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
        if(window.isPlaylist) {
          this.updatePlaylist(json.data);
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
    this.player = player;
    this.lockPlayer.innerText = player.locked ? 'lock' : 'lock_open';
    this.hostTitle.innerText = 'Welcome ' + window.user.name + '.' + (this.player.host.id === window.user.id ? 'You are' : this.player.host.name + ' is') + " the host" + (player.locked ? ' and it\'s locked!' : '.');
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
      
        const playTrack = this.makeAndAddElement('div',{
          padding: '10 10', 
          display: 'inline-block',
          background: 'green', 
          color: 'white',
          cursor: 'pointer',
          borderRadius: '3px',
          marginLeft: '15px'
        }, videoTitleAndAction);

        playTrack.innerText = "Play Now";

        playTrack.addEventListener('click', () => {
          this.sendMessage({path: Commands.SET_TRACK, data: i });
          this.sendMessage({path: Commands.SET_TIME, data: 0 });
        });

        const moveDown = this.makeAndAddElement('div',{
          padding: '10 10', 
          display: 'inline-block',
          background: 'teal', 
          color: 'white',
          cursor: 'pointer',
          borderRadius: '3px',
          marginLeft: '15px'
        }, videoTitleAndAction);

        moveDown.innerText = "Move Down";

        moveDown.addEventListener('click', () => {
          this.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: i + 1}  });
        });

        const moveUp = this.makeAndAddElement('div',{
          padding: '10 10', 
          display: 'inline-block',
          background: 'teal', 
          color: 'white',
          cursor: 'pointer',
          borderRadius: '3px',
          marginLeft: '15px'
        }, videoTitleAndAction);

        moveUp.innerText = "Move Up";

        moveUp.addEventListener('click', () => {
          this.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: i - 1} });
        });

        const remove = this.makeAndAddElement('div',{
          padding: '10 10', 
          display: 'inline-block',
          background: 'red', 
          color: 'white',
          cursor: 'pointer',
          borderRadius: '3px',
          marginLeft: '15px'
        }, videoTitleAndAction);

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
      
      const addToPlaylist = this.makeAndAddElement('div',{
        padding: '10 10', 
        display: 'inline-block',
        background: 'teal', 
        color: 'white',
        cursor: 'pointer',
        borderRadius: '3px',
        marginLeft: '15px'
      }, videoTitleAndAction);
      
      addToPlaylist.innerText = "Add To Playlist";
      
      addToPlaylist.addEventListener('click', () => {
        this.sendMessage({path: Commands.ADD_TO_PLAYLIST, data: v });
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
    
    this.lockPlayer = document.querySelector('.lockPlayer');
    
    this.lockPlayer.addEventListener('click', () => {
        this.sendMessage({ path: 'toggle-lock', data: !this.player.locked });
    });
    
    this.hostTitle = document.querySelector('.hostTitle');
  }
}

window.gameSystem = new GameSystem();