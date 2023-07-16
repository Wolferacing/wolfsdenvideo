const Youtube = require('./youtube/scraper.js');
const youtube = new Youtube();
const ytfps = require('ytfps');
const fetch = require('node-fetch');
const Commands = require('./commands.js');
const Responses = require('./responses.js');
const WebServer = require('./web-server.js');

class Server{
  constructor() {
    this.videoPlayers = {};
    this.webServer = new WebServer();
    setInterval(() => {
      this.syncTime();
    }, 1000);
    this.syncTime();
  }
  handleClose(ws) {
    console.log(ws.u ? ws.u.name : 'Unknown', 'disconnected.');
    Object.keys(this.videoPlayers).forEach(key => {
      const videoPlayer = this.videoPlayers[key];
      videoPlayer.sockets = videoPlayer.sockets.filter(_ws => _ws.u !== ws.u);
      if(videoPlayer.host === ws.u) {
        console.log(ws.u ? ws.u.name : 'Unknown', 'user was host, enabling takeOver');
        videoPlayer.canTakeOver = true;
        this.updateClients(ws.i, 'host-lost');
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
        this.addToPlaylist(msg.data, ws);
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
        this.clearPlaylist(ws);
        break;
      case Commands.USER_VIDEO_PLAYER:
        ws.is_video_player = true;
        this.setUserVideoPlayer(msg.data, ws);
        break;
      case Commands.DOWN_VOLUME:
        this.setVolume(ws, true);
        break;
      case Commands.UP_VOLUME:
        this.setVolume(ws);
        break;
    }
  }
  getUserVideoPlayer(new_ws) {
    this.webServer.wss.clients.forEach((ws) => {
      if(ws.is_video_player) {
        this.send(ws, Responses.LINK_ME, new_ws.u.id);
      }
    });
  }
  setUserVideoPlayer(data, user_video) {
    this.webServer.wss.clients.forEach((ws) => {
      if(ws.u && ws.u.id === data.id) {
        console.log("set user video player", data.id);
        ws.user_video = user_video;
      }
    });
  }
  setVolume(ws, isDown) {
    if(ws.user_video) {
      this.send(ws.user_video, isDown ? Commands.DOWN_VOLUME : Commands.UP_VOLUME, {});
    }
  }
  async getDirectUrl(youtubeId) {
    const jsonBody = {
      "context": {
        "client": {
          "clientName": "ANDROID",
          "clientVersion": "17.31.35",
          "hl": "en"
        }
      },
      "videoId": youtubeId
    }
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", {
        headers: {
            "Content-Type": "application/json",
            "Origin": "https://www.youtube.com",
            "X-YouTube-Client-Name": "1",
            "X-YouTube-Client-Version": "2.20220801.00.00"
        },
        method: 'post',
        body: JSON.stringify(jsonBody)
    });
    try{
      const json = await res.json();
      return json.streamingData.formats;
    }catch(e) {
      return false;
    }
  }
  async fromPlaylist(data, ws) {
    let playlist = await ytfps(data.id, { limit: 50 });
    this.onlyIfHost(ws, async () => {
      if(this.videoPlayers[ws.i] && (this.videoPlayers[ws.i].playlist.length === 0 || data.shouldClear)) {
        this.videoPlayers[ws.i].playlist.length = 0;
        playlist.videos.forEach(v=>{
          this.videoPlayers[ws.i].playlist.push({
            title: v.title,
            thumbnail: v.thumbnail_url,
            duration: v.milis_length ,
            link: v.url
          })  
          this.updateClients(ws.i, 'add-playlist');
        });
      }
    }, this.videoPlayers[ws.i].locked);
  }
  async clearPlaylist(ws) {
     if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        this.videoPlayers[ws.i].playlist.length = 0;
        this.updateClients(ws.i, 'add-playlist');
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
  addToPlaylist(v, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        if(!this.videoPlayers[ws.i].playlist.length) {
          this.videoPlayers[ws.i].currentTrack = 0;
          this.videoPlayers[ws.i].currentTime = 0;
          this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
        }
        this.videoPlayers[ws.i].playlist.push(v);
        this.updateClients(ws.i, 'add-playlist');
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
        this.updateClients(ws.i, 'remove-playlist');
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
          this.updateClients(ws.i, 'move-playlist');
        }else{
          this.send(ws, Responses.DOES_NOT_EXIST);
        }
      }, this.videoPlayers[ws.i].locked);
    }
  }
  toggleCanTakeOver(canTakeOver, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].canTakeOver = canTakeOver;
      this.updateClients(ws.i, 'toggle-take-over');
    });
  }
  takeOver(ws) {
    if(this.videoPlayers[ws.i] && this.videoPlayers[ws.i].canTakeOver) {
      this.videoPlayers[ws.i].host = ws.u;
      this.updateClients(ws.i, 'take-over');
    }else{
      this.send(ws, Responses.ERROR);
    }
  }
  toggleLock(locked, ws) {
    this.onlyIfHost(ws, () => {
      this.videoPlayers[ws.i].locked = locked;
      this.updateClients(ws.i, 'set-lock');
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
              // track = this.videoPlayers[instanceId].playlist[this.videoPlayers[instanceId].currentTrack];
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
    this.send(ws, Responses.PLAYBACK_UPDATE, {video: this.getVideoObject(instanceId), type: 'initial-sync'});
  }
  async playNewTrack(instanceId, track) {
      const id = this.parseYoutubeId(track.url);
      const formatData = await this.getDirectUrl(id);
      track.formats = formatData.formats;
  }
  getVideoObject(instanceId) {
    if(this.videoPlayers[instanceId]) {
      return {
        playlist: this.videoPlayers[instanceId].playlist,
        currentTime: this.videoPlayers[instanceId].currentTime,
        currentTrack: this.videoPlayers[instanceId].currentTrack,
        locked: this.videoPlayers[instanceId].locked,
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
      });
    });
  }
  updateClients(instanceId, type) {
    if(this.videoPlayers[instanceId]) {
      this.videoPlayers[instanceId].sockets.forEach(socket => {
        this.send(socket, Responses.PLAYBACK_UPDATE, {video: this.getVideoObject(instanceId), type});
      });
    }
  }
}
module.exports = new Server();
