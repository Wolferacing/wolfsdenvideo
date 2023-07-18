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
  SET_VOLUME: 'set-volume',
  MUTE: 'mute',
  ADD_TO_PLAYERS: 'add-to-players',
  REMOVE_FROM_PLAYERS: 'remove-from-players',
  AUTO_SYNC: 'auto-sync',
  SKIP_BACK: 'skip-back',
  SKIP_FORWARD: 'skip-forward',
  MEASURE_LATENCY: 'measure-latency'
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
    this.imIn = false;
    this.shouldAnnounce = true;
    this.hostUrl = hostUrl;
    await this.setupCommandsScript();
    if(window.isBanter) {
      window.userJoinedCallback = async user => {
        if(this.shouldAnnounce) {
          console.log(user)
          this.saySomething({name: user.id.substr(0, 6)});
        }
      };
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
    browser.setAttribute("sq-browser", {"mipMaps": 1, "pixelsPerUnit": 1600, "mode": "local", "url": url, "afterLoadActions": [ { "actionType": "delayseconds", "numParam1": 0.75}, {"actionType": "click2d", "numParam1": 150, "numParam2": 150}]});
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
    this.playlistContainer = document.createElement('a-entity');
    this.playlistContainer.setAttribute('position', this.params.position);
    this.playlistContainer.setAttribute('rotation', this.params.rotation);
    this.setupPlaylistButton(scene, this.playlistContainer);
    this.setupVolButton(scene, true, this.playlistContainer);
    this.setupVolButton(scene, false, this.playlistContainer);
    this.setupMuteButton(scene, this.playlistContainer);
    this.setupSkipButton(scene, true, this.playlistContainer);
    this.setupSkipButton(scene, false, this.playlistContainer);
    scene.appendChild(this.playlistContainer);
  }
  setVolume(isUp) {
    if(isUp) {
      this.params.volume += 5;
      if(this.params.volume > 100) {
        this.params.volume = 100;
      }
    }else{
      this.params.volume -= 5;
      if(this.params.volume < 0) {
        this.params.volume = 0;
      }
    }
  }
  setupJoinLeaveButton() {
    const scene = document.querySelector("a-scene");
    if(!scene) {
      console.log("No a-scene tag found, is this an AFRAME scene ?");
      return;
    }
    let button;
    button = this.setupButton(scene, this.playlistContainer, '0', 'Join In', '1',  () => {
      this.imIn = !this.imIn;
      window.setText(button.object3D.id, this.imIn ? 'Skip It' : 'Join In');
      this.sendMessage({ path: this.imIn ? Commands.ADD_TO_PLAYERS : Commands.REMOVE_FROM_PLAYERS });
    }, 0.4)
  }
  setupPlaylistButton(scene, playlistContainer) {
    this.setupButton(scene, playlistContainer, '-1.5', this.isKaraoke ? 'singers' : 'playlist', '1',  ()=>{
      window.openPage("https://" + this.hostUrl + "/" + (this.isKaraoke ? 'karaoke' : 'playlist') + "/?instance=" + this.params.instance + ( this.params.playlist ? "&playlist=" + this.params.playlistId : "") + "&user=" + window.user.id +"-_-"+encodeURIComponent(window.user.name));
    })
  }
  setupVolButton(scene, isUp, playlistContainer) {
    this.setupButton(scene, playlistContainer, isUp ? 1.2 : 1.75, isUp ? '+ vol' : '- vol', '0.5',  ()=>{
        this.setVolume(isUp);
        this.sendMessage({path: Commands.SET_VOLUME, data: this.params.volume});
    })
  }
  setupSkipButton(scene, isBack, playlistContainer) {
    this.setupButton(scene, playlistContainer, isBack ? -0.575 : -0.025, isBack ? '<<' : '>>', '0.5',  () => {
        console.log({path: isBack? Commands.SKIP_BACK : Commands.SKIP_FORWARD});
        this.sendMessage({path: isBack? Commands.SKIP_BACK : Commands.SKIP_FORWARD});
    })
  }
  setupMuteButton(scene, playlistContainer) {
    this.setupButton(scene, playlistContainer, '0.65', 'mute', '0.5',  () => {
      this.params.mute = this.params.mute == 'true' ? 'false' : 'true';
      this.sendMessage({path: Commands.MUTE, data: this.params.mute});
    })
  }
  async saySomething(user) {
      const welcome = await fetch('https://say-something.glitch.me/say/' + user.name + " has joined the space!");
      const url = await welcome.text();
      const audio = new Audio("data:audio/mpeg;base64," + url);
      audio.play();
      audio.volume = 0.05;
  }
  setupButton(scene, playlistContainer, xOffset, title, width, callback, yOffset) {
    const yScale = Number(this.params.scale.split(" ")[1]);
    const playlistButton = document.createElement('a-box');
    playlistButton.setAttribute('sq-collider', '');
    playlistButton.setAttribute('sq-interactable', '');
    playlistButton.setAttribute('src', 'https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/angryimg.png?v=1689619321813');
    playlistButton.setAttribute('position', `${xOffset} ${(-yScale*0.33)-(yOffset||0)} 0`);
    playlistButton.setAttribute('depth', '0.05');
    playlistButton.setAttribute('opacity', '0.3');
    playlistButton.setAttribute('transparent', 'true');
    playlistButton.setAttribute('width', width);
    playlistButton.setAttribute('height', '0.3');
    const playlistButtonText = document.createElement('a-text');
    playlistButtonText.setAttribute('value', title);
    playlistButtonText.setAttribute('position', '0 0.01 0.03');
    playlistButtonText.setAttribute('align', 'center');
    playlistButtonText.setAttribute('scale', '0.8 0.8 0.8');
    playlistButton.appendChild(playlistButtonText);
    playlistContainer.appendChild(playlistButton);
    playlistButton.addEventListener('click', callback);
    return playlistButtonText;
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
    this.setOrDefault("volume", '20');
    this.setOrDefault("mute", 'false');
    this.setOrDefault("youtube", 'https://www.youtube.com/watch?v=L_LUpnjgPso');
    
    this.params.volume = Number(this.params.volume);
    this.params.mute = this.params.mute === 'true' ? 'true' : 'false';
  }
  setOrDefault(attr, defaultValue) {
    const value = this.currentScript.getAttribute(attr);
    this.params = this.params || {};
    this.params[attr] = value || (this.urlParams.has(attr) ? this.urlParams.get(attr) : defaultValue);
  }
  playVidya(currentTrack, currentTime, force) {
    if(this.player) {
      if(this.lastUrl !== this.player.playlist[currentTrack].link || force) {
        const url = `https://${this.hostUrl}/?youtube=${encodeURIComponent(this.player.playlist[currentTrack].link)}&mute=${this.params.mute}&volume=${this.params.volume}&start=${currentTime}&user=${window.user.id + '-_-' + encodeURIComponent(window.user.name)}`;
        // this.browser.setAttribute('sq-browser','url: ' + url);
        console.log("Playing video:", url);
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
          messageCallback ? messageCallback(event.data) : this.parseMessage(event.data);
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
  setupLatencyMeasure() {
    const measure = async () => {
      const time = Date.now();
      await this.measureLatency();
      this.currentLatency = (Date.now()-time)/2;
    };
    setInterval(measure , 5000);
    measure();
  }
  measureLatency() {
    return new Promise(resolve=>{
      this.sendMessage({path: Commands.MEASURE_LATENCY});
      this.measureLatencyResolve = resolve;
    })
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
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Responses.SYNC_TIME:
          this.playVidya(json.data.currentTrack, json.data.currentTime);
        break;
      case Responses.PLAYBACK_UPDATE:
          this.player = json.data.video;
          if(json.data.type === "set-track") {
            this.playVidya(json.data.video.currentTrack, json.data.video.currentTime, true);
          }
        break;
      case Responses.ERROR:
        alert("I cant let you do that...");
        break;
      case Commands.MEASURE_LATENCY:
        if(this.measureLatencyResolve){
          this.measureLatencyResolve();
          this.measureLatencyResolve = null;
        }
        break;
    }
  }
  setupCommandsScript(callback) {
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", `https://${this.hostUrl}/commands.js?1`);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);  
    });
  }
}
window.videoPlayerCore = new Core();