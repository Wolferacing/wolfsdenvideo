['climbable', 'collider', 'sticky', 'slippery'].forEach(d=>{
  AFRAME.registerComponent('sq-' + d, {
    update: function (oldData) {
      const mesh = this.el.getObject3D('mesh')
      if(mesh){
        mesh.userData[d] = true;
      // console.log(this.el.object3D);
      }
    }
  });
});

AFRAME.registerComponent('sq-streetview', {
  update: function (oldData) {
    const mesh = this.el.object3D;
    if(mesh){
       mesh.userData.streetView = this.data; 
      console.log(this.el.object3D);
    }
  }
});