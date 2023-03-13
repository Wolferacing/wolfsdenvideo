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
        Object.keys(this.videoPlayers).forEach(key => {
          const videoPlayer = this.videoPlayers[key];
          if(videoPlayer.host === ws.u){
            videoPlayer.sockets = videoPlayer.sockets.filter(_ws => _ws.socket.u !== videoPlayer.host);
            videoPlayer.sockets.sort((a,b) => a.time - b.time);
            if(!videoPlayer.sockets.length) {
              delete this.videoPlayers[key];
              console.log("No users left, deleting video player...");
            }else{
              videoPlayer.host = videoPlayer.sockets[0];
              this.send(videoPlayer.sockets[0], 'you-are-host');
              console.log("Making", videoPlayer.sockets[0].socket.u, "the new host...");
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
     socket.socket.send(JSON.stringify({path}));
  }
  parseMessage(msg, ws){
    if(msg.u) {
      ws.u = msg.u;
    }
    switch(msg.path) {
      case "instance":
        this.tryCreateVideoPlayer(msg.data, msg.u, ws);
        break;
      case "current-time":
        this.tryCreateVideoPlayer(msg.data, msg.u, ws);
        break
    }
  }
  tryCreateVideoPlayer(instanceId, user, ws) {
    if(!this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId] = {
        playlist:[],
        currentTime: 0,
        host: user,
        sockets: [
          {
            time: new Date().getTime(),
            socket: ws
          }
        ]
      };
      this.send(this.videoPlayers[instanceId].sockets[0], 'you-are-host');
      console.log("Making", this.videoPlayers[instanceId].sockets[0].socket.u, "host...");
    }
  }
}

const gameServer = new GameServer();