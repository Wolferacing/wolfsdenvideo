['climbable', 'collider', 'invertedcollider', 'triggercollider', 'nonconvexcollider', 'sticky', 'clickable', 'interactable'].forEach(d => {
    AFRAME.registerComponent('sq-' + d, {
        update: function (oldData) {
            const mesh = this.el.getObject3D('mesh')
            if(mesh){
                mesh.userData[d] = true;
            }
        }
    });
});
AFRAME.registerComponent('sq-rigidbody', {
    schema:{
        angularDrag: {type: 'number', default: 0.05},
        angularVelocity: {type: 'vec3', default: {x: 0, y:0, z:0}},
        centerOfMass: {type: 'vec3', default: {x: 0, y:0, z:0}},
        drag: {type: 'number', default: 0},
        isKinematic: {type: 'bool', default: false},
        useGravity: {type: 'bool', default: true},
        mass: {type: 'number', default: 1},
        velocity: {type: 'vec3', default: {x: 0, y:0, z:0}},
        freezePosX: {type: 'bool', default: false},
        freezePosY: {type: 'bool', default: false},
        freezePosZ: {type: 'bool', default: false},
        freezeRotX: {type: 'bool', default: false},
        freezeRotY: {type: 'bool', default: false},
        freezeRotZ: {type: 'bool', default: false},
    },
    update: function (oldData) {
        const obj = this.el.getObject3D('mesh');
        if(obj){
            obj.userData.rigidBody = this.data;
            obj.userData.rigidBody.enabled = true;
        }
    }
});
AFRAME.registerComponent('sq-particlesystem', {
    schema:{
        duration: {type: 'number', default: 0},
        startColor: {type: 'string', default: "#ffffff"},
        startDelay: {type: 'number', default: 0},
        startDelayMultiplier: {type: 'number', default: 1},
        startLifetime: {type: 'number', default: 0},
        startLifetimeMultiplier: {type: 'number', default: 1},
        startSize: {type: 'number', default: 0},
        startSpeed: {type: 'number', default: 0},
        startRotation: {type: 'number', default: 0},
        simulationSpace: {type: 'string', default: 'local'},
        particleTexture: {type: 'string', default: ''},
        emitterVelocity: {type: 'vec3', default: {x: 0, y:0, z:0}},
        emitterVelocityMode: {type: 'string', default: 'transform'},
        maxParticles: {type: 'number', default: 0},
        flipRotation: {type: 'number', default: 0},
        scalingMode: {type: 'string', default: 'local'},
        loop: {type: 'bool', default: true},
        playOnAwake: {type: 'bool', default: true},
        prewarm: {type: 'bool', default: false},
    },
    update: function (oldData) {
        const mesh = this.el.getObject3D('mesh')
        if(mesh){
            mesh.userData.particle = this.data;
            mesh.userData.particle.enabled = true;
        }
    }
});
AFRAME.registerComponent('sq-slippery', {
    schema:{
        friction: {type: 'number', default: 0},
    },
    update: function (oldData) {
        const mesh = this.el.getObject3D('mesh')
        if(mesh){
            mesh.userData.slippery = true;
            mesh.userData.friction = this.data.friction;
        }
    }
});
['hideavatars', 'mirror', 'hidedefaulttextures'].forEach(d => {
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
            position: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
            rotation: {type: 'vec3', default: {x: 0, y: 0, z: 0}},
            scale: {type: 'vec3', default: {x: 1, y: 1, z: 1}},
        },
        update: function (oldData) {
            const mesh = this.el.getObject3D('mesh')
            if(mesh){
                mesh.userData[d] = {
                enabled: true, 
                position: [this.data.position.x, this.data.position.y, -this.data.position.z],
                rotation: [-this.data.rotation.x, -this.data.rotation.y, this.data.rotation.z],
                // position: this.data.position,
                // rotation: this.data.rotation,
                scale: this.data.scale,
                };
            }
        }
    });
});

AFRAME.registerComponent('sq-spawnpoint', {
    schema: {
        position: {type: 'vec3', default: {x: 0, y: 0, z: 0}}
    },
    tick: function () {
        if(window.api && window.api.write3D && !this.hasRun) {
            this.hasRun = true;
            window.api.write3D("spawnPoint:" + 
                            (this.data.position.x||0) + "," + 
                            (this.data.position.y||0) + "," + 
                            (-this.data.position.z||0));
        }
    }
});

AFRAME.registerComponent('sq-trackpose', {
    schema: {
        type: {type: 'string', default: 'lefthand'}
    },
    tick: function () {
        if(window.userpose) {
            var pos = [this.el.object3D.position.x,this.el.object3D.position.y,this.el.object3D.position.z];
            var rot = [this.el.object3D.rotation.x,this.el.object3D.rotation.y,this.el.object3D.rotation.z];
            if(this.data.type === "head") {
                pos = [window.userpose[0], window.userpose[1], -window.userpose[2]];
                rot = [-window.userpose[3], -window.userpose[4], window.userpose[5]];
            }
            if(this.data.type === "lefthand") {
                pos = [window.userpose[6], window.userpose[7], -window.userpose[8]];
                rot = [-window.userpose[9], -window.userpose[10], window.userpose[11]];
            }
            if(this.data.type === "righthand") {
                pos = [window.userpose[12], window.userpose[13], -window.userpose[14]];
                rot = [-window.userpose[15], -window.userpose[16], window.userpose[17]];
            }
            this.el.object3D.position.set(pos[0], pos[1], pos[2]);
            this.el.object3D.rotation.set(rot[0], rot[1], rot[2]);
        }
    }
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
        interval: {type: 'number', default: 0},
        eventName: {type: 'string', default: 'startAnimation'},
        remote: {type: 'string', default: ''}
    },
    tick: function() {
        if(this.data.interval) {
            let nowInMs = new Date().getTime();
            let timeSinceLast = nowInMs / 1000 - Math.floor( nowInMs / (this.data.interval * 1000)) * this.data.interval;
            if(timeSinceLast > this.data.interval - 1 && !this.readyToTrigger) {
                this.readyToTrigger = true;
            }
            if(timeSinceLast < 1 && this.readyToTrigger) {
                this.readyToTrigger = false;
                this.el.emit(this.data.eventName, null, false);
            }
        }
    }
});