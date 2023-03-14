
const Responses = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results'
}

const Commands = {
  SEARCH: 'search',
  SET_TIME: 'set-time',
  SET_TRACK: 'set-track',
  TOGGLE_LOCK: 'toggle-lock',
  ADD_TO_PLAYLIST: 'add-to-playlist',
  MOVE_PLAYLIST_ITEM: 'move-playlist-item'
} 

class GameSystem {
  constructor(){
    this.init();
  }
  async init() {
    this.setupPlaylistUI();
    if(window.isBanter) {
      await this.awaitExistance(window, 'user');
    }else{
      const id = this.getUniquId();
      window.user = {id, name: "Guest " + id};
    }
    this.urlParams = new URLSearchParams(window.location.search);
    this.instanceId = this.urlParams.get("instanceId");
    await this.getInstanceId();
    await this.setupWebsocket();
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
        console.log(Responses.SYNC_TIME, json.data);
        break;
      case Responses.PLAYBACK_UPDATE:
        this.updatePlaylist(json.data);
        console.log("PLAYBACK_UPDATE", json.data)
        break;
      case Responses.SEARCH_RESULTS:
        this.loadVideos(json.data);
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
  setupGoogleFont() {
    const fontLink = this.makeAndAddElement('link', null, document.head);
    fontLink.setAttribute('href', 'https://fonts.googleapis.com/css2?family=Roboto&display=swap');
    fontLink.setAttribute('rel', 'stylesheet');
  }
  search(data) {
    this.sendMessage({path: 'search', data });
  }
  updatePlaylist(player) {
    this.player = player;
    this.lockPlayer.innerText = player.locked ? 'lock' : 'lock_open';
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
      
      this.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
      
      videoThumbnail.src = v.thumbnail;
      
      videoTitle.innerText = v.title;
      
    })
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
      
      const playNext = this.makeAndAddElement('div',{
        padding: '10 10', 
        display: 'inline-block',
        background: 'olive', 
        color: 'white',
        cursor: 'pointer',
        borderRadius: '3px',
        marginLeft: '15px'
      }, videoTitleAndAction);
      
      playNext.innerText = "Play Next";
      
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
    const searchInput = document.querySelector('.searchInput');
    searchInput.addEventListener('keyup', () => this.debounceSearch(searchInput.value))
    this.videoPlaylistContainer = document.querySelector('.videoPlaylistContainer');
    
    this.searchBackDrop = document.querySelector('.searchBackDrop');
      
    this.searchBackDrop.addEventListener('click', () => this.hideSearch());
    
    this.videoSearchContainer = document.querySelector('.videoSearchContainer');
    
    this.loadingSpinner = document.querySelector('.loadingSpinner');
    
    this.lockPlayer = document.querySelector('.lockPlayer');
    
    this.lockPlayer.addEventListener('click', () => {
        this.sendMessage({ path: 'toggle-lock', data: !this.player.locked });
    });
    
  }
}

window.gameSystem = new GameSystem();