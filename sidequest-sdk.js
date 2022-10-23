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
   schema: {
    panoId: {type: 'string', default: 'EusXB0g8G1DOvaPV56X51g'}
  },
  update: function (oldData) {
    const mesh = this.el.object3D;
    if(mesh){
       mesh.userData.streetView = this.data.panoId; 
      console.log(this.el.object3D);
    }
  }
});


AFRAME.registerComponent('sq-customhome', {
   schema: {
    customHome: {type: 'string', default: 'https://cdn.sidequestvr.com/file/167634/matrix_loading_void_environment.apk'}
  },
  update: function (oldData) {
    const mesh = this.el.object3D;
    if(mesh){
       mesh.userData.customHome = this.data.customHome; 
      console.log(this.el.object3D);
    }
  }
});