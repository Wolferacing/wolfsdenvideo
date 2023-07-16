class Playlist {
  constructor() {
    this.hostUrl = location.host;
    this.parseAttributes();
  }
  parseAttributes() {
    console.log(window.currentScript);
  }
}

require(['polyfills', 'commands', 'responses' ], function(data) {
    new Playlist();
});
