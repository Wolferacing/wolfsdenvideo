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
const SkipJumpTimePlaylist = 5;
const SkipJumpTimeKaraoke = 0.25; // 250ms for karaoke, to allow for more precise timing.

class App{
  constructor() {
    this.videoPlayers = {};
    this.mainLoop = null;
    this.cleanupLoop = null;
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

    // Build a map of all unique users to avoid storing redundant names.
    const userMap = {};
    if (player.host) {
      userMap[player.host.id] = player.host.name;
    }

    // Create a lean version of the playlist for storage.
    const leanPlaylist = player.playlist.map(video => {
      if (video.user && video.user.id) {
        userMap[video.user.id] = video.user.name;
      }
      return {
        title: video.title,
        duration: video.duration,
        link: video.link,
        userId: video.user ? video.user.id : null
      };
    });

    const stateToSave = {
      playlist: leanPlaylist,
      userMap: userMap,
      singers: player.singers,
      currentTrack: player.currentTrack,
      lastStartTime: player.lastStartTime,
      locked: player.locked,
      canTakeOver: player.canTakeOver,
      canVote: player.canVote,
      hostId: player.host ? player.host.id : null,
      autoAdvance: player.autoAdvance,
      isKaraoke: player.isKaraoke
    };

    const client = await this.pool.connect();
    try {
      // This query uses ON CONFLICT to perform an "upsert": update if exists, insert if not.
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
  async cleanupInactiveInstances() {
    const cleanupThreshold = '7 days'; // The inactivity period before an instance is purged.
    console.log(`Running cleanup for instances inactive for more than ${cleanupThreshold}...`);
    const client = await this.pool.connect();
    try {
      const query = `
        DELETE FROM player_state
        WHERE updated_at < NOW() - INTERVAL '${cleanupThreshold}'
      `;
      const result = await client.query(query);
      if (result.rowCount > 0) {
        console.log(`Database cleanup: Removed ${result.rowCount} inactive instance(s).`);
      } else {
        console.log('Database cleanup: No inactive instances to remove.');
      }
    } catch (err) {
      console.error('Error during database cleanup of inactive instances:', err);
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
        this.handleClose(ws, code, reason);
      });
    });

    // The ping/pong interval should also start only when the server is live.
    const interval = setInterval(() => {
      this.wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate(); // This triggers the 'close' event
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.server.on('close', () => {
      clearInterval(this.mainLoop);
      clearInterval(interval);
      clearInterval(this.cleanupLoop);
    });
  }
  handleClose(ws, code, reason) {
    // Convert the reason buffer to a string for readable logging, handling empty reasons.
    const reasonString = reason && reason.length > 0 ? reason.toString() : 'No reason given';
    console.log(`${ws.u ? ws.u.name : 'Unknown'} disconnected from ${ws.type || 'N/A'}. Code: ${code}, Reason: ${reasonString}`);
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
      // If the disconnected user had active votes, we need to update the clients.
      if (voteCount > videoPlayer.votes.length) {
        this.updateVotes(instanceId); // Recalculate vote counts on each video.
        // Broadcast the updated playlist to all clients in the instance.
        videoPlayer.sockets.forEach(socket => {
            this.send(socket, Commands.PLAYLIST_UPDATED, { playlist: videoPlayer.playlist, currentTrack: videoPlayer.currentTrack });
        });
      }
    }
    this.updateClients(instanceId, 'user-left', { includePlaylist: false }); // This lightweight message can remain.

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
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[RECV] user: ${ws.u ? ws.u.name : 'N/A'}, instance: ${ws.i || 'N/A'}, type: ${ws.type || 'N/A'}, path: ${msg.path}`);
    }
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
      case Commands.PLAY_KARAOKE_TRACK:
        await this.playKaraokeTrack(ws, msg.data);
        break;
      case Commands.RESTART_SONG:
        await this.restartSong(ws);
        break;
      case Commands.TOGGLE_AUTO_ADVANCE:
        await this.toggleAutoAdvance(ws);
        break;
      case Commands.AUTO_SYNC_STATE_CHANGED:
        // This message comes from the player when it disables auto-sync internally.
        // We need to broadcast this to the user's UI(s).
        const playerInstance = this.videoPlayers[ws.i];
        if (playerInstance) {
          playerInstance.sockets.forEach(socket => {
            // Send only to the same user's UI sockets (playlist/karaoke)
            if (socket.u.id === ws.u.id && socket.type === 'playlist') {
              this.send(socket, Commands.AUTO_SYNC_STATE_CHANGED, msg.data);
            }
          });
        }
        break;
      case Commands.HOST_SKIP_BACK:
        await this.hostSkip(ws, false);
        break;
      case Commands.HOST_SKIP_FORWARD:
        await this.hostSkip(ws, true);
        break;
      case Commands.SET_INSTANCE_MODE:
        const playerInstanceForMode = this.videoPlayers[ws.i];
        if (playerInstanceForMode) {
          // This flag determines how track advancement is handled.
          playerInstanceForMode.isKaraoke = msg.data === 'karaoke';
          await this.savePlayerState(ws.i);
        }
        break;
      case Commands.VIDEO_UNAVAILABLE:
        await this.handleVideoUnavailable(msg.data, ws);
        break;
      case Commands.REPLACE_VIDEO:
        await this.handleReplaceVideo(msg.data, ws);
        break;
    }
  }
  _createVideoObject(videoData, userObject, source, isYoutubeWebsite = false) {
    // Standardizes video objects from different sources (ytfps, scraper)
    if (source === 'ytfps') {
      return {
        title: videoData.title,
        thumbnail: videoData.thumbnail_url,
        duration: videoData.milis_length,
        link: videoData.url,
        votes: 0,
        user: userObject,
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
      user: userObject,
      is_youtube_website: isYoutubeWebsite
    };
  }

  _isDuplicateVideo(player, videoLink) {
    const newVideoId = this.getYoutubeId(videoLink);
    if (!newVideoId) return false; // Can't check if we can't get an ID
    return player.playlist.some(existingVideo => this.getYoutubeId(existingVideo.link) === newVideoId);
  }

  _getPlaylistId(urlOrId) {
    if (!urlOrId) {
      return null;
    }
    // First, check if the input is just a valid playlist ID.
    if (urlOrId.startsWith('PL') && !urlOrId.includes('/') && !urlOrId.includes('?')) {
        return urlOrId;
    }

    // If it's a URL, try to extract the 'list' parameter.
    const regex = /[?&]list=([^#&?]+)/;
    const match = urlOrId.match(regex);

    if (match && match[1] && match[1].startsWith('PL')) {
        return match[1];
    }

    return null;
  }
  async moveSinger({ userId, direction }, ws) {
    this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        if (!player) return;
        
        const oldIndex = player.singers.findIndex(s => s.user.id === userId);

        if (oldIndex === -1) {
            return; // Singer not found
        }

        let newIndex;
        if (direction === 'up' && oldIndex > 0) {
            newIndex = oldIndex - 1;
        } else if (direction === 'down' && oldIndex < player.singers.length - 1) {
            newIndex = oldIndex + 1;
        } else {
            return; // Invalid move
        }

        // Swap the singers by removing the item and re-inserting it at the new position.
        const [singerToMove] = player.singers.splice(oldIndex, 1);
        player.singers.splice(newIndex, 0, singerToMove);

        this.broadcastSingerList(ws.i);
        await this.savePlayerState(ws.i);
    });
  }
  async removeFromPlayers(uid, ws) {
    const player = this.videoPlayers[ws.i];
    if (!player) return;

    const isHost = player.host.id === ws.u.id;
    const isSelf = uid === ws.u.id;

    // A user can remove themselves, or the host can remove anyone.
    if (isHost || isSelf) {
      const singerIndex = player.singers.findIndex(s => s.user.id === uid);

      if (singerIndex > -1) {
        const wasCurrentSinger = singerIndex === 0;
        const removedSinger = player.singers.splice(singerIndex, 1)[0];
        console.log(`${ws.u.name} removed ${removedSinger.user.name} from the singer list.`);

        // If the person removed was the one currently singing, stop the main player.
        if (wasCurrentSinger) {
          console.log(`Current singer was removed. Stopping player for instance ${ws.i}.`);
          this.updateClients(ws.i, "stop");
        }
        // Send a granular update for efficiency.
        player.sockets.forEach(socket => this.send(socket, Commands.SINGER_REMOVED, { userId: uid }));
        console.log(`Broadcasting SINGER_REMOVED for user ${uid}.`);
        await this.savePlayerState(ws.i);
      }
    } else {
      this.send(ws, Commands.ERROR);
    }
  }
  stop(ws) {
    this.onlyIfHost(ws, async () => this._stop(ws.i), this.videoPlayers[ws.i].locked);
  }
  async _stop(instanceId) {
    const player = this.videoPlayers[instanceId];
    if (!player) return;
    // When stopping, we clear the main playlist. This is especially important for karaoke
    // to return the UI to the singer list view.
    player.playlist = [];
    player.currentTrack = 0;
    player.currentTime = 0;
    this.updateClients(instanceId, "stop");
    await this.savePlayerState(instanceId);
  }
  setAutoSync(autoSync, ws) {
    if(ws.user_video) {
      this.send(ws.user_video, Commands.AUTO_SYNC, autoSync);
    }
  }
  async addToPlayers(video, ws){
    const player = this.videoPlayers[ws.i];
    if (!player) return;

    // Prevent a user from adding themselves to the queue more than once.
    if (player.singers.some(singer => singer.user.id === ws.u.id)) {
      this.send(ws, Commands.ERROR, { message: "You are already in the singer list." });
      return;
    }

    // Add a singer object to the persistent queue.
    player.singers.push({
      user: ws.u,
      video: video,
      timestamp: new Date().getTime()
    });
    
    // Send a granular update instead of the whole list for efficiency.
    const newSingerPayload = { name: ws.u.name, p: player.singers[player.singers.length - 1].timestamp, id: ws.u.id, v: video };
    player.sockets.forEach(socket => this.send(socket, Commands.SINGER_ADDED, { player: newSingerPayload }));
    console.log(`${ws.u.name} was added to the singer list. Broadcasting SINGER_ADDED.`);
    await this.savePlayerState(ws.i);
  }
  async playKaraokeTrack(ws, data) {
    const player = this.videoPlayers[ws.i];
    if (!player) return;

    const isHost = player.host.id === ws.u.id;
    const singerToPlayId = data ? data.userId : null;

    if (singerToPlayId) {
      // A specific singer was requested. Only the host can do this.
      if (!isHost) {
        this.send(ws, Commands.ERROR, { message: "Only the host can play a specific singer." });
        return;
      }

      const singerIndex = player.singers.findIndex(s => s.user.id === singerToPlayId);
      if (singerIndex === -1) {
        this.send(ws, Commands.ERROR, { message: "Singer not found." });
        return;
      }

      // Move the selected singer to the front of the queue.
      if (singerIndex > 0) {
        const [singerToPlay] = player.singers.splice(singerIndex, 1);
        player.singers.unshift(singerToPlay);
      }
    } else {
      // No specific singer, play the one at the top.
      // The person initiating must be the host, or the singer whose turn it is.
      const nextSinger = player.singers.length > 0 ? player.singers[0] : null;
      if (!nextSinger) return; // No one to play
      const isTheSinger = nextSinger.user.id === ws.u.id;

      if (!isHost && !isTheSinger) {
          this.send(ws, Commands.ERROR, { message: "Only the host or the current singer can start the song." });
          return;
      }
    }
    // Now that the correct singer is at the front, play the song.
    await this._playNextKaraokeSong(ws.i);
  }
  async _playNextKaraokeSong(instanceId) {
    const player = this.videoPlayers[instanceId];
    if (!player || player.singers.length === 0) return;

    const nextSinger = player.singers[0];
    const videoToPlay = nextSinger.video;
    if (!videoToPlay) return;

    // Atomically update the player state
    player.playlist = [];
    player.currentTrack = 0;
    player.currentTime = 0;
    const newVideo = this._createVideoObject(videoToPlay, nextSinger.user, 'scraper');
    player.playlist.push(newVideo);
    
    // Apply the same "settling period" logic as the restart button to ensure a smooth start.
    // By setting the start time 2 seconds in the future, we give all clients time to load
    // and buffer the video at 0s before the timer starts counting up.
    //const settleTime = 2; // 2 seconds
    player.lastStartTime = (new Date().getTime() / 1000); // + settleTime;
    
    // Remove the singer from the queue now that their turn has started.
    player.singers.shift();
    
    console.log(`Karaoke track started for ${nextSinger.user.name} in instance ${instanceId}`);

    // Create the updated singer list payload to send along with the track change.
    const singersPayload = player.singers.map(s => ({
      name: s.user.name,
      p: s.timestamp,
      id: s.user.id,
      v: s.video
    }));

    // Notify ALL clients that the track has changed. This is the authoritative message
    // that forces all UIs and the in-world player to sync to the new state. We include
    // the updated singer list in this single message for maximum efficiency.
    player.sockets.forEach(socket => {
        this.send(socket, Commands.TRACK_CHANGED, {
            newTrackIndex: 0,
            newLastStartTime: player.lastStartTime,
            playlist: player.playlist, // Send the new one-song playlist
            singers: singersPayload
        });
    });
    await this.savePlayerState(instanceId);
  }
  async restartSong(ws) {
    const player = this.videoPlayers[ws.i];
    if (!player || !player.playlist.length) return;

    const currentVideo = player.playlist[player.currentTrack];
    const isHost = player.host.id === ws.u.id;
    const isCurrentSinger = currentVideo.user.id === ws.u.id;

    if (isHost || isCurrentSinger) {
      // To ensure all clients sync perfectly at the beginning, we introduce a "settling" period.
      // By setting the start time 2 seconds in the future, the server's calculated `currentTime`
      // will be negative for 2 seconds. This gives all player clients time to load and buffer
      // the video at 0s. The sync mechanism will keep them at 0 until the server time becomes positive.
      // const settleTime = 2; // 2 seconds
      player.lastStartTime = (new Date().getTime() / 1000); // + settleTime;

      // We still tell the client that the current time is 0 so it seeks there immediately.
      player.currentTime = 0;

      player.sockets.forEach(socket => {
        this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime, newCurrentTime: 0 });
      });
      await this.savePlayerState(ws.i);
    }
  }
  async toggleAutoAdvance(ws) {
    this.onlyIfHost(ws, async () => {
      const player = this.videoPlayers[ws.i];
      player.autoAdvance = !player.autoAdvance;
      // Send a specific, granular message instead of a full playback update.
      // This ensures the client UI updates correctly without needing a full state refresh.
      player.sockets.forEach(socket => {
        this.send(socket, Commands.AUTO_ADVANCE_STATE_CHANGED, { autoAdvance: player.autoAdvance });
      });
      await this.savePlayerState(ws.i);
    });
  }
  async hostSkip(ws, isForward) {
    this.onlyIfHost(ws, async () => {
      const player = this.videoPlayers[ws.i];
      if (!player || !player.playlist.length) return;

      // Use the explicit isKaraoke flag for a more reliable check.
      const skipAmount = player.isKaraoke ? SkipJumpTimeKaraoke : SkipJumpTimePlaylist;

      // To skip forward in time, we subtract from the start timestamp.
      // To skip backward, we add to it.
      player.lastStartTime += isForward ? -skipAmount : skipAmount;

      // Calculate the new current time to send to clients for an immediate seek.
      const newCurrentTime = (new Date().getTime() / 1000) - player.lastStartTime;
      player.currentTime = newCurrentTime; // Keep server state consistent.

      // Broadcast a seek command to all clients.
      player.sockets.forEach(socket => {
        this.send(socket, Commands.HOST_SEEK, {
          newCurrentTime: newCurrentTime,
          newLastStartTime: player.lastStartTime
        });
      });
      await this.savePlayerState(ws.i);
    });
  }
  async toggleVote(ws) {
    if (this.videoPlayers[ws.i]) {
      this.onlyIfHost(ws, async () => {
        const player = this.videoPlayers[ws.i];
        player.canVote = !player.canVote;
        // When turning voting on, clear all existing votes to start fresh.
        // Also, broadcast a playlist update to ensure clients' UIs reflect the cleared votes.
        if (player.canVote) {
          player.votes = [];
          this.updateVotes(ws.i); // This resets the vote counts on the video objects to 0.
          player.sockets.forEach(socket => {
            this.send(socket, Commands.PLAYLIST_UPDATED, { playlist: player.playlist, currentTrack: player.currentTrack });
          });
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
    const playlistId = this._getPlaylistId(data.id);
    if (!playlistId) {
      this.send(ws, Commands.ERROR, { message: "Invalid Playlist URL or ID provided." });
      return;
    }
    console.log(`fromPlaylist: user=${ws.u.name}, instance=${ws.i}, id=${playlistId}`);
    this.onlyIfHost(ws, async () => {
      if(this.videoPlayers[ws.i] && (this.videoPlayers[ws.i].playlist.length === 0 || data.shouldClear)) {
        const player = this.videoPlayers[ws.i];
        let playlist = await ytfps(playlistId, { limit: 100 });
        this.resetPlaylist(ws); // Resets playlist, currentTime, currentTrack
        // --- Duplicate Video Check for bulk add ---
        const existingVideoIds = new Set();
        let addedCount = 0;
        playlist.videos.forEach(v => {
          const newVideoId = this.getYoutubeId(v.url);
          if (newVideoId && !existingVideoIds.has(newVideoId)) {
            player.playlist.push(this._createVideoObject(v, ws.u, 'ytfps'));
            existingVideoIds.add(newVideoId); // Add to set to prevent duplicates within the same playlist import
            addedCount++;
          }
        });
        const duplicateCount = playlist.videos.length - addedCount;
        if (duplicateCount > 0) {
            this.send(ws, Commands.ERROR, { message: `Added ${addedCount} videos. ${duplicateCount} duplicate(s) were skipped.` });
        }
        // --- End of Check ---
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
        if (this._isDuplicateVideo(player, v.link)) {
          this.send(ws, Commands.ERROR, { message: "This video is already in the playlist." });
          return;
        }
        const newVideo = this._createVideoObject(v, ws.u, 'scraper');
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
        if (this._isDuplicateVideo(player, v.link)) {
          this.send(ws, Commands.ERROR, { message: "This video is already in the playlist." });
          return;
        }
        const newVideo = this._createVideoObject(v, ws.u, 'scraper');
        const nextIndex = player.currentTrack + 1;
        player.playlist.splice(nextIndex, 0, newVideo);
        // Send a granular ITEM_INSERTED command for efficiency.
        player.sockets.forEach(socket => {
          this.send(socket, Commands.ITEM_INSERTED, { video: newVideo, index: nextIndex });
        });
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
    const player = this.videoPlayers[ws.i];
    if(player) {
      this.onlyIfHost(ws, async () => {
        // --- Duplicate Video Check ---
        if (this._isDuplicateVideo(player, v.link)) {
          this.send(ws, Commands.ERROR, { message: "This video is already in the playlist." });
          return;
        }
        // --- End of Check ---
        if(!player.playlist.length) {
          player.currentTrack = 0;
          player.currentTime = 0;
          player.lastStartTime = new Date().getTime() / 1000;
        }
        const newVideo = this._createVideoObject(v, ws.u, 'scraper', isYoutubeWebsite);
        player.playlist.push(newVideo);
        if(!skipUpdate) {
          // Send a granular ITEM_APPENDED command for efficiency.
          player.sockets.forEach(socket => {
            this.send(socket, Commands.ITEM_APPENDED, { video: newVideo });
          });
        }
        await this.savePlayerState(ws.i);
      }, player.locked);
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

          // Send a granular update for efficiency instead of the whole playlist.
          player.sockets.forEach(socket => {
            this.send(socket, Commands.ITEM_MOVED, { oldIndex, newIndex: index, newCurrentTrack: player.currentTrack });
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

        if (track && trackDuration > 0 && player.currentTime > trackDuration) {
          // A track has finished.
          if (player.isKaraoke) {
            // In a karaoke context, a song ending means we either stop or auto-advance.
            if (player.autoAdvance && player.singers.length > 0) {
              await this._playNextKaraokeSong(instanceId);
            } else {
              await this._stop(instanceId);
            }
            break; // Exit the while loop for this instance.
          } else if (!player.autoAdvance && player.isKaraoke){
             // The "else" condition means the current singer's track is over.
             await this._stop(instanceId);
          } else {
            // In a regular playlist context, loop to the next song.
            player.currentTime -= trackDuration;
            player.lastStartTime += trackDuration;
            player.votes = player.votes.filter(v => v.video !== track);
            player.currentTrack = (player.currentTrack + 1) % player.playlist.length;
            this.updateVotes(instanceId);
            this.resetBrowserIfNeedBe(player, player.currentTrack);
            player.sockets.forEach(socket => {
              this.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime });
            });
            await this.savePlayerState(instanceId);
            }
          } else {
          // Current time is within the track's duration, so we can exit the loop.
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
            // Send a granular ITEM_REPLACED message instead of the whole playlist.
            this.send(socket, Commands.ITEM_REPLACED, { index: videoIndex, newVideo: newVideo });
          });
        }
        await this.savePlayerState(ws.i);
      }
    });
  }
  getYoutubeId(url){
    // Extracts the 11-character YouTube video ID from a URL.
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : false;
  }
  async createVideoPlayer(instanceId, user, ws) {
    if(!this.videoPlayers[instanceId]) {
      const client = await this.pool.connect();
      let existingState = null;
      try {
        const res = await client.query('SELECT player_data FROM player_state WHERE instance_id = $1', [instanceId]);
        if (res.rows.length > 0) {
          existingState = res.rows[0].player_data;

          // --- Data Re-hydration and Migration ---
          // This logic handles both the new "lean" format and the old "fat" format,
          // ensuring seamless migration of old data.
          if (existingState.playlist && Array.isArray(existingState.playlist)) {
            const userMap = existingState.userMap || {};

            // If we loaded an old record, build the userMap from the fat data.
            if (!existingState.userMap) {
              if (existingState.host) userMap[existingState.host.id] = existingState.host.name;
              existingState.playlist.forEach(video => {
                if (video.user) userMap[video.user.id] = video.user.name;
              });
            }

            existingState.playlist = existingState.playlist.map(video => {
              // Re-hydrate thumbnail if missing (from lean format)
              if (!video.thumbnail) {
                const videoId = this.getYoutubeId(video.link);
                video.thumbnail = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
              }

              // Re-hydrate user object if missing (from lean format)
              if (!video.user && video.userId && userMap[video.userId]) {
                video.user = { id: video.userId, name: userMap[video.userId] };
              } else if (!video.user) {
                video.user = { id: null, name: 'Unknown' };
              }

              // Always reset non-persistent state
              video.votes = 0;
              return video;
            });

            // Re-hydrate host object if missing (from lean format)
            if (!existingState.host && existingState.hostId && userMap[existingState.hostId]) {
              existingState.host = { id: existingState.hostId, name: userMap[existingState.hostId] };
            }
          }
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
        singers: [],
        playlist:[],
        votes: [],
        currentTrack: 0,
        currentTime: 0,
        locked: false,
        host: user,
        hostConnected: false, // Default to false. Will be set true upon "space" connection.
        sockets: [ws],
        autoAdvance: false,
        isKaraoke: false, // Default to playlist mode. Will be set by the client.
        canTakeOver: true,
        canVote: false,
        currentPlayerUrl: "",
        lastStartTime: new Date().getTime() / 1000
      };

      if (existingState) {
        Object.assign(this.videoPlayers[instanceId], existingState);
        // Ensure the singers array exists if loading older state from the DB.
        if (!this.videoPlayers[instanceId].singers) {
          this.videoPlayers[instanceId].singers = [];
        }
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
    // Send a single, comprehensive update including the singer list for karaoke mode.
    // This prevents race conditions on the client and ensures all data is available on connect.
    this.send(ws, Commands.PLAYBACK_UPDATE, {
      video: this.getVideoObject(instanceId, { includePlaylist: true, includeSingers: true }),
      type: 'initial-sync'
    });
  }
  getVideoObject(instanceId, { includePlaylist = true, includeSingers = false } = {}) {
    if(this.videoPlayers[instanceId]) {
      const player = this.videoPlayers[instanceId];
      
      const videoObject = {
        currentTime: player.currentTime,
        currentTrack: player.currentTrack,
        lastStartTime: player.lastStartTime,
        locked: player.locked,
        canTakeOver: player.canTakeOver,
        canVote: player.canVote,
        host: player.host,
        duration: player.playlist.length && player.playlist[player.currentTrack] ? player.playlist[player.currentTrack].duration / 1000 : 0,
        autoAdvance: player.autoAdvance // Ensure autoAdvance state is always included
      };

      if (includePlaylist) {
        videoObject.playlist = player.playlist;
      }

      // Optionally include the singer list for karaoke mode.
      if (includeSingers && player.singers) {
        // The client expects the list under the key 'players'
        videoObject.players = player.singers.map(s => ({
            name: s.user.name,
            p: s.timestamp,
            id: s.user.id,
            v: s.video
        }));
      }

      return videoObject;
    }
  }
  syncWsTime(socket, key, data = {}) {
    // This command is specifically for the video player element to correct its time.
    // The playlist/UI pages use the lastStartTime from PLAYBACK_UPDATE to calculate time.
    // Therefore, we only send this to the 'player' type socket.
    if(this.videoPlayers[key] && this.videoPlayers[key].playlist.length && socket.type === "player") {
      // --- FIX: Calculate current time on-demand for accuracy ---
      // The server's main loop updates currentTime only once per second.
      // For an accurate sync, we must calculate the exact time at the moment of sending.
      const player = this.videoPlayers[key];
      const now = new Date().getTime() / 1000;
      const preciseCurrentTime = now - player.lastStartTime;

      this.send(socket, Commands.SYNC_TIME, {
        currentTrack: player.currentTrack,
        clientTimestamp: data.clientTimestamp,
        currentTime: preciseCurrentTime, // Use the precise time
        duration: player.playlist.length && player.playlist[player.currentTrack] ? player.playlist[player.currentTrack].duration / 1000 : 0
      });
    }
  }
  updateClients(instanceId, type, options = {}) {
    if(this.videoPlayers[instanceId]) {
      const player = this.videoPlayers[instanceId];
      // For Karaoke mode, we should always include the singer list in general updates
      // to ensure the UI stays in sync, as it's the primary view.
      // This prevents the list from disappearing on a non-host's UI after a generic event.
      if (player.isKaraoke && options.includeSingers === undefined) {
        options.includeSingers = true;
      }
      const video = this.getVideoObject(instanceId, options);
      player.sockets.forEach(socket => {
        this.send(socket, Commands.PLAYBACK_UPDATE, {video, type});
      });
    }
  }
  broadcastSingerList(instanceId) {
    const player = this.videoPlayers[instanceId];
    if (!player) return;

    // Create the payload with the current singer list.
    const singers = player.singers.map(s => ({
      name: s.user.name,
      p: s.timestamp,
      id: s.user.id,
      v: s.video
    }));

    // Send the specific update to all connected UIs.
    player.sockets.forEach(socket => this.send(socket, Commands.SINGER_LIST_UPDATED, { players: singers }));
  }
}

const app = new App();

async function start() {
  try {
    console.log("Initializing database...");
    await app.setupDatabase();
    console.log("Database initialization complete.");

    // --- Database Cleanup ---
    // Run cleanup once on startup to immediately clear out old records.
    await app.cleanupInactiveInstances();
    // Schedule the cleanup to run periodically (e.g., every 24 hours).
    const cleanupIntervalMs = 24 * 60 * 60 * 1000;
    app.cleanupLoop = setInterval(() => app.cleanupInactiveInstances(), cleanupIntervalMs);
    console.log(`Scheduled periodic database cleanup every ${cleanupIntervalMs / (60 * 60 * 1000)} hours.`);
    // --- End of Cleanup ---

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