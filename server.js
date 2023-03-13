const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');

class GameServer{
  constructor() {
    this.setupServer();
    setInterval(()=>{
      
    }, 3000)
  }
  setupServer() {
    this.app = express();
    
    this.videoPlayers = {}
    
    this.server = http.createServer( this.app );
    
    this.wss = new WebSocket.Server({ noServer: true });
    
    this.server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
    
    this.wss.startAutoPing(10000);
    
    this.wss.on('connection', (ws, req) => {
      ws.on('message', msg => {
        try{
          this.parseMessage(JSON.parse(msg), ws);
        }catch(e) {
          console.log("parse error: ", e);
        }
      });
    });
    
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.server.listen( 3000, function listening(){
        console.log("game started");
    });
  }
  cleanRoom() {
     this.wss.clients.forEach(client=>{
        if(socket === client) {
          isHere = true;
        }
      });
    const sockets = Object.keys(this.room.sockets);
    sockets.forEach(d => {
      var person = this.room.data.people[d];
      var socket = this.room.sockets[d];
      var isHere = false;
      this.wss.clients.forEach(client=>{
        if(socket === client) {
          isHere = true;
        }
      });
      if(!isHere){
        console.log(person.name, "left");
        if(person.isTagged) {
          console.log("person was tagged, game will stop.")
        }
        delete this.room.data.people[d];
        delete this.room.sockets[d];
      }
    });
  }
  parseMessage(msg, ws){
    switch(msg.t) {
      case "instance":
        this.tryCreateVideoPlayer(msg.d, msg.u);
        ws.u = msg.u;
        break;
    }
  }
  tryCreateVideoPlayer(instanceId, user) {
    if(!this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId] = {
        playlist:[],
        currentTime: 0,
        host: user
      }
    }
  }
}

const gameServer = new GameServer();