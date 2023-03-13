
const Responses = {
  YOU_ARE_HOST: 'you-are-host',
  YOU_ARE_NOT_HOST: 'you-are-not-host',
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results'
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
      case Responses.YOU_ARE_HOST:
        console.log("Im host!")
        break;
      case Responses.YOU_ARE_NOT_HOST:
        console.log("Im not host!")
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
  loadVideos(videos) {
    videos.forEach(v => {
      const videoItemContainer = this.makeAndAddElement('div', null, this.videoSearchContainer);
      
      const videoThumbnail = this.makeAndAddElement('img',{height: '80px', float: 'left'}, videoItemContainer);
      
      const videoTitleAndAction = this.makeAndAddElement('div',{float: 'left', width: 'calc(100% - 180px)'}, videoItemContainer);
      
      const videoTitle = this.makeAndAddElement('div',{
        padding: '10 10', 
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
    }else{
      this.hideSearch();
    }
  }
  hideSearch() {
    this.videoSearchContainer.style.display = 'none';
    this.videoSearchContainer.innerHtml = '';
    this.searchBackDrop.style.display = 'none';
  }
  setupSearch(playlistContainer) {
    const searchContainer = this.makeAndAddElement('div', {float: 'right'}, playlistContainer);
    
    const searchInput = this.makeAndAddElement('input', {
      background: 'rgba(0,0,0,0.2)', 
      margin: '15px', 
      height: '28px',
      border: '1px solid white',
      fontSize: '20px',
      color: 'white'
    }, searchContainer);
    searchInput.placeholder = "Search...";
    
    searchInput.addEventListener('keyup', () => this.debounceSearch(searchInput.value))
  }
  setupPlaylistUI() {
    this.setupGoogleFont();
    document.querySelector('a-scene').style.display = 'none';
    const playlistContainer = this.makeAndAddElement('div', {
      position: 'relative',
      margin: 'auto',
      background: '#3f3f3f',
      color: 'white',
      height: '64px',
      font: '15px Roboto, sans-serif',
      padding: '1 30',
    });
    
    this.setupSearch(playlistContainer);
    
    const playlistTitle = this.makeAndAddElement('h2', {fontWeight: 'normal'}, playlistContainer);
    playlistTitle.innerText = "Video Playlist";
    
    
    this.videoPlaylistContainer = this.makeAndAddElement('div', {
      position: 'relative',
      background: '#cfcfcf',
      color: 'white',
      font: '15px Roboto, sans-serif',
      overflow: 'auto',
      height: 'calc(100% - 64px)',
      width: '100%'
    });
    
    this.searchBackDrop = this.makeAndAddElement('div', {
      background: 'rgba(0,0,0,0.7)',
      position: 'absolute',
      top: '66px',
      left: '0',
      height: 'calc(100% - 64px)',
      width: '100%',
      display: 'none'
    });
    
    this.searchBackDrop.addEventListener('click', () => {
      
    })
    
    this.videoSearchContainer = this.makeAndAddElement('div', {
      position: 'absolute',
      top: '26px',
      margin: '40px',
      background: '#8f8f8f',
      color: 'white',
      font: '15px Roboto, sans-serif',
      overflow: 'auto',
      height: 'calc(100% - 108px)',
      width: 'calc(100% - 80px)',
      display: 'none',
      boxShadow: 'rgba(100, 100, 111, 0.2) 0px 7px 29px 0px'
    });
      
  }
}

window.gameSystem = new GameSystem();