class Core{
  constructor() {
    this.urlParams = new URLSearchParams(window.location.search);
  }
  async init(hostUrl) {
    this.currentLatency = 0;
    this.imIn = false;
    this.hostUrl = hostUrl;
    await this.setupCommandsScript();
    if(window.isBanter) {
      window.userJoinedCallback = async user => {
        if(this.params.announce === 'true') {
          this.saySomething({name: user.id.substr(0, 6)});
        }
      };
      let lastSendTime = Date.now();
      const positionOfBrowser = this.params.position.split(" ");
      window.userPoseCallback = async pose => {
        if(this.params.spatial === 'true') {
          const a = userinputs.head.position.x - positionOfBrowser[0];
          const b = userinputs.head.position.y - positionOfBrowser[1];
          const c = userinputs.head.position.z - positionOfBrowser[2];
          const distance = Math.sqrt(a * a + b * b + c * c);
          let volume =  ((40 - distance) / 40);
          if(volume > 1) {
            volume = 1;
          }else if(volume < 0) {
            volume = 0;
          }
          const now = Date.now();
          if(now - lastSendTime > 1000) {
            // console.log({path: Commands.SET_VOLUME, data: this.params.volume}, this.params.spatial)
            lastSendTime = now;
            const roundedVolume = Math.round((this.params.volume * volume) / 5) * 5;
            if(this.tempVolume != roundedVolume) {
              this.sendMessage({path: Commands.SET_VOLUME, data: roundedVolume, type: 'spatial'});
            }
            this.tempVolume = roundedVolume; 
          }
        }
      }
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
    if(this.params.is3d === 'true') {
      browser.setAttribute("sq-custommaterial", "shaderName: Banter/StereoscopicUnlit;");
    }
    browser.setAttribute("sq-browser", {"mipMaps": 1, "pixelsPerUnit": 1600, "mode": "local", "url": url});// , "afterLoadActions": [ { "actionType": "delayseconds", "numParam1": 5}, {"actionType": "click2d", "numParam1": 1, "numParam2": 1}]
    scene.appendChild(browser);
    this.browser = browser;
    this.setupBrowserUi();
  }
  clickBrowser(x,y) {
    this.browser.components['sq-browser'].runActions([{actionType: "click2d", numParam1: x, numParam2: y}])
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
    button = this.setupButton(scene, this.playlistContainer, '-1.030', 'join in', '1',  'large',  () => {
      this.imIn = !this.imIn;
      window.setText(button.object3D.id, this.imIn ? 'skip it' : 'join in');
      this.sendMessage({ path: this.imIn ? Commands.ADD_TO_PLAYERS : Commands.REMOVE_FROM_PLAYERS });
    }, 0);
    
    const yScale = Number(this.params.scale.split(" ")[1]);
     const playlistButton = document.createElement('a-plane');
    playlistButton.setAttribute('sq-boxcollider', 'size: 1 0.3 0.05');
    playlistButton.setAttribute('sq-interactable', '');
    playlistButton.setAttribute('src', 'https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/image.png?v=1689772204522');
    playlistButton.setAttribute('position', `0 ${-yScale*0.335-0.7} 2`);
    playlistButton.setAttribute('rotation', `-30 180 0`);
    playlistButton.setAttribute('depth', '0.05');
    playlistButton.setAttribute('opacity', '0.3');
    playlistButton.setAttribute('transparent', 'true');
    playlistButton.setAttribute('width', '1');
    playlistButton.setAttribute('height', '0.3');
    this.playlistContainer.appendChild(playlistButton);
    playlistButton.addEventListener('click', () => this.openPlaylist());
  }
  setupPlaylistButton(scene, playlistContainer) {
    this.setupButton(scene, playlistContainer, '-1.7', this.isKaraoke ? 'singers' : 'playlist', '1',  'large',  ()=>{
      this.openPlaylist();
    })
  }
  openPlaylist() {
    window.openPage("https://" + this.hostUrl + "/" + (this.isKaraoke ? 'karaoke' : 'playlist') + "/?instance=" + this.params.instance + ( this.params.playlist ? "&playlist=" + this.params.playlistId : "") + "&user=" + window.user.id +"-_-"+encodeURIComponent(window.user.name));
  }
  setupVolButton(scene, isUp, playlistContainer) {
    this.setupButton(scene, playlistContainer, isUp ? 1.25 : 1.78, isUp ? '+ vol' : '- vol', '0.5', 'medium', ()=>{
        this.setVolume(isUp);
      console.warn({path: Commands.SET_VOLUME, data: this.params.volume});
        this.sendMessage({path: Commands.SET_VOLUME, data: this.params.volume});
    })
  }
  setupSkipButton(scene, isBack, playlistContainer) {
    this.setupButton(scene, playlistContainer, isBack ? -0.475 : -0.125, isBack ? '<<' : '>>', '0.5',  'small', () => {
        this.sendMessage({path: isBack? Commands.SKIP_BACK : Commands.SKIP_FORWARD});
    })
  }
  setupMuteButton(scene, playlistContainer) {
    this.setupButton(scene, playlistContainer, '0.73', 'mute', '0.5',  'medium', () => {
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
  setupButton(scene, playlistContainer, xOffset, title, width, size, callback, yOffset) {
    const yScale = Number(this.params.scale.split(" ")[1]);
    const buttonContainer = document.createElement('a-entity');
    
    buttonContainer.setAttribute('position', `${xOffset} ${(-yScale*0.335)-(yOffset||0)} 0`);
    const playlistButton = document.createElement('a-entity');
    playlistButton.setAttribute('sq-boxcollider', `size: ${size == 'small' ? '0.3 0.2 0.05': size == 'medium' ? '0.45 0.2 0.05' : '0.6 0.2 0.05' }`);
    playlistButton.setAttribute('sq-interactable', '');
    playlistButton.setAttribute('src', 'https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/angryimg.png?v=1689619321813');
    
    const glb = size == 'small' ? 'https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonS.glb?v=1689782700343' 
    : size == 'medium' ? 'https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonM.glb?v=1689785121891'
    : 'https://cdn.glitch.global/cf03534b-1293-4351-8903-ba15ffa931d3/ButtonL.glb?v=1689782699922';
    
    playlistButton.setAttribute('gltf-model',glb);
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
    buttonContainer.appendChild(playlistButtonText);
    buttonContainer.appendChild(playlistButton);
    playlistContainer.appendChild(buttonContainer);
    playlistButton.addEventListener('click', ()=>{
      console.log("click");
      callback();
    });
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
    this.setOrDefault("volume", '40');
    this.setOrDefault("mute", 'false');
    this.setOrDefault("is3d", 'false');
    this.setOrDefault("announce", 'true');
    this.setOrDefault("spatial", 'true');
    this.setOrDefault("youtube", 'https://www.youtube.com/watch?v=L_LUpnjgPso');
    
    this.params.volume = Number(this.params.volume);
    this.params.mute = this.params.mute === 'true' ? 'true' : 'false';
  }
  setOrDefault(attr, defaultValue) {
    const value = this.currentScript.getAttribute(attr);
    this.params = this.params || {};
    this.params[attr] = value || (this.urlParams.has(attr) ? this.urlParams.get(attr) : defaultValue);
  }
  setupWebsocket(type, messageCallback){
    return new Promise(resolve => {
      this.ws = new WebSocket('wss://' + this.hostUrl + '/');
      this.ws.onopen = (event) => {
        console.log("Websocket connected!");
        resolve();
        this.sendMessage({path: Commands.SET_WS_TYPE, data: type})
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
            this.setupWebsocket(type, messageCallback);
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
      this.currentLatency = (Date.now()-time)/2/1000;
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
  connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
  sendMessage(msg){
    msg.u = window.user;
    if(this.connected()) {
      this.ws.send(JSON.stringify(msg));
    }
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
      case Commands.ERROR:
        alert("I cant let you do that...");
        break;
      case Commands.MEASURE_LATENCY:
        if(this.measureLatencyResolve){
          this.measureLatencyResolve();
          this.measureLatencyResolve = null;
        }
        break;
      case Commands.CLICK_BROWSER:
        if(window.isBanter) {
          this.clickBrowser(json.data.x,json.data.y);
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