const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');
const Youtube = require('./youtube/scraper.js');
const youtube = new Youtube();

const Responses = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  DOES_NOT_EXIST: 'does-not-exist',
  PLAYBACK_UPDATE: 'playback-update',
  SYNC_TIME: 'sync-time',
  SEARCH_RESULTS: 'search-results',
  ERROR:'error'
}

const Commands = {
  SEARCH: 'search',
  SET_TIME: 'set-time',
  SET_TRACK: 'set-track',
  TOGGLE_LOCK: 'toggle-lock',
  TOGGLE_CAN_BE_CLAIMED: 'toggle-can-be-claimed',
  ADD_TO_PLAYLIST: 'add-to-playlist',
  MOVE_PLAYLIST_ITEM: 'move-playlist-item',
  REMOVE_PLAYLIST_ITEM: 'remove-playlist-item',
  TAKE_OVER: 'take-over'
} 

class GameServer{
  constructor() {
    this.tickInterval = 10000;
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
        console.log("Video player sync service started..."); 
    });
    
    setInterval(() => {
      this.syncTime();
    }, 3000);
    this.syncTime();
  }
  handleClose(ws) {
    console.log(ws.u ? ws.u.name : 'Unknown', 'disconnected.');
    Object.keys(this.videoPlayers).forEach(key => {
      const videoPlayer = this.videoPlayers[key];
      videoPlayer.sockets = videoPlayer.sockets.filter(_ws => _ws.u !== ws.u);
      if(videoPlayer.host === ws.u) {
        console.log(ws.u.name, 'remove user');
        if(!videoPlayer.sockets.length) {
          videoPlayer.hasNoHost = true;
            console.log("No users left, deleting video player in 5 mins...");
          videoPlayer.deleteTimeout = setTimeout(() => {
            clearInterval(this.videoPlayers[key].tick);
            delete this.videoPlayers[key];
            console.log("No users left, deleting video player...");
          }, 5 * 60 * 1000);
        }else{
          videoPlayer.sockets.sort((a,b) => a.time - b.time);
          videoPlayer.host = videoPlayer.sockets[0].u;
          this.send(videoPlayer.sockets[0], Responses.YOU_ARE_HOST);
          console.log("Making", videoPlayer.sockets[0].u.name, "the new host...");
          this.updateClients(ws.i);
        }
      }
    });
  }
  send(socket, path, data) {
     socket.send(JSON.stringify({path, data}));
  }
  parseMessage(msg, ws){
    switch(msg.path) {
      case "instance":
        if(msg.u) {
          console.log(msg.u.name, 'connected');
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
      case Commands.TOGGLE_CAN_BE_CLAIMED:
        this.toggleCanBeClaimed(msg.data, ws);
        break
      case Commands.TAKE_OVER:
        this.takeOver(ws);
        break
      case Commands.ADD_TO_PLAYLIST:
        this.addToPlaylist(msg.data, ws);
        break
      case Commands.MOVE_PLAYLIST_ITEM:
        this.movePlaylistItem(msg.data, ws);
        break
      case Commands.REMOVE_PLAYLIST_ITEM:
        this.removePlaylistItem(msg.data, ws);
        break;
      case Commands.SEARCH:
        this.search(msg.data, ws);
        break;
    }
  }
  async search(term, ws) {
    const results = await youtube.search(term, {
        language: 'en-US',
        searchType: 'video'
    });
    this.send(ws, Responses.SEARCH_RESULTS, results.videos || []);
  }
  onlyIfHost(ws, callback, locked) {
    if(ws.u && ws.u.id && ws.i) {
      if(this.videoPlayers[ws.i] 
         && (this.videoPlayers[ws.i].host.id === ws.u.id || locked === false)) {
        callback();
      }else{
        this.send(ws, Responses.ERROR);
      }
    }
  }
  addToPlaylist(url, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, () => {
        if(!this.videoPlayers[ws.i].playlist.length) {
          this.videoPlayers[ws.i].currentTrack = 0;
          this.videoPlayers[ws.i].currentTime = 0;
          this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
        }
        this.videoPlayers[ws.i].playlist.push(url);
        this.updateClients(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  removePlaylistItem(index, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, () => {
        this.videoPlayers[ws.i].playlist.splice(index, 1);
        if(index <= this.videoPlayers[ws.i].currentTrack) {
          this.videoPlayers[ws.i].currentTrack--;
        }
        this.updateClients(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  movePlaylistItem({url, index}, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, () => {
        const playlist = this.videoPlayers[ws.i].playlist;
        const oldIndex = playlist.map(d => d.link).indexOf(url);
        if(oldIndex > -1) {
          playlist.splice(index, 0, playlist.splice(oldIndex, 1)[0]);
          if(index === this.videoPlayers[ws.i].currentTrack) {
            if(oldIndex > index) {
              this.videoPlayers[ws.i].currentTrack++;
            }else{
              this.videoPlayers[ws.i].currentTrack--;
            }
          }
          this.updateClients(ws.i);
        }else{
          this.send(ws, Responses.DOES_NOT_EXIST);
        }
      }, this.videoPlayers[ws.i].locked);
    }
  }
  toggleCanBeClaimed(canBeClaimed, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].canBeClaimed = canBeClaimed;
      this.updateClients(ws.i);
    });
  }
  takeOver(ws) {
    if(this.videoPlayers[ws.i] && this.videoPlayers[ws.i].canBeClaimed) {
      this.videoPlayers[ws.i].host = ws.u;
      this.updateClients(ws.i);
    }else{
      this.send(ws, Responses.ERROR);
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
      if(index < this.videoPlayers[ws.i].playlist.length && index > -1) {
        this.videoPlayers[ws.i].currentTrack = index;
        this.updateClients(ws.i);
      }else{
        this.send(ws, Responses.OUT_OF_BOUNDS);
      }
    }, this.videoPlayers[ws.i].locked);
  }
  setVideoTime(time, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].currentTime = time;
      this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
    }, this.videoPlayers[ws.i].locked);
  }
  createVideoPlayer(instanceId, user, ws) {
    if(!this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId] = {
        playlist:[],
        currentTrack: 0,
        currentTime: 0,
        locked: false,
        host: user,
        sockets: [ws],
        hasNoHost: false,
        canBeClaimed: false,
        lastStartTime: new Date().getTime() / 1000,
        tick: setInterval(() => {
          if(this.videoPlayers[instanceId].playlist.length) {
            const track = this.videoPlayers[instanceId].playlist[this.videoPlayers[instanceId].currentTrack];
            const now = new Date().getTime() / 1000;
            this.videoPlayers[instanceId].currentTime = now - this.videoPlayers[instanceId].lastStartTime;
            if(this.videoPlayers[instanceId].currentTime > (track ? track.duration : 0) / 1000) {
              this.videoPlayers[instanceId].currentTrack++;
              if(this.videoPlayers[instanceId].currentTrack >= this.videoPlayers[instanceId].playlist.length) {
                this.videoPlayers[instanceId].currentTrack = 0;
              }
              this.videoPlayers[instanceId].currentTime = 0;
              this.updateClients(instanceId);
              this.videoPlayers[instanceId].lastStartTime = now;
            }
          }else{
             this.videoPlayers[instanceId].currentTime = this.videoPlayers[instanceId].currentTrack = 0;
          }
        }, 1000)
      };
      console.log(user.name, 'is host');
    }else{
      clearTimeout(this.videoPlayers[instanceId].deleteTimeout);
      if(!this.videoPlayers[instanceId].sockets.includes(ws)) {
         this.videoPlayers[instanceId].sockets.push(ws);
      }
      if(this.videoPlayers[instanceId].hasNoHost) {
        this.videoPlayers[instanceId].host = ws.u;
        this.videoPlayers[instanceId].hasNoHost = false;
      }
    } 
    this.syncWsTime(ws, instanceId);
    this.send(ws, Responses.PLAYBACK_UPDATE, this.getVideoObject(instanceId));
  }
  getVideoObject(instanceId) {
    if(this.videoPlayers[instanceId]) {
      return {
        playlist: this.videoPlayers[instanceId].playlist,
        currentTime: this.videoPlayers[instanceId].currentTime,
        currentTrack: this.videoPlayers[instanceId].currentTrack,
        locked: this.videoPlayers[instanceId].locked,
        canBeClaimed: this.videoPlayers[instanceId].canBeClaimed,
        host: this.videoPlayers[instanceId].host,
        hasNoHost: this.videoPlayers[instanceId].hasNoHost,
        duration: this.videoPlayers[instanceId].playlist.length ? this.videoPlayers[instanceId].playlist[this.videoPlayers[instanceId].currentTrack].duration / 1000 : 0
      };
    }
  }
  syncWsTime(socket, key) {
    if(this.videoPlayers[key].playlist.length) {
      this.send(socket, Responses.SYNC_TIME, {
        currentTrack: this.videoPlayers[key].currentTrack,
        currentTime: this.videoPlayers[key].currentTime,
        duration: this.videoPlayers[key].playlist[this.videoPlayers[key].currentTrack].duration / 1000
      });
    }
  }
  syncTime() {
    Object.keys(this.videoPlayers).forEach(key => {
      this.videoPlayers[key].sockets.forEach(socket => {
        this.syncWsTime(socket, key);
      });
    });
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