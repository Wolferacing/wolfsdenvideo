class GameSystem {
  constructor(){
    this.init();
  }
  async init() {
    if(window.isBanter) {
      await this.awaitExistance(window, 'user');
    }else{
      window.user = {id: this.getUniquId()};
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
        this.sendMessage({t: "instance", d: this.instanceId, u: window.user.id});
        resolve();
      };
      this.ws.onmessage = (event) => {
        if(typeof event.data === 'string'){
          this.parseMessage(event.data);
        }
      }
      this.ws.onclose =  (event) => {
        setTimeout(() => {
          this.setupWebsocket();
        }, 1000);
      };
    });
  }
  parseMessage(msg) {
    const json = JSON.parse(event.data);
    switch(json.path) {
      case 'sync-time':
        
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
    console.log(msg);
    this.ws.send(JSON.stringify(msg));
  }
}

window.gameSystem = new GameSystem();