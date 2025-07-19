const { WebSocket } = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const Youtube = require('./youtube/scraper.js');
const youtube = new Youtube();
const ytfps = require('ytfps');
const fetch = require('node-fetch');
const Commands = require('../public/commands.js');
const playlistHandler = require('./handlers/playlistHandler.js');
const karaokeHandler = require('./handlers/karaokeHandler.js');
const hostHandler = require('./handlers/hostHandler.js');
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
        await hostHandler.setVideoTime(this, ws, msg.data);
        break;
      case Commands.SET_TRACK:
        await hostHandler.setVideoTrack(this, ws, msg.data);
        break;
      case Commands.TOGGLE_LOCK:
        await hostHandler.toggleLock(this, ws, msg.data);
        break;
      case Commands.TOGGLE_CAN_TAKE_OVER:
        await hostHandler.toggleCanTakeOver(this, ws, msg.data);
        break;
      case Commands.TAKE_OVER:
        await hostHandler.takeOver(this, ws); 
        break;
      case Commands.ADD_TO_PLAYLIST:
        await playlistHandler.addToPlaylist(this, ws, msg.data, msg.skipUpdate, msg.isYoutubeWebsite);
        break;
      case Commands.MOVE_PLAYLIST_ITEM:
        await playlistHandler.movePlaylistItem(this, ws, msg.data);
        break;
      case Commands.REMOVE_PLAYLIST_ITEM:
        await playlistHandler.removePlaylistItem(this, ws, msg.data);
        break;
      case Commands.SEARCH:
        this.search(msg.data, ws);
        break;
      case Commands.FROM_PLAYLIST:
        await playlistHandler.fromPlaylist(this, ws, msg.data);
        break;
      case Commands.CLEAR_PLAYLIST:
        await playlistHandler.clearPlaylist(this, ws, msg.skipUpdate);
        break;
      case Commands.USER_VIDEO_PLAYER:
        ws.is_video_player = true;
        this.setUserVideoPlayer(msg.data, ws);
        break;
      case Commands.STOP:
        await hostHandler.stop(this, ws);
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
        await hostHandler.toggleVote(this, ws)
        break; 
      case Commands.DOWN_VOTE:
        await playlistHandler.setVote(this, ws, msg.data, true);
        break;
      case Commands.UP_VOTE:
        await playlistHandler.setVote(this, ws, msg.data, false);
        break;
      case Commands.ADD_TO_PLAYERS:
        await karaokeHandler.addToPlayers(this, ws, msg.data);
        break;
      case Commands.REMOVE_FROM_PLAYERS:
        await karaokeHandler.removeFromPlayers(this, ws, msg.data);
        break;
      case Commands.ADD_AND_PLAY:
        await playlistHandler.addAndPlay(this, ws, msg.data);
        break;
      case Commands.ADD_AND_PLAY_NEXT:
        await playlistHandler.addAndPlayNext(this, ws, msg.data);
        break;
      case Commands.MOVE_SINGER:
        await karaokeHandler.moveSinger(this, ws, msg.data);
        break;
      case Commands.PLAY_KARAOKE_TRACK:
        await karaokeHandler.playKaraokeTrack(this, ws, msg.data);
        break;
      case Commands.RESTART_SONG:
        await karaokeHandler.restartSong(this, ws);
        break;
      case Commands.TOGGLE_AUTO_ADVANCE:
        await karaokeHandler.toggleAutoAdvance(this, ws);
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
        await hostHandler.hostSkip(this, ws, false);
        break;
      case Commands.HOST_SKIP_FORWARD:
        await hostHandler.hostSkip(this, ws, true);
        break;
      case Commands.LOCAL_SKIP_BACK:
        this.localSkip(ws, false);
        break;
      case Commands.LOCAL_SKIP_FORWARD:
        this.localSkip(ws, true);
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
  localSkip(ws, isForward) {
    // This function relays a skip command from a UI to that user's specific player instance.
    if (ws.user_video) {
      const command = isForward ? Commands.SKIP_FORWARD : Commands.SKIP_BACK;
      this.send(ws.user_video, command);
    }
  }
  setAutoSync(autoSync, ws) {
    if(ws.user_video) {
      this.send(ws.user_video, Commands.AUTO_SYNC, autoSync);
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
    // This is now a proxy to the real logic inside the playlist handler.
    playlistHandler.updateVotes(this, instanceId);
  }
  resetPlaylist(ws) {
    this.videoPlayers[ws.i].playlist.length = 0;
    this.videoPlayers[ws.i].currentTrack = 0;
    this.videoPlayers[ws.i].currentTime = 0;
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
              await karaokeHandler.playNextKaraokeSong(this, instanceId);
            } else {
              // If auto-advance is off, or the singer list is empty, stop the player.
              await hostHandler.internalStop(this, instanceId);
            }
            break; // Exit the while loop for this instance.
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

      const player = this.videoPlayers[instanceId];

      // --- FIX for stuck takeover state on load ---
      // If an instance is loaded from the database with an absent host and takeover disabled,
      // there is no automatic trigger to re -enable it. This check fixes that.
      if (existingState && player.canTakeOver === false) {
        // We assume the host is not connected because the instance was dormant. The `hostConnected`
        // flag is already correctly `false` by default. We start  the same 42-second timer that
        // `handleClose` uses. If the host joins the space within this time, the `SET_WS_TYPE`
        // handler will correctly cancel this timeout.
        if (player.host) {
          console.log(`Instance ${instanceId} loaded with takeover disabled. Starting 42s timer for host ${player.host.name}.`);
          player.takeoverTimeout = setTimeout(async () => {
            if (!player.hostConnected) {
              console.log(`Host for ${instanceId} did not return. Enabling takeover.`);
              player.canTakeOver = true;
              this.updateClients(instanceId, 'takeover-enabled');
              await this.savePlayerState(instanceId);
            }
          }, 42 * 1000);
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