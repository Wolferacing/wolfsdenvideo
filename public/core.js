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
  REMOVE_FROM_PLAYERS: 'remove-from-players',
  GET_PLAYERS: 'get-players'
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
      await window.AframeInjection.awaitExistance(window, 'user');
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
  setupBrowserElement() {
    const scene = document.querySelector("a-scene");
    if(!scene) {
      console.log("No a-scene tag found, is this an AFRAME scene ?");
      return;
    }
    const browser = document.createElement('a-entity');
    browser.setAttribute("position", this.params.position);
    browser.setAttribute("rotation", this.params.rotation);
    browser.setAttribute("scale", this.params.scale);
    browser.setAttribute("sq-browser", "mipMaps: 1; pixelsPerUnit: 1600; mode: local; url: about%3Ablank; afterLoadActions: [ { &quot;actionType&quot;: &quot;delayseconds&quot;, &quot;numParam1&quot;: 1}, {&quot;actionType&quot;: &quot;click2d&quot;, &quot;numParam1&quot;: 150, &quot;numParam2&quot;: 150}]");
    scene.appendChild(browser);
    this.browser = browser;
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
        var url = 'https://' + this.hostUrl + '/player.html?youtube=' + 
            encodeURIComponent(this.player.playlist[currentTrack].link) + 
            '&start=' + currentTime  + 
            '&instanceId=' + this.instanceId + 
            '&user=' + window.user.id + '-_-' + window.user.name;
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
}
window.videoPlayerCore = new Core();