const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');

class GameServer{
  constructor() {
    this.setupServer();
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
          console.log("parse error: ", e, msg);
        }
      });
      ws.on('close', (code, reason) => {
        Object.keys(this.videoPlayer).forEach(videoPlayer => {
          if(videoPlayer.host === ws.u){
            if(videoPlayer)
          }
        });
      });
    });
    
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.server.listen( 3000, function listening(){
        console.log("game started");
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
        host: user,
        sockets: []
      }
    }
  }
}

const gameServer = new GameServer();