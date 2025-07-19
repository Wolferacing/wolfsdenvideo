const Commands = require('../../public/commands.js');
const hostHandler = require('./hostHandler.js');

async function addToPlayers(app, ws, video) {
  const player = app.videoPlayers[ws.i];
  if (!player) return;

  // Prevent a user from adding themselves to the queue more than once.
  if (player.singers.some(singer => singer.user.id === ws.u.id)) {
    app.send(ws, Commands.ERROR, { message: "You are already in the singer list." });
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
  player.sockets.forEach(socket => app.send(socket, Commands.SINGER_ADDED, { player: newSingerPayload }));
  console.log(`${ws.u.name} was added to the singer list. Broadcasting SINGER_ADDED.`);
  await app.savePlayerState(ws.i);
}

async function removeFromPlayers(app, ws, uid) {
  const player = app.videoPlayers[ws.i];
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
        await hostHandler.internalStop(app, ws.i);
      }
      // Send a granular update for efficiency.
      player.sockets.forEach(socket => app.send(socket, Commands.SINGER_REMOVED, { userId: uid }));
      console.log(`Broadcasting SINGER_REMOVED for user ${uid}.`);
      await app.savePlayerState(ws.i);
    }
  } else {
    app.send(ws, Commands.ERROR);
  }
}

async function moveSinger(app, ws, { userId, direction }) {
  app.onlyIfHost(ws, async () => {
      const player = app.videoPlayers[ws.i];
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

      // Send a granular update for efficiency instead of the whole list.
      player.sockets.forEach(socket => {
        app.send(socket, Commands.SINGER_MOVED, { oldIndex, newIndex });
      });
      await app.savePlayerState(ws.i);
  });
}

/**
 * This is a helper function, so it doesn't need to be exported.
 * It was `_playNextKaraokeSong` in app.js.
 * It handles the logic of starting the next song in the karaoke queue.
 */
async function playNextKaraokeSong(app, instanceId) {
  const player = app.videoPlayers[instanceId];
  if (!player || player.singers.length === 0) return;

  const nextSinger = player.singers[0];
  const videoToPlay = nextSinger.video;
  if (!videoToPlay) return;

  // Atomically update the player state
  player.playlist = [];
  player.currentTrack = 0;
  player.currentTime = 0;
  const newVideo = app._createVideoObject(videoToPlay, nextSinger.user, 'scraper');
  player.playlist.push(newVideo);
  
  player.lastStartTime = (new Date().getTime() / 1000);
  
  // Remove the singer from the queue now that their turn has started.
  player.singers.shift();
  
  console.log(`Karaoke track started for ${nextSinger.user.name} in instance ${instanceId}`);

  const singersPayload = player.singers.map(s => ({
    name: s.user.name,
    p: s.timestamp,
    id: s.user.id,
    v: s.video
  }));

  player.sockets.forEach(socket => {
      app.send(socket, Commands.TRACK_CHANGED, {
          newTrackIndex: 0,
          newLastStartTime: player.lastStartTime,
          playlist: player.playlist,
          singers: singersPayload
      });
  });
  await app.savePlayerState(instanceId);
}

async function playKaraokeTrack(app, ws, data) {
  const player = app.videoPlayers[ws.i];
  if (!player) return;

  const isHost = player.host.id === ws.u.id;
  const singerToPlayId = data ? data.userId : null;

  if (singerToPlayId) {
    // A specific singer was requested. Only the host can do this.
    if (!isHost) {
      app.send(ws, Commands.ERROR, { message: "Only the host can play a specific singer." });
      return;
    }

    const singerIndex = player.singers.findIndex(s => s.user.id === singerToPlayId);
    if (singerIndex === -1) {
      app.send(ws, Commands.ERROR, { message: "Singer not found." });
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
        app.send(ws, Commands.ERROR, { message: "Only the host or the current singer can start the song." });
        return;
    }
  }
  // Now that the correct singer is at the front, play the song.
  await playNextKaraokeSong(app, ws.i);
}

async function restartSong(app, ws) {
  const player = app.videoPlayers[ws.i];
  if (!player || !player.playlist.length) return;

  const currentVideo = player.playlist[player.currentTrack];
  const isHost = player.host.id === ws.u.id;
  const isCurrentSinger = currentVideo.user.id === ws.u.id;

  if (isHost || isCurrentSinger) {
    player.lastStartTime = (new Date().getTime() / 1000);
    player.currentTime = 0;

    player.sockets.forEach(socket => {
      app.send(socket, Commands.TRACK_CHANGED, { newTrackIndex: player.currentTrack, newLastStartTime: player.lastStartTime, newCurrentTime: 0 });
    });
    await app.savePlayerState(ws.i);
  }
}

async function toggleAutoAdvance(app, ws) {
  app.onlyIfHost(ws, async () => {
    const player = app.videoPlayers[ws.i];
    player.autoAdvance = !player.autoAdvance;
    // Send a specific, granular message instead of a full playback update.
    // This ensures the client UI updates correctly without needing a full state refresh.
    player.sockets.forEach(socket => {
      app.send(socket, Commands.AUTO_ADVANCE_STATE_CHANGED, { autoAdvance: player.autoAdvance });
    });
    await app.savePlayerState(ws.i);
  });
}

module.exports = {
    addToPlayers,
    removeFromPlayers,
    moveSinger,
    playKaraokeTrack,
    restartSong,
    toggleAutoAdvance,
    playNextKaraokeSong
};