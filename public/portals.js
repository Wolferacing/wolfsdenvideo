class Portals {
  constructor() {
    if(window.isBanter) {
      this.parseParams();
      setInterval(() => this.tick(), 60 * 1000);
      this.tick();
    }
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
  async tick() {
    
    const parent = document.querySelector('#portalParent');
    
    if(!parent) {
      parent = document.createElement('a-entity');
      
    }
    
    const spaces = await fetch('https://api.sidequestvr.com/v2/communities?is_verified=true&has_space=true&sortOn=user_count,name&descending=true,false&limit=5');
    const events = await fetch('https://api.sidequestvr.com/v2/events/banter');
    
    events.filter(e => {
      const start = new Date(e.scheduledStartTimestamp);
      const startTime = start.getTime();
      const endTime = new Date(e.scheduledEndTimestamp).getTime();
      const isActive = startTime < Date.now();
      return isActive;
    }).forEach(e => {
      
    });
  }
}