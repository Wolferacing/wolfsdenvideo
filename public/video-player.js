class GameSystem {
  constructor(){
    this.init();
  }
  async init() {
    if(window.AframeInjection) {
      await this.awaitExistance(window, 'user');
    }
    await this.getInstanceId();
    await this.setupWebsocket();
    
  }
  setupWebsocket(){
    return new Promise(resolve => {
      this.ws = new WebSocket('wss://' + location.host + '/');
      this.ws.onopen = (event) => {
        this.joinGame();
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