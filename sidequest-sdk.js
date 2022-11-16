['climbable', 'collider', 'invertedcollider', 'sticky', 'slippery'].forEach(d => {
    AFRAME.registerComponent('sq-' + d, {
        update: function (oldData) {
            const mesh = this.el.getObject3D('mesh')
            if(mesh){
                mesh.userData[d] = true;
            }
        }
    });
});

['hideavatars', 'hidedefaulttextures'].forEach(d => {
    AFRAME.registerComponent('sq-' + d, {
        update: function (oldData) {
            const mesh = this.el.object3D;
            if(mesh){
                mesh.userData[d] = true;
            }
        }
    });
});

['lefthand', 'righthand', 'head' ].forEach(d => {
  AFRAME.registerComponent('sq-' + d, {
        schema: {
            positionOffset: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
            rotationOffset: {type: 'vec4', default: {x: 0, y: 0, z: 0, w: 0}},
            scaleOffset: {type: 'vec3', default: {x: 1, y: 1, z: 1}},
        },
        update: function (oldData) {
            const mesh = this.el.getObject3D('mesh')
            if(mesh){
                mesh.userData[d] = {
                  enabled: true, 
                  position: this.data.positionOffset,
                  rotation: this.data.rotationOffset,
                  scale: this.data.scaleOffset,
                };
            }
        }
    });
})

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

// Deprecated
AFRAME.registerComponent('sq-customhome', {
    schema: {
        customHome: {type: 'string', default: 'https://cdn.sidequestvr.com/file/167567/canyon_environment.apk'}
    },
    update: function (oldData) {
        const mesh = this.el.object3D;
        if(mesh){
            mesh.userData.customHome = this.data.customHome; 
            console.log(this.el.object3D);
        }
    }
});

AFRAME.registerComponent('sq-questhome', {
    schema: {
        url: {type: 'string', default: 'https://cdn.sidequestvr.com/file/167567/canyon_environment.apk'}
    },
    update: function (oldData) {
        const mesh = this.el.object3D;
        if(mesh){
            mesh.userData.customHome = this.data.url; 
            console.log(this.el.object3D);
        }
    }
});

AFRAME.registerComponent('sq-syncloop',{
  schema: {
      interval: {type: 'number', default: 0}
  },
  tick: function() {
      if(this.data.secondsOffset) {
        let nowInMs = new Date().getTime();
        let timeSinceLast = nowInMs / 1000 - Math.floor( nowInMs / 5000) * this.data.secondsOffset;
        if(timeSinceLast > this.data.secondsOffset - 1 && !this.readyToTrigger) {
          this.readyToTrigger = true;
        }
        if(timeSinceLast < 1 && this.readyToTrigger) {
          this.readyToTrigger = false;
          this.el.emit('startAnimation', null, false);
        }
      }
  }
});












