 ['climbable', 'collider', 'sticky', 'slippery', 'lefthand', 'righthand', 'head' ].forEach(d=>{
            AFRAME.registerComponent('sq-' + d, {
                update: function (oldData) {
                    const mesh = this.el.getObject3D('mesh')
                    if(mesh){
                        mesh.userData[d] = true;
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