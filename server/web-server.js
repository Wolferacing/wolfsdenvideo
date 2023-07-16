const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');

class WebServer{
  constructor() {
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
      ws.t = new Date().getTime();
      ws.on('message', msg => {
        try{
          if(msg !== "keepalive") {
            this.parseMessage(JSON.parse(msg), ws);
          }
        }catch(e) {
          console.log("parse error: ", e, msg);
        }
      });
      ws.on('close', (code, reason) => {
        this.handleClose(ws);
      });
    });
    
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    this.server.listen( 3000, function listening(){
        console.log("[Video Player] Webserver with websocket started..."); 
    });
  }
}

module.exports = WebServer;