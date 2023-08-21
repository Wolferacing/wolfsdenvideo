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
  function positionItemsAroundCircle() {
    // Get all items
    const items = document.querySelectorAll('.item');
    const n = items.length;

    // Calculate the radius of the circle based on the number of items
    const radius = (n / (2 * Math.PI)) * 0.5;  // in meters
    const radiusInPixels = radius * 100;  // assuming 100 pixels per meter

    // Position the center of the circle
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    // Loop through each item to set its position
    items.forEach((item, index) => {
      const angle = (index / n) * 2 * Math.PI;  // Angle in radians

      const x = centerX + radiusInPixels * Math.cos(angle);
      const y = centerY + radiusInPixels * Math.sin(angle);

      // Convert angle to degrees and add 90 degrees to make the item face the center
      const rotation = (angle * 180 / Math.PI) + 90; 

      item.style.left = `${x}px`;
      item.style.top = `${y}px`;
      item.style.transform = `rotate(${rotation}deg)`;
    });
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
        const angle = (this.portalCount / this.totalItems);
        const angleRad = angle * 2 * Math.PI;
        const angleDeg = angle * 360;
        
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        break;
    }
    
    this.portalCount++;
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
    this.totalItems = spaces.length = spaces.length - events.length;
    this.portalCount = 0;
    events.filter(e => {
      const start = new Date(e.scheduledStartTimestamp);
      const startTime = start.getTime();
      const endTime = new Date(e.scheduledEndTimestamp).getTime();
      const isActive = startTime < Date.now();
      return isActive;
    }).forEach(e => this.setupPortal(e.location));
    spaces.forEach(e => this.setupPortal(e.space_url));
  }
}