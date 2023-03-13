const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');

class GameServer{
  constructor() {
    this.setupServer();
    this.room = {
      data: {
        isActive:false,
        time:0,
        people: {},
      },
      sockets: {},
    }
    this.interval = 200;
    this.gameInterval = 60 * 5 - 9;
    setInterval(() => this.tick(), this.interval);
  }
  setupServer() {
    this.app = express();
    
    this.server = http.createServer( this.app );
    
    this.wss = new WebSocket.Server({ noServer: true });
    
    this.server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
    
    this.wss.startAutoPing(10000);
    
    this.wss.on('connection', (ws, req) => {
    //  ws.send({path: 'initial-state', data: this.room.data});
      ws.on('message', msg => {
        try{
          this.parseMessage(msg, ws);
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
}

const gameServer = new GameServer();