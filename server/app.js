const { WebSocket } = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const Youtube = require('./youtube/scraper.js');
const youtube = new Youtube();
const ytfps = require('ytfps');
const fetch = require('node-fetch');
const Commands = require('../public/commands.js');
const { Pool } = require('pg');

class App{
  constructor() {
    this.videoPlayers = {};
    this.mainLoop = null;
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render's Hobby plan requires SSL, but does not verify the certificate
      ssl: process.env.DATABASE_URL ? {
        rejectUnauthorized: false
      } : false
    });
  }

  async setupDatabase() {
    const client = await this.pool.connect();
    try {
      // Step 1: Ensure the table schema is what we expect.
      await client.query(`
        CREATE TABLE IF NOT EXISTS player_state (
          instance_id TEXT PRIMARY KEY,
          player_data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      console.log('Database table "player_state" schema ensured.');

      // Step 2: Verify the table is actually queryable.
      try {
        await client.query('SELECT 1 FROM player_state LIMIT 1;');
        console.log('Database table "player_state" successfully verified.');
      } catch (verifyError) {
        // If verification fails, the table might be corrupt.
        console.warn('Could not verify "player_state" table. It might be corrupted. Attempting to recover...', verifyError.code);
        
        // Step 3: Attempt recovery by dropping and recreating the table.
        // This is a destructive operation but can fix a corrupted state.
        await client.query('DROP TABLE IF EXISTS player_state CASCADE;');
        console.log('Dropped potentially corrupted "player_state" table.');
        
        await client.query(`
          CREATE TABLE player_state (
            instance_id TEXT PRIMARY KEY,
            player_data JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        console.log('Successfully recreated "player_state" table.');
      }

    } catch (err) {
      console.error('CRITICAL: Database setup failed and could not recover.', err);
      // Re-throw the error to ensure the main startup process catches it and aborts.
      throw err;
    } finally {
      client.release();
    }
  }
  async savePlayerState(instanceId) {
    const player = this.videoPlayers[instanceId];
    if (!player) return;

    // Create a clean, serializable object for storage.
    // We don't want to save sockets, intervals, timeouts, or the host object.
    const stateToSave = {
      playlist: player.playlist,
      currentTrack: player.currentTrack,
      lastStartTime: player.lastStartTime,
      locked: player.locked,
      canTakeOver: player.canTakeOver,
      canVote: player.canVote,
      host: player.host,
      // We don't save votes as they are tied to connected sockets.
    };

    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO player_state (instance_id, player_data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (instance_id) DO UPDATE
         SET player_data = EXCLUDED.player_data, updated_at = NOW();`,
        [instanceId, stateToSave]
      );
    } catch (err) {
      console.error(`Error saving state for instance ${instanceId}:`, err);
    } finally {
      client.release();
    }
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

    this.app.use(express.static(path.join(__dirname, '..', 'public')));
  }
  attachWebsocketListeners() {
    // This logic is now separate and will be called only when the server is listening.
    this.wss.on('connection', async (ws, req) => {
      ws.t = new Date().getTime();
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.on('message', async msg => {
        try {
          // Using Buffer.from to handle different message types gracefully.
          const messageString = Buffer.from(msg).toString();
          if (messageString !== "keepalive") {
            await this.parseMessage(JSON.parse(messageString), ws);
          } else {
            console.log(messageString);
          }
        } catch (e) {
          console.log("Parse error: ", e, msg);
        }
      });
      ws.on('close', (code, reason) => {
        this.handleClose(ws);
      });
    });

    // The ping/pong interval should also start only when the server is live.
    const interval = setInterval(() => {
      this.wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.server.on('close', () => {
      clearInterval(this.mainLoop);
      clearInterval(interval);
    });
  }
  handleClose(ws) {
    console.log(ws.u ? ws.u.name : 'Unknown', 'disconnected.', ws.type);
    const instanceId = ws.i;
    if (!instanceId || !this.videoPlayers[instanceId]) {
      return; // Socket was not in an instance, nothing to do.
    }
    const videoPlayer = this.videoPlayers[instanceId];
    const wasHostSocket = ws.u && videoPlayer.host.id === ws.u.id;
    const wasSpaceSocket = ws.type === "space";

    // Remove the disconnected socket
    videoPlayer.sockets = videoPlayer.sockets.filter(_ws => _ws !== ws);

    // Handle host disconnection. This logic is specifically for when the host leaves the 3D space.
    // A host with only a playlist UI open is not considered "present" for retaining control.
    if (wasHostSocket && wasSpaceSocket) {
      // Check if the host has any *other* connections of type "space" remaining.
      const hostHasAnotherSpaceConnection = videoPlayer.sockets.some(
        s => s.u && s.u.id === videoPlayer.host.id && s.type === "space"
      );

      if (!hostHasAnotherSpaceConnection) {
        // The host's last "space" connection has dropped. Start the takeover timer.
        console.log(`${ws.u.name || 'Unknown'} (host) has left the space. Enabling takeover in 42 secs.`);
        videoPlayer.hostConnected = false; // This flag is checked by the timeout and on reconnect
        videoPlayer.takeoverTimeout = setTimeout(async () => {
          // The check is simple: has the host re-established a space connection?
          if (!videoPlayer.hostConnected) {
            console.log(`${ws.u.name || 'Unknown'} takeover enabled after 42 secs`);
            videoPlayer.canTakeOver = true;
            this.updateClients(instanceId, 'takeover-enabled', { includePlaylist: false });
            await this.savePlayerState(instanceId);
          }
        }, 42 * 1000);
      }
    }

    // If the user had votes, remove them
    if (ws.u) {
      const voteCount = videoPlayer.votes.length;
      videoPlayer.votes = videoPlayer.votes.filter(vote => vote.u.id !== ws.u.id);
      if (voteCount > videoPlayer.votes.length) {
        this.updateVotes(instanceId);
      }
    }
    this.updateClients(instanceId, 'user-left', { includePlaylist: false });

    // If the instance is now empty, schedule it for cleanup.
    if (videoPlayer.sockets.length === 0) {
      console.log(`Instance ${instanceId} is empty. Scheduling cleanup in 3 minutes.`);
      videoPlayer.deleteTimeout = setTimeout(async () => {
        console.log(`Cleaning up inactive instance: ${instanceId}`);
        await this.savePlayerState(instanceId);
        delete this.videoPlayers[instanceId];
      }, 1000 * 60 * 3); // 3-minute grace period
    }
  } 
  send(socket, path, data) {
     const payload = JSON.stringify({path, data});
     if (process.env.NODE_ENV !== 'production') {
      console.log(`[SEND] user: ${socket.u ? socket.u.name : 'N/A'}, instance: ${socket.i || 'N/A'}, type: ${socket.type || 'N/A'}, path: ${path}, payload_size: ${payload.length}`);
     }
     socket.send(payload);
  }
  async parseMessage(msg, ws){
    console.log(`[RECV] user: ${ws.u ? ws.u.name : 'N/A'}, instance: ${ws.i || 'N/A'}, type: ${ws.type || 'N/A'}, path: ${msg.path}`);
    switch(msg.path) {
      case Commands.INSTANCE:
        if(msg.u) { 
          ws.u = msg.u;
          ws.i = msg.data;
          await this.createVideoPlayer(msg.data, msg.u, ws);
          console.log(msg.u.name, 'connected', msg.data, "host: ", this.videoPlayers[msg.data].host.name);
          this.getUserVideoPlayer(ws);
          // Takeover cancellation logic is now handled in SET_WS_TYPE,
          // as the socket type is not known at this point in the connection lifecycle.
        }else{
          this.send(ws, 'error');
        }
        break;
      case Commands.SET_WS_TYPE:
        ws.type = msg.data;
        const player = this.videoPlayers[ws.i];
        // If the host establishes a "space" connection, they are considered fully connected.
        // This is the correct place to cancel any pending takeover.
        if (player && player.host.id === ws.u.id && ws.type === "space") {
          clearTimeout(player.takeoverTimeout);
          player.takeoverTimeout = null; // Also clear the timeout handle
          player.hostConnected = true;
          console.log(`${ws.u.name || 'Unknown'} (host) user returned to space, takeover not enabled`);
        }
        break;
      case Commands.SET_TIME:
        await this.setVideoTime(msg.data, ws);
        break;
      case Commands.SET_TRACK:
        await this.setVideoTrack(msg.data, ws);
        break;
      case Commands.TOGGLE_LOCK:
        await this.toggleLock(msg.data, ws);
        break;
      case Commands.TOGGLE_CAN_TAKE_OVER:
        await this.toggleCanTakeOver(msg.data, ws);
        break;
      case Commands.TAKE_OVER:
        await this.takeOver(ws);
        break;
      case Commands.ADD_TO_PLAYLIST:
        await this.addToPlaylist(msg.data, msg.skipUpdate, msg.isYoutubeWebsite, ws);
        break;
      case Commands.MOVE_PLAYLIST_ITEM:
        await this.movePlaylistItem(msg.data, ws);
        break;
      case Commands.REMOVE_PLAYLIST_ITEM:
        await this.removePlaylistItem(msg.data, ws);
        break;
      case Commands.SEARCH:
        this.search(msg.data, ws);
        break;
      case Commands.FROM_PLAYLIST:
        await this.fromPlaylist(msg.data, ws);
        break;
      case Commands.CLEAR_PLAYLIST:
        await this.clearPlaylist(msg.skipUpdate, ws);
        break;
      case Commands.USER_VIDEO_PLAYER:
        ws.is_video_player = true;
        this.setUserVideoPlayer(msg.data, ws);
        break;
      case Commands.STOP:
        this.stop(ws);
        break;
      case Commands.AUTO_SYNC:
        this.setAutoSync(msg.data, ws);
        break;
      case Commands.REQUEST_SYNC:
        this.syncWsTime(ws, ws.i, msg.data);
        break;
      case Commands.CLICK_BROWSER:
        this.sendBrowserClick(msg.data, ws)
        break;
      case Commands.TOGGLE_VOTE:
        await this.toggleVote(ws)
        break; 
      case Commands.DOWN_VOTE:
        this.setVote(msg.data, true, ws);
        break;
      case Commands.UP_VOTE:
        this.setVote(msg.data, false, ws);
        break;
      case Commands.ADD_TO_PLAYERS:
        await this.addToPlayers(msg.data, ws);
        break;
      case Commands.REMOVE_FROM_PLAYERS:
        await this.removeFromPlayers(msg.data, ws);
        break;
      case Commands.ADD_AND_PLAY:
        await this.addAndPlay(msg.data, ws);
        break;
      case Commands.ADD_AND_PLAY_NEXT:
        await this.addAndPlayNext(msg.data, ws);
        break;
      case Commands.MOVE_SINGER:
        await this.moveSinger(msg.data, ws);
        break;
      case Commands.VIDEO_UNAVAILABLE:
        await this.handleVideoUnavailable(msg.data, ws);
        break;
      case Commands.REPLACE_VIDEO:
        await this.handleReplaceVideo(msg.data, ws);
        break;
    }
  }
  _createVideoObject(videoData, userName, source, isYoutubeWebsite = false) {
    // Standardizes video objects from different sources (ytfps, scraper)
    if (source === 'ytfps') {
      return {
        title: videoData.title,
        thumbnail: videoData.thumbnail_url,
        duration: videoData.milis_length,
        link: videoData.url,
        votes: 0,
        user: userName,
        is_youtube_website: isYoutubeWebsite
      };
    }
    // Default to 'scraper' source
    // The duration from the scraper/search can either be a flat number of milliseconds
    // or an object like { milis: 12345 }. This handles both cases.
    const durationMs = (typeof videoData.duration === 'object' && videoData.duration !== null)
      ? videoData.duration.milis
      : videoData.duration;
    return {
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      duration: durationMs,
      link: videoData.link,
      votes: 0,
      user: userName,
      is_youtube_website: isYoutubeWebsite
    };
  }
  async removeFromPlayers(uid, ws) {
    const player = this.videoPlayers[ws.i];
    if (!player) return;

    const isHost = player.host.id === ws.u.id;
    const isSelf = uid === ws.u.id;

    // A user can remove themselves, or the host can remove anyone.
    if (isHost || isSelf) {
      const socketToRemove = player.sockets.find(s => s.u && s.u.id === uid);
      if (socketToRemove) {
        socketToRemove.p = false; // Mark as not a player
        socketToRemove.p_v = null; // Clear their selected video
        console.log(`${ws.u.name} removed ${socketToRemove.u.name} from the singer list.`);
        this.updateClients(ws.i, "remove-from-players", { includePlaylist: false });
      }
    } else {
      this.send(ws, Commands.ERROR);
    }
  }
  stop(ws) {
    this.onlyIfHost(ws, () => {
      this.updateClients(ws.i, "stop");
    }, this.videoPlayers[ws.i].locked);
  }
  setAutoSync(autoSync, ws) {
    if(ws.user_video) {
      this.send(ws.user_video, Commands.AUTO_SYNC, autoSync);
    }
  }
  async addToPlayers(video, ws){
    const player = this.videoPlayers[ws.i];
    if (!player) return;

    // A user can only add themselves. The socket sending the message is the one being added.
    ws.p = new Date().getTime(); // 'p' for player, timestamp for ordering
    ws.p_v = video; // The video they will sing

    console.log(`${ws.u.name} was added to the singer list with video: ${video.title}`);
    this.updateClients(ws.i, "add-to-players", { includePlaylist: false });
  }
  async moveSinger({ userId, direction }, ws) {
    this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        if (!player) return;

        // Get a sorted list of current singers from the sockets
        const singers = player.sockets.filter(s => s.p).sort((a, b) => a.p - b.p);
        
        const oldIndex = singers.findIndex(s => s.u.id === userId);

        if (oldIndex === -1) {
            return; // Singer not found
        }

        let newIndex;
        if (direction === 'up' && oldIndex > 0) {
            newIndex = oldIndex - 1;
        } else if (direction === 'down' && oldIndex < singers.length - 1) {
            newIndex = oldIndex + 1;
        } else {
            return; // Invalid move
        }

        // The sockets to be swapped
        const singerToMoveSocket = singers[oldIndex];
        const otherSingerSocket = singers[newIndex];

        // Swap their 'p' (timestamp) values to change their order, then update clients
        [singerToMoveSocket.p, otherSingerSocket.p] = [otherSingerSocket.p, singerToMoveSocket.p];
        this.updateClients(ws.i, 'singers-reordered', { includePlaylist: false });
    });
  }
  async toggleVote(ws) {
    if (this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        player.canVote = !player.canVote;
        // When turning voting on, clear all existing votes to start fresh.
        if (player.canVote) {
          player.votes = [];
        }
        player.sockets.forEach(socket => {
          this.send(socket, Commands.VOTING_STATE_CHANGED, { canVote: player.canVote });
        });
        await this.savePlayerState(ws.i);
      });
    }
  } 
  sendBrowserClick(click, video_ws) {
    if(this.videoPlayers[video_ws.i]) {
      this.videoPlayers[video_ws.i].sockets.forEach(ws => {
        if(video_ws.u.id === ws.u.id && !ws.is_video_player){
          this.send(ws, Commands.CLICK_BROWSER, click);
        }
      });
    }
  }
  getUserVideoPlayer(new_ws) {
    if(this.videoPlayers[new_ws.i]) {
      this.videoPlayers[new_ws.i].sockets.forEach(ws => {
        if(ws.is_video_player) {
          this.setUserVideoPlayer(new_ws.u, ws);
        }
      });
    }
  }
  setUserVideoPlayer(data, user_video) {
    if(this.videoPlayers[user_video.i]) {
      this.videoPlayers[user_video.i].sockets.forEach(ws => {
        if(ws.u && ws.u.id === user_video.u.id) {
          ws.user_video = user_video;
        }
      });
    }
  }
  updateVotes(instanceId) {
    const player = this.videoPlayers[instanceId];
    // Only sort if voting is on and there's something to sort.
    if (player && player.canVote && player.playlist.length > 1) {
      // Identify and temporarily remove the currently playing track.
      const currentTrackObject = player.playlist.splice(player.currentTrack, 1)[0];

      // Calculate votes for the rest of the playlist.
      player.playlist.forEach(d => {
        const downVotes = player.votes.filter(v => v.video === d && v.isDown).length;
        const upVotes = player.votes.filter(v => v.video === d && !v.isDown).length;
        d.votes = upVotes - downVotes;
      });

      // Sort the rest of the playlist based on votes.
      player.playlist.sort((a, b) => b.votes - a.votes);

      // Add the currently playing track back to the top.
      player.playlist.unshift(currentTrackObject);

      // The current track is now always at index 0.
      player.currentTrack = 0;
    }
  }
  setVote(link, isDown, ws) {
    const player = this.videoPlayers[ws.i];
    const videoObject = player ? player.playlist.find(v => v.link === link) : null;

    if (player && videoObject && player.canVote) {
      // Prevent voting on the currently playing track
      if (player.playlist[player.currentTrack].link === link) {
        return;
      }
      // Remove any previous vote from this user for this video
      player.votes = player.votes.filter(d => !(d.u.id === ws.u.id && d.video.link === link));
      // Add the new vote
      player.votes.push({u: ws.u, isDown, video: videoObject});
      this.updateVotes(ws.i);
      player.sockets.forEach(socket => {
        this.send(socket, Commands.PLAYLIST_UPDATED, { playlist: player.playlist, currentTrack: player.currentTrack });
      });
    }
  }
  async fromPlaylist(data, ws) {
    if(!data.id || !data.id.startsWith("PL")) {
      return;
    }
        console.log("fromPlaylist", ws.i, ws.u, data);
    this.onlyIfHost(ws, async () => {
      if(this.videoPlayers[ws.i] && (this.videoPlayers[ws.i].playlist.length === 0 || data.shouldClear)) {
        const player = this.videoPlayers[ws.i];
        let playlist = await ytfps(data.id, { limit: 100 });
        this.resetPlaylist(ws); // Resets playlist, currentTime, currentTrack
        playlist.videos.forEach(v => {
          player.playlist.push(this._createVideoObject(v, ws.u.name, 'ytfps'));
        });
        if (player.playlist.length > 0) {
          player.lastStartTime = new Date().getTime() / 1000;
          player.sockets.forEach(socket => {
            this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime, playlist: player.playlist });
          });
        } else {
          this.updateClients(ws.i); // This is fine, sends an empty playlist.
        }
        await this.savePlayerState(ws.i);
      }
    });
  }
  resetPlaylist(ws) {
    this.videoPlayers[ws.i].playlist.length = 0;
    this.videoPlayers[ws.i].currentTrack = 0;
    this.videoPlayers[ws.i].currentTime = 0;
  }
  async clearPlaylist(skipUpdate, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        console.log("clearPlaylist", ws.i, ws.u);
        this.resetPlaylist(ws);
        if(!skipUpdate) {
          this.videoPlayers[ws.i].sockets.forEach(socket => {
            this.send(socket, Commands.PLAYLIST_UPDATED, { playlist: [], currentTrack: 0 });
          });
        }
        await this.savePlayerState(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  async addAndPlay(v, ws) {
    if (this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        const newVideo = this._createVideoObject(v, ws.u.name, 'scraper');
        player.playlist.push(newVideo);

        // Set it as the current track
        const newIndex = player.playlist.length - 1;
        player.currentTrack = newIndex;
        player.currentTime = 0;
        player.lastStartTime = new Date().getTime() / 1000;
        this.resetBrowserIfNeedBe(player, newIndex);
        this.updateVotes(ws.i);
        player.sockets.forEach(socket => {
          this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime, playlist: player.playlist });
        });
        await this.savePlayerState(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  async addAndPlayNext(v, ws) {
    if (this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        const newVideo = this._createVideoObject(v, ws.u.name, 'scraper');
        const nextIndex = player.currentTrack + 1;
        player.playlist.splice(nextIndex, 0, newVideo);
        this.updateClients(ws.i);
        await this.savePlayerState(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  async search(term, ws) {
    const results = await youtube.search(term, {
        language: 'en-US',
        searchType: 'video'
    });
    this.send(ws, Commands.SEARCH_RESULTS, results.videos || []);
  }
  onlyIfHost(ws, callback, locked) {
    if(ws.u && ws.u.id && ws.i) {
      if(this.videoPlayers[ws.i] 
         && (this.videoPlayers[ws.i].host.id === ws.u.id || locked === false)) {
        callback();
      }else{
        this.send(ws, Commands.ERROR);
      }
    }
  }
  async addToPlaylist(v, skipUpdate, isYoutubeWebsite, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        if(!this.videoPlayers[ws.i].playlist.length) {
          this.videoPlayers[ws.i].currentTrack = 0;
          this.videoPlayers[ws.i].currentTime = 0;
          this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
        }
        const newVideo = this._createVideoObject(v, ws.u.name, 'scraper', isYoutubeWebsite);
        this.videoPlayers[ws.i].playlist.push(newVideo);
        if(!skipUpdate) {
          this.updateClients(ws.i);
        }
        await this.savePlayerState(ws.i);
      }, this.videoPlayers[ws.i].locked);
    }
  }
  async removePlaylistItem(index, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        if (index < 0 || index >= player.playlist.length) return; // Bounds check

        player.playlist.splice(index, 1);

        // Adjust currentTrack if an item before it was removed.
        if (index < player.currentTrack) {
          player.currentTrack--;
        }
        // Send a granular update: the index of the removed item and the new currentTrack index.
        player.sockets.forEach(socket => {
          this.send(socket, Commands.ITEM_REMOVED, { index: index, newCurrentTrack: player.currentTrack });
        });
        await this.savePlayerState(ws.i);
      }, this.videoPlayers[ws.i].locked && !this.videoPlayers[ws.i].canVote);
    }
  }
  async movePlaylistItem({url, index}, ws) {
    if(this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        const playlist = player.playlist;
        const oldIndex = playlist.findIndex(d => d.link === url);

        if(oldIndex > -1) {
          // Robustly track the current track to ensure its index is correct after the move.
          const currentTrackLink = playlist[player.currentTrack].link;

          // Move the item
          const [itemToMove] = playlist.splice(oldIndex, 1);
          playlist.splice(index, 0, itemToMove);

          // Find the new index of the (potentially shifted) current track
          player.currentTrack = playlist.findIndex(v => v.link === currentTrackLink);

          // Broadcast the updated playlist and current track index
          player.sockets.forEach(socket => {
            this.send(socket, Commands.PLAYLIST_UPDATED, { playlist: player.playlist, currentTrack: player.currentTrack });
          });
          await this.savePlayerState(ws.i);
        }else{
          this.send(ws, Commands.DOES_NOT_EXIST);
        }
      }, this.videoPlayers[ws.i].locked && !this.videoPlayers[ws.i].canVote);
    }
  }
  async toggleCanTakeOver(canTakeOver, ws) {
    this.onlyIfHost(ws, async () => {
      const player = this.videoPlayers[ws.i];
      player.canTakeOver = canTakeOver;
      player.sockets.forEach(socket => {
        this.send(socket, Commands.CAN_TAKE_OVER_STATE_CHANGED, { canTakeOver: player.canTakeOver });
      });
      await this.savePlayerState(ws.i);
    });
  }
  async takeOver(ws) {
    const player = this.videoPlayers[ws.i];
    if(player && player.canTakeOver) {
      player.host = ws.u;
      player.sockets.forEach(socket => {
        this.send(socket, Commands.HOST_CHANGED, { host: player.host });
      });
      await this.savePlayerState(ws.i);
    }else{
      this.send(ws, Commands.ERROR);
    }
  }
  async toggleLock(locked, ws) {
    this.onlyIfHost(ws, async () => {
      const player = this.videoPlayers[ws.i];
      player.locked = locked;
      // Instead of sending the whole state, broadcast a small, specific message.
      player.sockets.forEach(socket => {
        this.send(socket, Commands.LOCK_STATE_CHANGED, { locked: player.locked });
      });
      await this.savePlayerState(ws.i);
    });
  }
  async setVideoTrack(index, ws) {
    this.onlyIfHost(ws, async () => {
      if(index < this.videoPlayers[ws.i].playlist.length && index > -1) {
        if(this.videoPlayers[ws.i].canVote) {
          const track = this.videoPlayers[ws.i].playlist[this.videoPlayers[ws.i].currentTrack];
          this.videoPlayers[ws.i].votes = this.videoPlayers[ws.i].votes.filter(v => v.video !== track);
        }
        this.videoPlayers[ws.i].currentTrack = index;
        this.videoPlayers[ws.i].currentTime = 0;
        this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
        this.resetBrowserIfNeedBe(this.videoPlayers[ws.i], index);
        this.updateVotes(ws.i);
        const player = this.videoPlayers[ws.i];
        player.sockets.forEach(socket => {
          this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime });
        });
        await this.savePlayerState(ws.i);
      }else{
        this.send(ws, Commands.OUT_OF_BOUNDS);
      }
    }, this.videoPlayers[ws.i].locked && !this.videoPlayers[ws.i].canVote);
  }
  async tickAllInstances() {
    for (const instanceId in this.videoPlayers) {
      const player = this.videoPlayers[instanceId];

      // --- Logic from the old per-instance `tick` ---
      if (player.playlist.length) {
        const now = new Date().getTime() / 1000;
        player.currentTime = now - player.lastStartTime;

        // Use a while loop to correctly handle advancing multiple tracks after a long sleep/downtime.
        while (true) {
          if (!player.playlist.length) break;

          const track = player.playlist[player.currentTrack];
          const trackDuration = (track ? track.duration : 0) / 1000;

          if (trackDuration > 0 && player.currentTime > trackDuration) {
            // Time to advance to the next track
            player.currentTime -= trackDuration; // Carry over the extra time
            player.lastStartTime += trackDuration; // Also advance the start time to maintain sync

            player.votes = player.votes.filter(v => v.video !== track);
            player.currentTrack++;
            if (player.currentTrack >= player.playlist.length) {
              player.currentTrack = 0;
            }
            this.updateVotes(instanceId);
            this.resetBrowserIfNeedBe(player, player.currentTrack);
            player.sockets.forEach(socket => {
              this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime });
            });
            await this.savePlayerState(instanceId);
          } else {
            // Current time is within the current track's duration, so we can stop.
            break;
          }
        }
      } else {
        player.currentTime = player.currentTrack = 0;
      }

    }
  }
  resetBrowserIfNeedBe(player, index) {
    const users = [...new Set(player.sockets.map(ws => ws.u.id))];
    users.forEach(uid => {
      const userSockets = player.sockets.filter(ws => ws.u.id === uid);
        userSockets.forEach(socket => {
          if(socket.type === "space") {
            if(player.playlist[index].is_youtube_website) {
              this.send(socket, Commands.SET_BROWSER_URL, player.playlist[index]);
            }else{
              const videoPlayer = userSockets.filter(ws => ws.type === "player");
              if(!videoPlayer.length) {
                  this.send(socket, Commands.RESET_BROWSER, {});
              }
            }
          }
      });
    });
  }
  async setVideoTime(time, ws) {
    this.onlyIfHost(ws, async () => {
      this.videoPlayers[ws.i].currentTime = time;
      this.videoPlayers[ws.i].lastStartTime = new Date().getTime() / 1000;
      await this.savePlayerState(ws.i);
    }, this.videoPlayers[ws.i].locked);
  }
  async handleVideoUnavailable(data, ws) {
    const player = this.videoPlayers[ws.i];
    if (!player) return;

    const blockedVideo = player.playlist.find(v => v.link === data.link);
    if (!blockedVideo) return;

    console.log(`Video '${blockedVideo.title}' is unavailable for ${ws.u.name}. Searching for alternative.`);

    // Search for a replacement using the title
    const results = await youtube.search(blockedVideo.title, { searchType: 'video' });
    if (results.videos && results.videos.length > 0) {
      // Find the first result that is not the same as the blocked video, or default to the first one.
      const alternative = results.videos.find(v => v.link !== blockedVideo.link) || results.videos[0];

      console.log(`Found alternative: '${alternative.title}'. Prompting host.`);

      // Find all of the host's sockets to send the prompt to.
      const hostSockets = player.sockets.filter(s => s.u.id === player.host.id);

      if (hostSockets.length > 0) {
        hostSockets.forEach(socket => {
          this.send(socket, Commands.SHOW_REPLACE_PROMPT, {
            original: blockedVideo,
            alternative: alternative // This is a raw scraper object
          });
        });
      }
    }
  }
  async handleReplaceVideo(data, ws) {
    this.onlyIfHost(ws, async () => {
      const player = this.videoPlayers[ws.i];
      if (!player) return;

      const { originalLink, alternativeVideo } = data;
      const videoIndex = player.playlist.findIndex(v => v.link === originalLink);

      if (videoIndex > -1) {
        const originalVideo = player.playlist[videoIndex];
        // Create a standardized video object from the raw scraper data
        const newVideo = this._createVideoObject(alternativeVideo, originalVideo.user, 'scraper');

        // Replace the old video with the new one
        player.playlist[videoIndex] = newVideo;

        console.log(`Host ${ws.u.name} replaced '${originalVideo.title}' with '${newVideo.title}'.`);

        // If the replaced video was the one currently playing, we need to send a SET_TRACK command
        // to force clients to reload the video source. Otherwise, a simple update is fine.
        const wasCurrentTrack = (videoIndex === player.currentTrack);
        if (wasCurrentTrack) {
          player.lastStartTime = new Date().getTime() / 1000;
          player.sockets.forEach(socket => {
            this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime, playlist: player.playlist });
          });
        } else {
          player.sockets.forEach(socket => {
            this.send(socket, Commands.PLAYLIST_UPDATED, { playlist: player.playlist, currentTrack: player.currentTrack });
          });
        }
        await this.savePlayerState(ws.i);
      }
    });
  }
  async createVideoPlayer(instanceId, user, ws) {
    if(!this.videoPlayers[instanceId]) {
      const client = await this.pool.connect();
      let existingState = null;
      try {
        const res = await client.query('SELECT player_data FROM player_state WHERE instance_id = $1', [instanceId]);
        if (res.rows.length > 0) {
          existingState = res.rows[0].player_data;
          console.log(`Loaded state for instance: ${instanceId}`);
        }
      } catch (err) {
        console.error('Error loading player state:', err);
      } finally {
        client.release();
      }

      // Create the new player object, defaulting the connecting user as host.
      // This will be overwritten by existingState if a host is already saved.
      this.videoPlayers[instanceId] = {
        playlist:[],
        votes: [],
        currentTrack: 0,
        currentTime: 0,
        locked: false,
        host: user,
        hostConnected: false, // Default to false. Will be set true upon "space" connection.
        sockets: [ws],
        canTakeOver: true,
        canVote: false,
        currentPlayerUrl: "",
        lastStartTime: new Date().getTime() / 1000
      };

      if (existingState) {
        Object.assign(this.videoPlayers[instanceId], existingState);
      }

      // For a brand new instance (no state loaded from DB), the creator is the host and is connected.
      if (!existingState) {
        this.videoPlayers[instanceId].hostConnected = true;
      }
      console.log(this.videoPlayers[instanceId].host.name, 'is host');
    }else{
      // If a user reconnects to an instance that was scheduled for deletion, cancel the deletion.
      if (this.videoPlayers[instanceId].deleteTimeout) {
        console.log(`User reconnected to instance ${instanceId}. Cancelling cleanup.`);
        clearTimeout(this.videoPlayers[instanceId].deleteTimeout);
        this.videoPlayers[instanceId].deleteTimeout = null;
      }
      if(!this.videoPlayers[instanceId].sockets.includes(ws)) {
         this.videoPlayers[instanceId].sockets.push(ws);
      }
    } 
    this.syncWsTime(ws, instanceId);
    this.send(ws, Commands.PLAYBACK_UPDATE, {video: this.getVideoObject(instanceId), type: 'initial-sync'});
  }
  getVideoObject(instanceId, { includePlaylist = true } = {}) {
    if(this.videoPlayers[instanceId]) {
      const player = this.videoPlayers[instanceId];
      const map = new Map(player.sockets.filter(s => s.p).map(s => [s.u.id, s]));
      
      const videoObject = {
        currentTime: player.currentTime,
        currentTrack: player.currentTrack,
        lastStartTime: player.lastStartTime,
        locked: player.locked,
        players: [...map.values()].map(s => ({name: s.u.name, p: s.p, id: s.u.id, v: s.p_v})),
        canTakeOver: player.canTakeOver,
        canVote: player.canVote,
        host: player.host,
        duration: player.playlist.length && player.playlist[player.currentTrack] ? player.playlist[player.currentTrack].duration / 1000 : 0
      };

      if (includePlaylist) {
        videoObject.playlist = player.playlist;
      }

      return videoObject;
    }
  }
  syncWsTime(socket, key, data = {}) {
    // This command is specifically for the video player element to correct its time.
    // The playlist/UI pages use the lastStartTime from PLAYBACK_UPDATE to calculate time.
    // Therefore, we only send this to the 'player' type socket.
    if(this.videoPlayers[key] && this.videoPlayers[key].playlist.length && socket.type === "player") {
      this.send(socket, Commands.SYNC_TIME, {
        currentTrack: this.videoPlayers[key].currentTrack,
        clientTimestamp: data.clientTimestamp,
        currentTime: this.videoPlayers[key].currentTime,
        duration: this.videoPlayers[key].playlist.length && this.videoPlayers[key].playlist[this.videoPlayers[key].currentTrack] ? this.videoPlayers[key].playlist[this.videoPlayers[key].currentTrack].duration / 1000 : 0
      });
    }
  }
  updateClients(instanceId, type, options = {}) {
    if(this.videoPlayers[instanceId]) {
      const video = this.getVideoObject(instanceId, options);
      this.videoPlayers[instanceId].sockets.forEach(socket => {
        this.send(socket, Commands.PLAYBACK_UPDATE, {video, type});
      });
    }
  }
}

const app = new App();

async function start() {
  try {
    console.log("Initializing database...");
    await app.setupDatabase();
    console.log("Database initialization complete.");

    app.setupWebserver();
    app.mainLoop = setInterval(() => app.tickAllInstances(), 1000);

    const port = process.env.PORT || 3000;
    app.server.listen(port, () => {
      // Attach the connection handlers only AFTER the server is successfully listening.
      app.attachWebsocketListeners();
      console.log(`Video Player started and listening on port ${port}.`);
    });
  } catch (err) {
    console.error("Failed to start application:", err);
    process.exit(1);
  }
}

start();
module.exports = app;