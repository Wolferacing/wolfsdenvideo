const Commands = {
  SEARCH: 'search',
  SET_TIME: 'set-time',
  SET_TRACK: 'set-track',
  TOGGLE_LOCK: 'toggle-lock',
  TOGGLE_CAN_TAKE_OVER: 'toggle-can-take-over',
  ADD_TO_PLAYLIST: 'add-to-playlist',
  MOVE_PLAYLIST_ITEM: 'move-playlist-item',
  REMOVE_PLAYLIST_ITEM: 'remove-playlist-item',
  TAKE_OVER: 'take-over',
  FROM_PLAYLIST: 'from-playlist',
  CLEAR_PLAYLIST: 'clear-playlist',
  DOWN_VOLUME: 'down-volume',
  UP_VOLUME: 'up-volume',
  ADD_TO_PLAYERS: 'add-to-players',
  REMOVE_FROM_PLAYERS: 'remove-from-players'
  // GET_PLAYERS: 'get-players'
} 
const Responses = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results',
  ERROR:'error',
  PLAYERS: 'players'
}

class Core{
  constructor() {
    this.urlParams = new URLSearchParams(window.location.search);
  }
  async init(hostUrl) {
    this.hostUrl = hostUrl;
    if(window.isBanter) {
      await window.AframeInjection.waitFor(window, 'user');
    }else{
      try{
        if(!window.user) {
          if(this.urlParams.has("user")) {
            var userStr = this.urlParams.get("user").split("-_-");
            window.user = {
              id: userStr[0],
              name: userStr[1]
            }
          }else{
            this.generateGuestUser();
          }
        }
      }catch{
        this.generateGuestUser();
      }
    }
  }
  setupBrowserElement(url) {
    const scene = document.querySelector("a-scene");
    if(!scene) {
      console.log("No a-scene tag found, is this an AFRAME scene ?");
      return;
    }
    const browser = document.createElement('a-entity');
    browser.setAttribute("position", this.params.position);
    browser.setAttribute("rotation", this.params.rotation);
    browser.setAttribute("scale", this.params.scale);
    browser.setAttribute("sq-browser", {"mipMaps": 1, "pixelsPerUnit": 1600, "mode": "local", "url": url, "afterLoadActions": [ { "actionType": "delayseconds", "numParam1": 1.5}, {"actionType": "click2d", "numParam1": 150, "numParam2": 150}]});
    scene.appendChild(browser);
    this.browser = browser;
    this.setupBrowserUi();
  }
  setupBrowserUi() {
     const scene = document.querySelector("a-scene");
    if(!scene) {
      console.log("No a-scene tag found, is this an AFRAME scene ?");
      return;
    }
    const playlistContainer = document.createElement('a-entity');
    playlistContainer.setAttribute('position', this.params.position);
    playlistContainer.setAttribute('rotation', this.params.rotation);
    this.setupPlaylistButton(scene, playlistContainer);
    this.setupVolButton(scene, true, playlistContainer);
    this.setupVolButton(scene, false, playlistContainer);
    scene.appendChild(playlistContainer);
  }
  setupVolButton(scene, isUp, playlistContainer) {
      const yScale = Number(this.params.scale.split(" ")[1]);
      const playlistButton = document.createElement('a-box');
      playlistButton.setAttribute('sq-collider', '');
      playlistButton.setAttribute('sq-interactable', '');
      playlistButton.setAttribute('color', '#f00075');
      playlistButton.setAttribute('position', `${isUp ? 0.8 : 1.35} ${-yScale*0.35} 0`);
      playlistButton.setAttribute('depth', '0.05');
      playlistButton.setAttribute('width', '0.5');
      playlistButton.setAttribute('height', '0.3');
      const playlistButtonText = document.createElement('a-text');
      playlistButtonText.setAttribute('value', isUp ? '+ vol' : '- vol');
      playlistButtonText.setAttribute('position', '0 0.03 0.06');
      playlistButtonText.setAttribute('align', 'center');
      playlistButton.appendChild(playlistButtonText);
      playlistContainer.appendChild(playlistButton);
      playlistButton.addEventListener('click', ()=>{
        this.sendMessage({path: isUp ? Commands.UP_VOLUME : Commands.DOWN_VOLUME});
      });
  }
  setupPlaylistButton(scene, playlistContainer) {
      const yScale = Number(this.params.scale.split(" ")[1]);
      const playlistButton = document.createElement('a-box');
      playlistButton.setAttribute('sq-collider', '');
      playlistButton.setAttribute('sq-interactable', '');
      playlistButton.setAttribute('color', '#f00075');
      playlistButton.setAttribute('position', `0 ${-yScale*0.35} 0`);
      playlistButton.setAttribute('depth', '0.05');
      playlistButton.setAttribute('width', '1');
      playlistButton.setAttribute('height', '0.3');
      const playlistButtonText = document.createElement('a-text');
      playlistButtonText.setAttribute('value', 'playlist');
      playlistButtonText.setAttribute('position', '0 0.03 0.06');
      playlistButtonText.setAttribute('align', 'center');
      playlistButton.appendChild(playlistButtonText);
      playlistContainer.appendChild(playlistButton);
      playlistButton.addEventListener('click', ()=>{
        window.openPage("https://" + this.hostUrl + "/playlist?instance=" + this.params.instance + ( this.params.playlist ? "&playlist=" + this.params.playlistId : "") + "&user=" + window.user.id +"-_-"+window.user.name);
      });
  }
  generateGuestUser() {
    const id = this.getUniquId();
    window.user = {id, name: "Guest " + id};
    localStorage.setItem('user', JSON.stringify(window.user));
  }
  getUniquId() {
    return (Math.random() + 1).toString(36).substring(7);
  }
  parseParams(currentScript) {
    this.currentScript = currentScript;
    this.setOrDefault("position", "0 0 0");
    this.setOrDefault("rotation", "0 0 0");
    this.setOrDefault("scale", "1 1 1");
    this.setOrDefault("instance", "666");
    this.setOrDefault("playlist", "");
    this.setOrDefault("volume", "0.2");
  }
  setOrDefault(attr, defaultValue) {
    const value = this.currentScript.getAttribute(attr);
    this.params = this.params || {};
    this.params[attr] = value || (this.urlParams.has(attr) ? this.urlParams.get(attr) : defaultValue);
  }
  playVidya(currentTrack, currentTime, force) {
    if(this.player) {
      if(this.lastUrl !== this.player.playlist[currentTrack].link || force) {
        const url = `https://${this.hostUrl}/?youtube=${encodeURIComponent(this.player.playlist[currentTrack].link)}&volume=${this.params.volume}&start=${currentTime}&user=${window.user.id + '-_-' + window.user.name}`;
        this.browser.setAttribute('sq-browser','url: ' + url);
        console.log("Playing video:", this.player.playlist[currentTrack].link);
      }
      this.lastUrl = this.player.playlist[currentTrack].link;
    }
  }
  setupWebsocket(messageCallback){
    return new Promise(resolve => {
      this.ws = new WebSocket('wss://' + this.hostUrl + '/');
      this.ws.onopen = (event) => {
        console.log("Websocket connected!");
        resolve();
      };
      this.ws.onmessage = (event) => {
        if(typeof event.data === 'string'){
          messageCallback(event.data);
        }
      }
      this.ws.onclose =  (event) => {
        console.log("Websocket closed...");
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
  sendMessage(msg){
    msg.u = window.user;
    this.ws.send(JSON.stringify(msg));
  }
  makeAndAddElement(type, style, parent) {
    const element = document.createElement(type);
    Object.assign(element.style, style || {});
    (parent ? parent : document.body).appendChild(element);
    return element;
  }
  getYTId(url){
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : false;
  }
}
window.videoPlayerCore = new Core();