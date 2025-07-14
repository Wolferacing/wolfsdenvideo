var Playlist = class {
  constructor() {
    this.currentScript = document.currentScript;
    this.uiUpdateInterval = null;
    this.pendingReplacement = null;
    this.init();
  }
  async init() {
    await this.setupConfigScript();
    await this.setupCoreScript();
    this.core = window.videoPlayerCore;
    this.core.hostUrl = window.APP_CONFIG.HOST_URL;
    this.core.parseParams(this.currentScript);
    await this.core.setupCommandsScript(); // Load Commands before UI setup and core.init
    this.setupPlaylistUI();
    await this.core.init();
    await this.core.setupWebsocket("playlist", d => this.parseMessage(d), () => {
      this.core.sendMessage({path: "instance", data: this.core.params.instance, u: window.user});
    }, ()=>{
        this.core.showToast("Reconnecting...");
    });
  }
  playPlaylist(shouldClear) {
    this.core.sendMessage({path: Commands.FROM_PLAYLIST, data: {id: this.playlistId || this.core.params.playlist, shouldClear, fromPlaylist: true}});
    this.playlistId = null;
  }
  clearPlaylist() {
    this.core.sendMessage({path: Commands.CLEAR_PLAYLIST});
  }
  parseMessage(msg) {
    const json = JSON.parse(msg);
    switch(json.path) {
      case Commands.PLAYBACK_UPDATE:
        // Merge new data into the existing player state.
        // This prevents the playlist from being wiped out on updates that don't include it.
        this.core.player = Object.assign(this.core.player || {}, json.data.video);
        this.updatePlaylist(this.core.player);
        this.startUiUpdater();
        break;
      case Commands.SEARCH_RESULTS:
        this.loadVideos(json.data);
        break;
      case Commands.ERROR:
        alert("I cant let you do that...");
        break;
      case Commands.LOCK_STATE_CHANGED:
        if (this.core.player) {
          this.core.player.locked = json.data.locked;
          // Re-render the UI with the new lock state
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.CAN_TAKE_OVER_STATE_CHANGED:
        if (this.core.player) {
          this.core.player.canTakeOver = json.data.canTakeOver;
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.HOST_CHANGED:
        if (this.core.player) {
          this.core.player.host = json.data.host;
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.VOTING_STATE_CHANGED:
        if (this.core.player) {
          this.core.player.canVote = json.data.canVote;
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.AUTO_SYNC_STATE_CHANGED:
        this.autoSyncEnabled = json.data.enabled;
        this.autoSync.innerText = this.autoSyncEnabled ? "Auto Sync: On" : "Auto Sync: Off";
        break;
      case Commands.PLAYLIST_UPDATED:
        if (this.core.player) {
          this.core.player.playlist = json.data.playlist;
          this.core.player.currentTrack = json.data.currentTrack;
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.ITEM_REMOVED:
        if (this.core.player && this.core.player.playlist) {
          // Update local state based on the granular message
          this.core.player.playlist.splice(json.data.index, 1);
          this.core.player.currentTrack = json.data.newCurrentTrack;
          // Re-render the UI with the new state
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.ITEM_APPENDED:
        if (this.core.player && this.core.player.playlist) {
          this.core.player.playlist.push(json.data.video);
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.ITEM_INSERTED:
        if (this.core.player && this.core.player.playlist) {
          // Insert the new video at the specified index.
          this.core.player.playlist.splice(json.data.index, 0, json.data.video);
          // The currentTrack index does not change when inserting an item after it.
          this.updatePlaylist(this.core.player);
        }
        break;
      case Commands.TRACK_CHANGED:
        if (this.core.player) {
          // If the message includes a new playlist (e.g., from add-and-play), update it.
          if (json.data.playlist) {
            this.core.player.playlist = json.data.playlist;
          }
          this.core.player.currentTrack = json.data.newTrackIndex;
          this.core.player.lastStartTime = json.data.newLastStartTime;
          // The playlist UI also needs the duration of the new track for the progress bar.
          if (this.core.player.playlist[this.core.player.currentTrack]) {
              this.core.player.duration = this.core.player.playlist[this.core.player.currentTrack].duration / 1000;
          }
          this.updatePlaylist(this.core.player);
          this.startUiUpdater(); // Restart the progress bar timer
        }
        break;
      case Commands.HOST_SEEK:
        if (this.core.player) {
          this.core.player.lastStartTime = json.data.newLastStartTime;
          this.core.player.currentTime = json.data.newCurrentTime;
          // The UI updater will pick up the new lastStartTime on its next interval.
          // To make the change immediate, we can manually update the relevant elements.
          const currentTimeBar = document.querySelector('.currentTime');
          if (currentTimeBar && this.core.player.duration > 0) {
            currentTimeBar.style.width = `${(this.core.player.currentTime / this.core.player.duration) * 100}%`;
          }
          const currentTimeText = document.querySelector('.currentTimeText');
          if (currentTimeText) {
            currentTimeText.innerText = `${this.timeCode(this.core.player.currentTime)} / ${this.timeCode(this.core.player.duration)}`;
          }
        }
        break;
      case Commands.SHOW_REPLACE_PROMPT:
        // By cloning the alternative video object, we prevent it from being accidentally
        // mutated if the same video appears in a later search result. This is a defensive
        // measure to ensure the object we send back to the server is pristine.
        this.pendingReplacement = {
          original: json.data.original,
          alternative: JSON.parse(JSON.stringify(json.data.alternative))
        };
        const { original, alternative } = this.pendingReplacement;

        this.notificationArea.textContent = `A user can't watch: "${original.title}". Suggested replacement: "${alternative.title}".`;
        this.notificationArea.style.display = 'block';

        this.replaceConfirmButton.style.display = 'inline-block';
        this.replaceDismissButton.style.display = 'inline-block';

        this.replaceConfirmButton.onclick = () => {
          this.core.sendMessage({
            path: Commands.REPLACE_VIDEO,
            data: { originalLink: this.pendingReplacement.original.link, alternativeVideo: this.pendingReplacement.alternative }
          });
          this.hideReplacePrompt();
        };
        break;
    }
  }
  startUiUpdater() {
    // Clear any existing interval to prevent multiple loops running
    if (this.uiUpdateInterval) {
      clearInterval(this.uiUpdateInterval);
    }

    // Only start a new interval if we have a valid player state with a playlist
    if (!this.core.player || !this.core.player.playlist || this.core.player.playlist.length === 0 || !this.core.player.lastStartTime) {
      return;
    }

    this.uiUpdateInterval = setInterval(() => {
      const { lastStartTime, duration } = this.core.player;

      if (duration <= 0) return;

      // Calculate the current time based on when the track started
      let calculatedTime = (Date.now() / 1000) - lastStartTime;

      // Clamp the time to be within the video's bounds [0, duration]
      calculatedTime = Math.max(0, Math.min(calculatedTime, duration));

      const currentTimeBar = document.querySelector('.currentTime');
      if (currentTimeBar) {
        currentTimeBar.style.width = `${(calculatedTime / duration) * 100}%`;
      }
      const currentTimeText = document.querySelector('.currentTimeText');
      if (currentTimeText) {
        currentTimeText.innerText = `${this.timeCode(calculatedTime)} / ${this.timeCode(duration)}`;
      }
    }, 1000); // Update every second
  }
  setupCoreScript() {
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", `https://${window.APP_CONFIG.HOST_URL}/core.js`);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);
    });
  }
  setupConfigScript() {
    // Use the script's own src attribute to reliably find the config file.
    const scriptUrl = new URL(this.currentScript.src);
    const configUrl = `${scriptUrl.origin}/config.js`;
    return new Promise(resolve => {
      let myScript = document.createElement("script");
      myScript.setAttribute("src", configUrl);
      myScript.addEventListener ("load", resolve, false);
      document.body.appendChild(myScript);
    });
  }
  search(data) {
    this.core.sendMessage({path: Commands.SEARCH, data });
  }
  updatePlaylist(player) {
    const isMe = player.host.id === window.user.id;
    this.lockPlayer.innerText = player.locked ? 'Unlock' : 'Lock';
    this.lockPlayer.className = player.locked ? 'button teal' : 'button red';
    this.lockPlayer.style.display = !isMe ? 'none' : 'inline-block';
    this.clearPlaylistButton.style.display = !isMe ? 'none' :  'inline-block';
    this.loadDefaultPlaylistButton.style.display = (isMe && player.playlist.length === 0 && this.core.params.playlist) ? 'inline-block' : 'none';
    this.addPlaylist.style.display = !isMe ? 'none' :  'inline-block';
    this.takeOver.style.display = (player.canTakeOver || isMe) ? 'inline-block' : 'none';
    this.takeOver.innerText = player.canTakeOver ? (isMe ? 'Take Over: On' : 'Take Over') : 'Take Over: Off';
    this.takeOver.className = player.canTakeOver ? (isMe ? 'button red' : 'button teal') : 'button teal';
    this.voting.style.display = !isMe ? 'none' : 'inline-block';
    this.voting.innerText = player.canVote ? 'Voting: On' : 'Voting: Off';
    this.autoSync.style.display = 'inline-block';
    if (!this.pendingReplacement) {
      this.replaceConfirmButton.style.display = 'none';
      this.replaceDismissButton.style.display = 'none';
    }

    // --- Securely build the host title ---
    this.hostTitle.innerHTML = ''; // Clear previous content

    const welcomeSpan = document.createElement('span');
    welcomeSpan.textContent = `Welcome ${window.user.name}. ${isMe ? 'You are' : `${player.host.name} is`} the host`;
    this.hostTitle.appendChild(welcomeSpan);

    // Programmatically create elements instead of using innerHTML for better security.
    if (player.canTakeOver) {
      const takeoverSpan = document.createElement('span');
      takeoverSpan.append(' but it can be taken over ( click '); // .append() can mix text and elements

      if (isMe) {
        takeoverSpan.append('again to disable');
      } else {
        const takeoverActionSpan = document.createElement('span');
        takeoverActionSpan.style.color = 'red';
        takeoverActionSpan.textContent = 'to take over ASAP!!!';
        takeoverSpan.appendChild(takeoverActionSpan);
      }
      takeoverSpan.append(' )!');
      this.hostTitle.appendChild(takeoverSpan);
    } else {
      const statusSpan = document.createElement('span');
      statusSpan.textContent = player.locked ? " and it's locked!" : ".";
      this.hostTitle.appendChild(statusSpan);
    }
    // --- End of secure host title build ---

    this.videoPlaylistContainer.innerHTML = ''; // Clear the existing list before re-rendering
    player.playlist.forEach((v, i) => {
      const videoItemContainer = this.core.makeAndAddElement('div', {background: player.currentTrack === i ? '#4f4f4f' : i % 2 === 0 ? '#8f8f8f' : '#9f9f9f'}, this.videoPlaylistContainer);
      
      // --- FIX for thumbnail alignment ---
      // Create a content wrapper and use flexbox to vertically center the thumbnail and the info panel.
      const contentWrapper = this.core.makeAndAddElement('div', {
        display: 'flex',
        alignItems: 'center', // This is the key to vertical alignment
        padding: '1px'
      }, videoItemContainer);
      
      const videoThumbnail = this.core.makeAndAddElement('img',{height: '80px', width: '142px', flexShrink: '0'}, contentWrapper);
      const videoTitleAndAction = this.core.makeAndAddElement('div',{flexGrow: '1', paddingLeft: '10px'}, contentWrapper);
      
      const videoTitle = this.core.makeAndAddElement('div',{
        padding: '7 10 10 7', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        whiteSpace: 'nowrap'
      }, videoTitleAndAction);
      
      videoThumbnail.src = v.thumbnail;
      
      // Build the title safely to prevent HTML injection
      videoTitle.innerHTML = ''; // Clear it first
      if (player.canVote && player.currentTrack !== i) {
        const voteBold = document.createElement('b');
        voteBold.textContent = `(${player.playlist[i].votes})`;
        videoTitle.appendChild(voteBold);
        videoTitle.append(' ');
      }
      videoTitle.append(v.title);

      const videoAuthor = this.core.makeAndAddElement('div',{
        padding: '0 10 5 7', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        fontSize: '0.8rem',
        color: '#cfcfcf',
        float: 'right',
        whiteSpace: 'nowrap'
      }, videoTitle);

      videoAuthor.className = "currentTimeAuthor";
      videoAuthor.innerText = "Added By: " + (v.user ? v.user.name : 'Unknown');
      
      if(player.currentTrack !== i) {
        if(isMe) {
          if(isMe || (!player.locked && !player.canVote)) {
            const playTrack = this.core.makeAndAddElement('div',null, videoTitleAndAction);

            playTrack.className = 'button slim green';
            playTrack.innerText = "Play Now.";

            playTrack.addEventListener('click', () => {
              this.core.sendMessage({path: Commands.SET_TRACK, data: i });
            });          
          };    
        };
        if(player.canVote) {
          const voteDown = this.core.makeAndAddElement('div',null, videoTitleAndAction);

          voteDown.className = 'button slim teal';
          voteDown.innerText = "Down Vote";

          voteDown.addEventListener('click', () => {
            this.core.sendMessage({path: Commands.DOWN_VOTE, data: v.link });
          });

          const voteUp = this.core.makeAndAddElement('div',null, videoTitleAndAction);
          voteUp.className = 'button slim teal';
          voteUp.innerText = "Up Vote";

          voteUp.addEventListener('click', () => {
            this.core.sendMessage({path: Commands.UP_VOTE, data: v.link });
          });
        }else{
          if(this.core.player.host.id === window.user.id) {
            const moveDown = this.core.makeAndAddElement('div',null, videoTitleAndAction);

            moveDown.className = 'button slim teal';
            moveDown.innerText = "Move Down";

            moveDown.addEventListener('click', () => {
              this.core.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: i + 1}  });
            });

            const moveUp = this.core.makeAndAddElement('div',null, videoTitleAndAction);
            moveUp.className = 'button slim teal';
            moveUp.innerText = "Move Up";

            moveUp.addEventListener('click', () => {
              this.core.sendMessage({path: Commands.MOVE_PLAYLIST_ITEM, data: {url: v.link , index: i - 1} });
            });
            if(isMe || (!player.locked && !player.canVote)) {
              const remove = this.core.makeAndAddElement('div',null, videoTitleAndAction);

              remove.className = 'button slim red';
              remove.innerText = "Remove";

              remove.addEventListener('click', () => {
                this.core.sendMessage({path: Commands.REMOVE_PLAYLIST_ITEM, data: i });
              });         
            };    
          };
        };
      }else{
        
        const currentTimeText = this.core.makeAndAddElement('div',{
          padding: '7 10 0 7', 
          textOverflow: 'ellipsis', 
          overflow: 'hidden', 
          whiteSpace: 'nowrap'
        }, videoTitleAndAction);
        
        currentTimeText.className = "currentTimeText";
        currentTimeText.innerText = this.timeCode(player.currentTime) + " / " + this.timeCode(player.duration);
      }
        
      // The 'clear: both' div is no longer needed with the flexbox layout.
      // this.core.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
      
      if(player.currentTrack === i) {
        const currentTime = this.core.makeAndAddElement('div', {
          height: '4px', 
          width: '100%',
        }, videoItemContainer);
        const currentTimeInner = this.core.makeAndAddElement('div', {
          height: '4px', 
          background: 'red',
          transition: 'width 1s',
          transitionTimingFunction: 'linear',
          width: ((player.currentTime / player.duration) * 100) + "%",
        }, currentTime);
        
        currentTimeInner.className = "currentTime";
      }
    })
  }
  timeCode(seconds) {
    return new Date(seconds * 1000).toISOString().substring(11, 19);
  }
  loadVideos(videos) {
    this.videoSearchContainer.innerHTML = '';
    this.loadingSpinner.style.display = 'none';
    videos.forEach((v, i) => {
      const videoItemContainer = this.core.makeAndAddElement('div', {background: i % 2 === 0 ? '#8f8f8f' : '#9f9f9f'}, this.videoSearchContainer);
      
      const videoThumbnail = this.core.makeAndAddElement('img',{height: '80px', width: '142px', float: 'left'}, videoItemContainer);
      
      const videoTitleAndAction = this.core.makeAndAddElement('div',{float: 'left', width: 'calc(100% - 180px)'}, videoItemContainer);
      
      const videoTitle = this.core.makeAndAddElement('div',{
        padding: '7 10', 
        textOverflow: 'ellipsis', 
        overflow: 'hidden', 
        whiteSpace: 'nowrap'
      }, videoTitleAndAction);
      
      const addToPlaylist = this.core.makeAndAddElement('div',null, videoTitleAndAction);
      
      addToPlaylist.className = 'button slim teal';
      addToPlaylist.innerText = "Add To Playlist";
      
      addToPlaylist.addEventListener('click', async () => {
        this.core.sendMessage({path: Commands.ADD_TO_PLAYLIST, data: v });
      }); 
      
      if(this.core.player && this.core.player.host.id === window.user.id) {
        const playNow = this.core.makeAndAddElement('div',null, videoTitleAndAction);

        playNow.className = 'button slim teal';
        playNow.innerText = "Play Now";

        playNow.addEventListener('click', () => {
          this.hideSearch();
          this.core.sendMessage({path: Commands.ADD_AND_PLAY, data: v });
        }); 

        const playNext = this.core.makeAndAddElement('div',null, videoTitleAndAction);

        playNext.className = 'button slim teal';
        playNext.innerText = "Play Next";

        playNext.addEventListener('click', () => {
          this.hideSearch();
          this.core.sendMessage({path: Commands.ADD_AND_PLAY_NEXT, data: v });
        }); 
      }
      
      this.core.makeAndAddElement('div',{clear: 'both'}, videoItemContainer);
      
      videoThumbnail.src = v.thumbnail;
        
      videoTitle.innerText = v.title;
    })
  }
  debounceSearch(searchVal) {
    if(searchVal.length > 1) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => this.search(searchVal), 500);
      this.videoSearchContainer.style.display = 'block';
      this.searchBackDrop.style.display = 'block';
      this.loadingSpinner.style.display = 'block';
    }else{
      this.hideSearch();
    }
  }
  hideSearch() {
    this.videoSearchContainer.style.display = 'none';
    this.videoSearchContainer.innerHTML = '';
    this.searchBackDrop.style.display = 'none';
  }
  hideAddItem() {
      this.addItemContainer.style.display = 'none';
      this.addItemBackDrop.style.display = 'none';
  }
  hideReplacePrompt() {
    this.pendingReplacement = null;
    this.notificationArea.style.display = 'none';
    this.notificationArea.textContent = '';
    this.replaceConfirmButton.style.display = 'none';
    this.replaceDismissButton.style.display = 'none';
    this.replaceConfirmButton.onclick = null; // Clean up listener
  }
  setupNotificationArea() {
    this.notificationArea = document.querySelector('#playlist-notifications');
  }
  setupPlaylistUI() {
    
    this.searchInput = document.querySelector('.searchInput');
    this.searchInput.addEventListener('keyup', () => this.debounceSearch(this.searchInput.value))
    
    this.voting = document.querySelector('#voting');
    
    this.voting.addEventListener('click', () => this.core.sendMessage({path: Commands.TOGGLE_VOTE }));
    
    this.videoPlaylistContainer = document.querySelector('.videoPlaylistContainer');
    
    this.searchBackDrop = document.querySelector('.searchBackDrop');
      
    this.searchBackDrop.addEventListener('click', () => this.hideSearch());
    
    this.videoSearchContainer = document.querySelector('.videoSearchContainer');
    
    this.loadingSpinner = document.querySelector('.loadingSpinner');
    
    // Set the spinner's src from the config
    this.loadingSpinner.src = `https://${window.APP_CONFIG.HOST_URL}/assets/3-dots-move.svg`;
    
    this.lockPlayer = document.querySelector('#lockPlayer');
    
    // --- FIX for button overflow ---
    // By applying flexbox with wrapping to the container of the top-row buttons,
    // we ensure they stack vertically on smaller screens instead of overflowing.
    if (this.lockPlayer && this.lockPlayer.parentNode) {
      const buttonContainer = this.lockPlayer.parentNode;
      Object.assign(buttonContainer.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '5px', // Adds a small space between buttons
        paddingBottom: '10px' // Ensures space below the buttons if they wrap
      });
    }
    // --- End of FIX ---
    
    this.lockPlayer.addEventListener('click', () => {
        this.core.sendMessage({ path: Commands.TOGGLE_LOCK, data: !this.core.player.locked });
    });
    
    this.takeOver = document.querySelector('#takeOver');
    
    this.takeOver.addEventListener('click', () => {
        if(this.core.player && this.core.player.host.id === window.user.id) {
          this.core.sendMessage({ path: Commands.TOGGLE_CAN_TAKE_OVER, data: !this.core.player.canTakeOver });
        }else{
          this.core.sendMessage({ path: Commands.TAKE_OVER });
        }
    });
    
    this.clearPlaylistButton = document.querySelector('#clearPlaylist');
    
    this.clearPlaylistButton.addEventListener('click', () => this.clearPlaylist());
    
    this.autoSync = document.querySelector('#autoSync');
    
    this.autoSyncEnabled = false;
    
    this.autoSync.addEventListener('click', () => {
      this.autoSyncEnabled = !this.autoSyncEnabled;
      this.autoSync.innerText = this.autoSyncEnabled ? "Auto Sync: On" : "Auto Sync: Off";
      this.core.sendMessage({ path: Commands.AUTO_SYNC, data: this.autoSyncEnabled});
    });
    
    this.addItemContainer = document.querySelector('.addItemContainer');
    
    this.addItemBackDrop = document.querySelector('.addItemBackDrop');
      
    this.addItemBackDrop.addEventListener('click', () => this.hideAddItem());
    
    this.addItemTitle = document.querySelector('.addItemTitle');
    
    this.addItemInput = document.querySelector('#addItemInput');
    
    this.addItemSubmit = document.querySelector('#addItemSubmit');
    
    this.addPlaylist = document.querySelector('#addPlaylist');
    
    this.addPlaylist.addEventListener('click', () => {
      this.addItemContainer.style.display = 'block';
      this.addItemBackDrop.style.display = 'block';
      if(this.addPlaylistHandler) {
        this.addItemSubmit.removeEventListener('click', this.addPlaylistHandler);
      }
      this.addPlaylistHandler = () => {
        this.playlistId = this.addItemInput.value;
        this.playPlaylist(true);
        this.hideAddItem();
      };
      this.addItemSubmit.addEventListener('click', this.addPlaylistHandler);
    });
    
    this.loadDefaultPlaylistButton = document.querySelector('#loadDefaultPlaylist');
    
    this.loadDefaultPlaylistButton.addEventListener('click', () => {
      // Set the playlistId from the core parameters, which are read from the URL.
      this.playlistId = this.core.params.playlist;
      this.playPlaylist(true); // `true` to clear the existing playlist
    });
    
    this.hostTitle = document.querySelector('.hostTitle');

    // --- Replace Video Prompt ---
    this.notificationArea = document.querySelector('#playlist-notifications');
    this.replaceConfirmButton = document.querySelector('#replaceConfirm');
    this.replaceDismissButton = document.querySelector('#replaceDismiss');
    this.replaceDismissButton.addEventListener('click', () => this.hideReplacePrompt());

    // --- FIX for dynamically created buttons ---
    // Instead of applying styles to existing elements, we inject a style rule
    // into the document head. This ensures that any element with the '.teal' class,
    // including ones created later like the move up/down buttons, will get the style.
    const style = document.createElement('style');
    style.innerHTML = `.teal { background: url(https://${window.APP_CONFIG.HOST_URL}/assets/Button_bg.png); background-size: 100% 100%; }`;
    document.head.appendChild(style);
    // --- End of FIX ---
  }
}
window.playlistUiInstance = new Playlist();