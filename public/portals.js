class Portals {
  constructor() {
    this.init();
  }
  async init() {
    if(window.isBanter) {
      await window.AframeInjection.waitFor(window, 'user');
      await window.AframeInjection.waitFor(window, 'AFRAME');
      await window.AframeInjection.waitFor(window.AFRAME.scenes, 0);
      this.sceneParent = window.AFRAME.scenes[0];
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
    this.setOrDefault("position", "0 0 0");
    this.setOrDefault("rotation", "0 0 0");
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
      parent.setAttribute('position', this.params.position);
      parent.setAttribute('rotation', this.params.rotation);
      this.sceneParent.appendChild(parent);
    }
    Array.from(parent.children).forEach(c => parent.removeChild(c));
    const spaces = await fetch('https://api.sidequestvr.com/v2/communities?is_verified=true&has_space=true&sortOn=user_count,name&descending=true,false&limit=' + this.params["space-limit"]);
    const events = await fetch('https://api.sidequestvr.com/v2/events/banter');
    events.length = events.length < 5 ? events.length : 5;
    spaces.length = spaces.length - events.length;
    let portalCount = 0;
    events.filter(e => {
      const start = new Date(e.scheduledStartTimestamp);
      const startTime = start.getTime();
      const endTime = new Date(e.scheduledEndTimestamp).getTime();
      const isActive = startTime < Date.now();
      return isActive;
    }).forEach(e => {
      const portal = document.createElement('a-link');
      portal.setAttribute('href', e.location);
      portal.setAttribute('position', (portalCount * this.params.spacing) + ' 0 0');
      portalCount++;
    });
    spaces.forEach(s => {
      const portal = document.createElement('a-link');
      portal.setAttribute('href', s.space_url);
      portal.setAttribute('position', (portalCount * this.params.spacing) + ' 0 0');
      portalCount++;
    });
  }
}