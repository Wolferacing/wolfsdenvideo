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
  UP_VOLUME: 'up-volume'
} 
const Responses = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results',
  ERROR:'error'
}

class Core{
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.urlParams = new URLSearchParams(window.location.search);
    console.log(this.urlParams);
  }
  async init() {
    if(window.isBanter) {
      await this.awaitExistance(window, 'user');
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
        this.generateGuestUser()
      }
    } 
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
    this.ws.send(JSON.stringify(msg));
  }
}
window.videoPlayerCore = new Core();