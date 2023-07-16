class Playlist {
  constructor() {
    this.hostUrl = 'sq-video-player.glitch.me';
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.setupScripts(() => this.parseAttributes());
  }
  setupScripts(callback) {
    let myScript = document.createElement("script");
    myScript.setAttribute("src", `https://${this.hostUrl}/core.js`);
    myScript.addEventListener ("load", callback, false);
    document.body.appendChild(myScript);  
  }
  parseAttributes() {
    this.setOrDefault()
    console.log(this.currentScript.getAttribute("position"));
  }
}
new Playlist();
// require(['polyfills', 'commands', 'responses' ], function(data) {
//     new Playlist();
// });
