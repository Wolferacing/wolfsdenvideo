
const Responses = {
  YOU_ARE_HOST: 'you-are-host',
  YOU_ARE_NOT_HOST: 'you-are-not-host',
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time'
}

class GameSystem {
  constructor(){
    this.init();
  }
  async init() {
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
          window.location.reload();
//          this.setupWebsocket();
        }, 1000);
      };
    });
  } 
  parseMessage(msg) {
    console.log(msg);
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
}

window.gameSystem = new GameSystem();