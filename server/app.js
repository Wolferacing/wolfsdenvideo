const { WebSocket } = require('@encharm/cws');
const express = require('express');
const http = require('http');
const path = require('path');
const Youtube = require('./youtube/scraper.js');
const youtube = new Youtube();
const ytfps = require('ytfps');
const fetch = require('node-fetch');
const Commands = require('./commands.js');
const Responses = require('./responses.js');

class App{
  constructor() {
    this.videoPlayers = {};
    this.setupWebserver();
    setInterval(() => this.syncTime(), 1000);
    this.syncTime();
  }
  setupWebserver() {
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
          }else{
            console.log(msg)
          }
        }catch(e) {
          console.log("parse error: ", e, msg);
        }
      });
      ws.on('close', (code, reason) => {
        this.handleClose(ws);
      });
    });
    this.app.use(express.static(path.join(__dirname, '..', 'public')));
    this.server.listen( 3000, function listening(){
        console.log("Video Player started."); 
    });
  }
  handleClose(ws) {
    console.log(ws.u ? ws.u.name : 'Unknown', 'disconnected.');
    Object.keys(this.videoPlayers).forEach(key => {
      const videoPlayer = this.videoPlayers[key];
      videoPlayer.sockets = videoPlayer.sockets.filter(_ws => _ws.u !== ws.u);
      videoPlayer.votes = videoPlayer.votes.filter(v => v.u !== ws.u);
      this.updateVotes(ws);
      if(videoPlayer.host === ws.u) {
        console.log(ws.u ? ws.u.name : 'Unknown', 'user was host, enabling takeOver');
        videoPlayer.canTakeOver = true;
        this.updateClients(ws.i, "remove-playlist-true");
      }
    });
  }
  send(socket, path, data) {
     socket.send(JSON.stringify({path, data}));
  }
  parseMessage(msg, ws){
    switch(msg.path) {
      case Commands.INSTANCE:
        if(msg.u) { 
          console.log(msg.u.name, 'connected', msg.data);
          ws.u = msg.u;
          ws.i = msg.data;
          this.createVideoPlayer(msg.data, msg.u, ws);
          this.getUserVideoPlayer(ws);
        }else{
          this.send(ws, 'error');
        }
        break;
      case Commands.SET_TIME:
        this.setVideoTime(msg.data, ws);
        break;
      case Commands.SET_TRACK:
        this.setVideoTrack(msg.data, ws);
        break;
      case Commands.TOGGLE_LOCK:
        this.toggleLock(msg.data, ws);
        break;
      case Commands.TOGGLE_CAN_TAKE_OVER:
        this.toggleCanTakeOver(msg.data, ws);
        break;
      case Commands.TAKE_OVER:
        this.takeOver(ws);
        break;
      case Commands.ADD_TO_PLAYLIST:
        this.addToPlaylist(msg.data, msg.skipUpdate, ws);
        break;
      case Commands.MOVE_PLAYLIST_ITEM:
        this.movePlaylistItem(msg.data, ws);
        break;
      case Commands.REMOVE_PLAYLIST_ITEM:
        this.removePlaylistItem(msg.data, ws);
        break;
      case Commands.SEARCH:
        this.search(msg.data, ws);
        break;
      case Commands.FROM_PLAYLIST:
        this.fromPlaylist(msg.data, ws);
        break;
      case Commands.CLEAR_PLAYLIST:
        this.clearPlaylist(msg.skipUpdate, ws);
        break;
      case Commands.USER_VIDEO_PLAYER:
        ws.is_video_player = true;
        this.setUserVideoPlayer(msg.data, ws);
        break;
      case Commands.MUTE:
        this.setMute(msg.data, ws);
        break;
      case Commands.SET_VOLUME:
        this.setVolume(msg.data, ws)
        break;
      case Commands.DOWN_VOTE:
        this.setVote(msg.data, true, ws);
        break;
      case Commands.UP_VOTE:
        this.setVote(msg.data, false, ws);
        break;
      case Commands.ADD_TO_PLAYERS:
        this.addToPlayers(ws);
        break;
      case Commands.REMOVE_FROM_PLAYERS:
        ws.p = false;
        this.updateClients(ws.i, "remove-from-players");
        break;
    }
  }
  addToPlayers(ws){
    this.onlyIfHost(ws, () => {
      ws.p = new Date().getTime();
      this.updateClients(ws.i, "add-to-players");
    }, this.videoPlayers[ws.i].locked);
  }
  getUserVideoPlayer(new_ws) {
    this.wss.clients.forEach((ws) => {
      if(ws.is_video_player) {
        this.send(ws, Responses.LINK_ME, new_ws.u.id);
      }
    });
  }
  setUserVideoPlayer(data, user_video) {
    this.wss.clients.forEach((ws) => {
      if(ws.u && ws.u.id === data.id) {
        ws.user_video = user_video;
      }
    });
  }
  updateVotes(ws) {
    if(this.videoPlayers[ws.i]) {
      this.videoPlayers[ws.i].playlist.forEach(v => {
        v.votes = this.videoPlayers[ws.i].votes.filter(_v => _v.video === v).length;
      });
    }
  }
  setVote(track, isDown, ws) {
    if(this.videoPlayers[ws.i] && this.videoPlayers[ws.i].playlist.length > track && this.videoPlayers[ws.i].votes.filter(d=>d.u === ws.u).length === 0) {
      this.videoPlayers[ws.i].votes.push({u: ws.u, isDown, video: this.videoPlayers[ws.i].playlist[track]});
      this.updateVotes(ws);
      this.updateClients(ws.i, "set-vote");
    }
  }
  setVolume(vol, ws) {
    if(ws.user_video) {
      this.send(ws.user_video, Commands.SET_VOLUME, vol);
    }
  }
  setMute( muted, ws) {
    if(ws.user_video) {
      this.send(ws.user_video, Commands.MUTE, muted);
    }
  }
  async fromPlaylist(data, ws) {
    if(!data.id || !data.id.startsWith("PL")) {
      return;
    }
    let playlist = await ytfps(data.id, { limit: 50 });
    this.onlyIfHost(ws, async () => {
      if(this.videoPlayers[ws.i] && (this.videoPlayers[ws.i].playlist.length === 0 || data.shouldClear)) {
        this.videoPlayers[ws.i].playlist.length = 0;
        playlist.videos.forEach(v=>{
          this.videoPlayers[ws.i].playlist.push({
            title: v.title,
            thumbnail: v.thumbnail_url,
            duration: v.milis_length ,
            link: v.url,
            votes: 0
          })  
        });
        this.updateClients(ws.i, "from-playlist");
      }
    }, this.videoPlayers[ws.i].locked);
  }
  async clearPlaylist(skipUpdate, ws) {
     if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        this.videoPlayers[ws.i].playlist.length = 0;
        if(!skipUpdate) {
          this.updateClients(ws.i, "clear-playlist");
        }
      }, this.videoPlayers[ws.i].locked);
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
  addToPlaylist(v, skipUpdate, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        if(!this.videoPlayers[ws.i].playlist.length) {
          this.videoPlayers[ws.i].currentTrack = 0;
          this.videoPlayers[ws.i].currentTime = 0;
          this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
        }
        v.user = ws.u.name;
        v.votes = 0;
        this.videoPlayers[ws.i].playlist.push(v);
        if(!skipUpdate) {
          this.updateClients(ws.i, "add-to-playlist");
        }
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
        this.updateClients(ws.i, "remove-playlist-true");
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
          this.updateClients(ws.i, "move-to-playlist");
        }else{
          this.send(ws, Responses.DOES_NOT_EXIST);
        }
      }, this.videoPlayers[ws.i].locked);
    }
  }
  toggleCanTakeOver(canTakeOver, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].canTakeOver = canTakeOver;
      this.updateClients(ws.i, "remove-playlist-true");
    });
  }
  takeOver(ws) {
    if(this.videoPlayers[ws.i] && this.videoPlayers[ws.i].canTakeOver) {
      this.videoPlayers[ws.i].host = ws.u;
      this.updateClients(ws.i, "remove-playlist-true");
    }else{
      this.send(ws, Responses.ERROR);
    }
  }
  toggleLock(locked, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].locked = locked;
      this.updateClients(ws.i, "remove-playlist-true");
    });
  }
  setVideoTrack(index, ws) {
    this.onlyIfHost(ws, () => {
      if(index < this.videoPlayers[ws.i].playlist.length && index > -1) {
        this.videoPlayers[ws.i].currentTrack = index;
        this.videoPlayers[ws.i].currentTime = 0;
        this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
        this.updateClients(ws.i, Commands.SET_TRACK);
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
        votes: [],
        currentTrack: 0,
        currentTime: 0,
        locked: false,
        host: user,
        sockets: [ws],
        hasNoHost: false,
        canTakeOver: true,
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
              this.videoPlayers[instanceId].lastStartTime = now;
              this.updateClients(instanceId, Commands.SET_TRACK);
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
    this.send(ws, Responses.PLAYBACK_UPDATE, {video: this.getVideoObject(instanceId)});
  }
  getVideoObject(instanceId) {
    if(this.videoPlayers[instanceId]) {
      return {
        playlist: this.videoPlayers[instanceId].playlist,
        currentTime: this.videoPlayers[instanceId].currentTime,
        currentTrack: this.videoPlayers[instanceId].currentTrack,
        locked: this.videoPlayers[instanceId].locked,
        players: this.videoPlayers[instanceId].sockets.filter(s => s.p).map(s => ({name: s.u.name, p: s.p, id: s.u.id})),
        canTakeOver: this.videoPlayers[instanceId].canTakeOver,
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
        if(socket.user_video) {
          this.syncWsTime(socket.user_video, key);
        }
      });
    });
  }
  updateClients(instanceId, type) {
    if(this.videoPlayers[instanceId]) {
      const video = this.getVideoObject(instanceId);
        console.log(type,this.videoPlayers[instanceId].sockets.length);
      this.videoPlayers[instanceId].sockets.forEach(socket => {
        this.send(socket, Responses.PLAYBACK_UPDATE, {video, type});
      });
    }
  }
}
module.exports = new App();