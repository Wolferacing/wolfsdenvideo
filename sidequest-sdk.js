 ['climbable', 'collider', 'invertedcollider', 'sticky', 'clickable', 'hidedefaulttextures'].forEach(d => {
            AFRAME.registerComponent('sq-' + d, {
                update: function (oldData) {
                    const mesh = this.el.getObject3D('mesh')
                    if(mesh){
                        mesh.userData[d] = true;
                    }
                }
            });
        });
        // Deprecated in favour of <a-link>
        /*AFRAME.registerComponent('sq-portal', {
            schema:{
                url: {type: 'string', default: ''},
                title: {type: 'string', default: ''},
                image: {type: 'string', default: ''}
            },
            update: function (oldData) {
                const mesh = this.el.getObject3D('mesh')
                if(mesh){
                    mesh.userData.portal = {
                        enabled: true,
                        url: this.data.url,
                        title: this.data.title,
                        image: this.data.image,
                    };
                }
            }
        });*/
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
        ['hideavatars', 'mirror'].forEach(d => {
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
                        position: this.data.position,
                        rotation: this.data.rotation,
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
            update: function () {
                window.api.write3D("spawnPoint:" + this.data.x + "," + this.data.y + "," + this.data.z);
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
                        pos = [window.userpose[0], window.userpose[1], window.userpose[2]];
                        rot = [window.userpose[3], window.userpose[4], window.userpose[5]];
                    }
                    if(this.data.type === "lefthand") {
                        pos = [window.userpose[6], window.userpose[7], window.userpose[8]];
                        rot = [window.userpose[9], window.userpose[10], window.userpose[11]];
                    }
                    if(this.data.type === "righthand") {
                        pos = [window.userpose[12], window.userpose[13], window.userpose[14]];
                        rot = [window.userpose[15], window.userpose[16], window.userpose[17]];
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