class Portals {
  constructor() {
    this.currentScript = Array.from(document.getElementsByTagName('script')).slice(-1)[0];
    this.urlParams = new URLSearchParams(window.location.search);
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
  parseParams() {
    this.setOrDefault("space-limit", "5");
    this.setOrDefault("show-events", "true");
    this.setOrDefault("shape", "line");
    this.setOrDefault("spacing", "0.5");
    this.setOrDefault("position", "0 0 0");
    this.setOrDefault("rotation", "0 0 0");
  }
  setOrDefault(attr, defaultValue) {
    const value = this.currentScript.getAttribute(attr);
    this.params = this.params || {};
    this.params[attr] = value || (this.urlParams.has(attr) ? this.urlParams.get(attr) : defaultValue);
  }
  setupPortal(url) {
    const portal = document.createElement('a-link');
    portal.setAttribute('href', url);
    switch(this.params.shape) {
      case "line":
        portal.setAttribute('position', (this.portalCount * this.params.spacing) + ' 0 0');
        break;
      case "circle":
        const radius = (this.totalItems / (2 * Math.PI)) * this.params.spacing;
        if(radius > 2) {
          radius = 2;
        }
        const angle = (this.portalCount / this.totalItems) * 2 * Math.PI;
        const rotation = (angle * 180 / Math.PI); 
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        portal.setAttribute('position', `${x} 0 ${y}`);
        portal.setAttribute('rotation', `0 ${rotation + 90} 0`);
        break;
      case "spiral":
        const spiralAngle = this.portalCount * 0.1 * Math.PI;
        const spiralRotation = (spiralAngle * 180 / Math.PI); 
        const spiralRadius = this.distanceFromCenter;
        const spiralX = spiralRadius * Math.cos(spiralAngle);
        const spiralY = spiralRadius * Math.sin(spiralAngle);
        portal.setAttribute('position', `${spiralX} 0 ${spiralY}`);
        portal.setAttribute('rotation', `0 ${spiralRotation + 90} 0`);
        this.distanceFromCenter += this.params.spacing / Math.sqrt(1 + Math.pow(spiralAngle, 2));
        break;
    }
    this.portalCount++;
    return portal;
  }
  async tick() {
    let parent = document.querySelector('#portalParent');
    if(!parent) {
      parent = document.createElement('a-entity');
      parent.setAttribute('position', this.params.position);
      parent.setAttribute('rotation', this.params.rotation);
      this.sceneParent.appendChild(parent);
    }
    Array.from(parent.children).forEach(c => parent.removeChild(c));
    const spaces = await fetch('https://api.sidequestvr.com/v2/communities?is_verified=true&has_space=true&sortOn=user_count,name&descending=true,false&limit=' + this.params["space-limit"]).then(r=>r.json());
    const events = this.params['show-events'] === 'false' ? [] : await fetch('https://api.sidequestvr.com/v2/events/banter').then(r=>r.json());
    events.length = events.length < 5 ? events.length : 5;
    this.totalItems = spaces.length = spaces.length - events.length;
    this.portalCount = 0;
    this.distanceFromCenter = 0;
    events.filter(e => {
      const start = new Date(e.scheduledStartTimestamp);
      const startTime = start.getTime();
      const endTime = new Date(e.scheduledEndTimestamp).getTime();
      const isActive = startTime < Date.now();
      return isActive;
    }).forEach(e => parent.appendChild(this.setupPortal(e.location)));
    
    
    spaces.forEach(e => parent.appendChild(this.setupPortal(e.space_url)));
  }
}
new Portals();