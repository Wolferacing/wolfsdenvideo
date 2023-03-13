const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');
const Youtube = require('./youtube/scraper.js');
const youtube = new Youtube();

const Responses = {
  YOU_ARE_HOST: 'you-are-host',
  YOU_ARE_NOT_HOST: 'you-are-not-host',
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results'
}

const Commands = {
  SEARCH: 'search',
  SET_TIME: 'set-time',
  SET_TRACK: 'set-track',
  TOGGLE_LOCK: 'toggle-lock',
  ADD_TO_PLAYLIST: 'add-to-playlist',
  MOVE_PLAYLIST_ITEM: 'move-playlist-item'
} 

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
              this.send(videoPlayer.sockets[0], Responses.YOU_ARE_HOST);
              console.log("Making", videoPlayer.sockets[0].u.name, "the new host...");
            }
          }
        });
      });
    });
    
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.server.listen( 3000, function listening(){
        console.log("Video player sync service started..."); 
    });
  }
  send(socket, path, data) {
     socket.send(JSON.stringify({path, data}));
  }
  parseMessage(msg, ws){
    switch(msg.path) {
      case "instance":
        if(msg.u) {
          ws.u = msg.u;
          ws.i = msg.data;
          this.createVideoPlayer(msg.data, msg.u, ws);
        }else{
          this.send(ws, 'error');
        }
        break;
      case Commands.SET_TIME:
        this.setVideoTime(msg.data, ws);
        break
      case Commands.SET_TRACK:
        this.setVideoTrack(msg.data, ws);
        break
      case Commands.TOGGLE_LOCK:
        this.toggleLock(msg.data, ws);
        break
      case Commands.ADD_TO_PLAYLIST:
        this.addToPlaylist(msg.data, ws);
        break
      case Commands.MOVE_PLAYLIST_ITEM:
        this.movePlaylistItem(msg.data, ws);
        break
      case Commands.SEARCH:
        this.search(msg.data, ws);
        break;
    }
  }
  async search(term, ws) {
    const results = youtube.search(term, {
        language: 'en-US',
        searchType: 'video'
    });
    this.send(ws, Responses.SEARCH_RESULTS, results);
  }
  onlyIfHost(ws, callback, locked) {
    if(ws.u && ws.u.id && ws.i) {
      if(this.videoPlayers[ws.i] 
         && (this.videoPlayers[ws.i].host.id === ws.u.id || locked === false)) {
        callback();
      }else{
        this.send(ws, Responses.YOU_ARE_NOT_HOST);
      }
    }else{
      this.send(ws, 'error');
    }
  }
  addToPlaylist(url, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, () => {
        this.videoPlayers[ws.i].playlist.push(url);
        this.updateClients(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  movePlaylistItem({url, index}, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, () => {
        const playlist = this.videoPlayers[ws.i].playlist;
        const oldIndex = playlist.indexOf(url);
        if(oldIndex > -1) {
          playlist.splice(index, 0, playlist.splice(oldIndex, 1)[0]);
          this.updateClients(ws.i);
        }else{
          this.send(ws, Responses.DOES_NOT_EXIST);
        }
      }, this.videoPlayers[ws.i].locked);
    }
  }
  toggleLock(locked, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].locked = locked;
      this.updateClients(ws.i);
    });
  }
  setVideoTrack(index, ws) {
    this.onlyIfHost(ws, () => {
      if(index < this.videoPlayers[ws.i].playlist.length - 1) {
        this.videoPlayers[ws.i].currentTrack = index;
        this.updateClients(ws.i);
      }else{
        this.send(ws, Responses.OUT_OF_BOUNDS);
      }
    });
  }
  setVideoTime(time, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].currentTime = time;
    });
  }
  createVideoPlayer(instanceId, user, ws) {
    if(!this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId] = {
        playlist:[],
        currentTrack: 0,
        currentTime: 0,
        locked: false,
        host: user,
        sockets: [ws]
      };
      this.send(this.videoPlayers[instanceId].sockets[0], Responses.YOU_ARE_HOST);
      console.log("Making", this.videoPlayers[instanceId].sockets[0].u.name, "host for ", instanceId ,"...");
    }else{
      if(!this.videoPlayers[instanceId].sockets.includes(ws)) {
         this.videoPlayers[instanceId].sockets.push(ws);
      }
      console.log("New user", this.videoPlayers[instanceId].sockets[0].u.name);
    }
    this.send(this.videoPlayers[instanceId].sockets[0], Responses.SYNC_TIME, this.getVideoObject(instanceId));
  }
  getVideoObject(instanceId) {
    if(this.videoPlayers[instanceId]) {
      return {
        playlist: this.videoPlayers[instanceId].playlist, 
        currentTime: this.videoPlayers[instanceId].currentTime, 
        currentTrack: this.videoPlayers[instanceId].currentTrack, 
        locked: this.videoPlayers[instanceId].locked
      };
    }
  }
  updateClients(instanceId) {
    if(this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId].sockets.forEach(socket => {
        this.send(socket, Responses.PLAYBACK_UPDATE, this.getVideoObject(instanceId));
      });
    }
  }
}

const gameServer = new GameServer();