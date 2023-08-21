class Portals {
  constructor() {
    this.parseParams();
  }
  parseParams(currentScript) {
    this.currentScript = currentScript;
    this.setOrDefault("space-limit", "5");
    this.setOrDefault("show-events", "true");
    this.setOrDefault("shape", "line"); // or circle or spiral
    this.setOrDefault("spacing", "0.5"); // does nothing on circle
  }
  setOrDefault(attr, defaultValue) {
    const value = this.currentScript.getAttribute(attr);
    this.params = this.params || {};
    this.params[attr] = value || (this.urlParams.has(attr) ? this.urlParams.get(attr) : defaultValue);
  }
}
(async ()=>{
  if(window.isBanter) {
    const now = Date.now();
    const spaces = await fetch('https://api.sidequestvr.com/v2/communities?is_verified=true&has_space=true&sortOn=user_count,name&descending=true,false&limit=5');
    
    const events = await fetch('https://api.sidequestvr.com/v2/events/banter');
    
    /*
        const start = new Date(space.scheduledStartTimestamp);
        const startTime = start.getTime();
        const endTime = new Date(space.scheduledEndTimestamp).getTime();
        const isActive = startTime < Date.now();
    */
  }
})();