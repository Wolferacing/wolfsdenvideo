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
      ws.t = new Date().getTime();
      ws.on('message', msg => {
        try{
          this.parseMessage(JSON.parse(msg), ws);
        }catch(e) {
          console.log("parse error: ", e, msg);
        }
      });
      ws.on('close', (code, reason) => {
        Object.keys(this.videoPlayers).forEach(key => {
          const videoPlayer = this.videoPlayers[key];
          if(videoPlayer.host === ws.u){
            videoPlayer.sockets = videoPlayer.sockets.filter(_ws => _ws.u !== videoPlayer.host);
            videoPlayer.sockets.sort((a,b) => a.time - b.time);
            if(!videoPlayer.sockets.length) {
              delete this.videoPlayers[key];
              console.log("No users left, deleting video player...");
            }else{
              videoPlayer.host = videoPlayer.sockets[0].u;
              this.send(videoPlayer.sockets[0], 'you-are-host');
              console.log("Making", videoPlayer.sockets[0].u, "the new host...");
            }
          }
        });
      });
    });
    
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.server.listen( 3000, function listening(){
        console.log("game started"); 
    });
  }
  send(socket, path, data) {
     socket.send(JSON.stringify({path}));
  }
  parseMessage(msg, ws){
    switch(msg.path) {
      case "instance":
        if(msg.u) {
          ws.u = msg.u;
          ws.i = msg.data;
        }
        this.tryCreateVideoPlayer(msg.data, msg.u, ws);
        break;
      case "current-time":
        this.trySetVideoTime(msg.data, ws);
        break
    }
  }
  trySetVideoTime(time, ws) {
    if(ws.u && ws.i) {
      if(this.videoPlayers[ws.i] && this.videoPlayers[ws.i].host === ws.u) {
        this.videoPlayers[ws.i].currentTime = time;
      }else{
        this.send(ws, 'you-are-not-host');
      }
    }else{
      this.send(ws, 'error');
    }
  }
  tryCreateVideoPlayer(instanceId, user, ws) {
    if(!this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId] = {
        playlist:[],
        currentTime: 0,
        host: user,
        sockets: [ws]
      };
      this.send(this.videoPlayers[instanceId].sockets[0], 'you-are-host');
      console.log("Making", this.videoPlayers[instanceId].sockets[0].u, "host...");
    }
  }
}

const gameServer = new GameServer();