class Injection {
    lastFrame = {};
    currentFrame = {};
    constructor() {
        if(AFRAME) {
            const saveRenderer = AFRAME.scenes[0].renderer.render;
            const streamRender = object => {
                if(window.api && typeof window.api.write3D == "function") {
                    let sceneGraph = {};
                    this.parseFrame(object, sceneGraph);
                    this.lastFrame = this.currentFrame;
                    let keys = Object.keys(this.currentFrame);
                    let objects = keys.map(k=>this.currentFrame[k]);
                    const isGeoUpdate = d => d.geometry && d.geometry.needsUpdate;
                    const isMatUpdate = d => d.material && d.material.needsUpdate;
                    const staleItems = window.api.getStale();
                    window.api.write3D(
                        JSON.stringify(
                            {
                                keys,
                                objects: objects
                                    .filter(d=>{
                                        return this.isStale(d.id, staleItems) || d.needsUpdate || isGeoUpdate(d) || isMatUpdate(d)
                                    })
                            }
                        )
                    );
                    for(let i = 0; i < objects.length; i++ ) {
                        objects[i].needsUpdate = false;
                        /* if(isGeoUpdate(objects[i])) {
                            objects[i].geometry.needsUpdate = false;
                        }
                        if(isMatUpdate(objects[i])) {
                            objects[i].material.needsUpdate = false;
                        }*/
                    }
                }
            };
            AFRAME.scenes[0].renderer.render = (scene, camera) => {
                streamRender(scene);
                return saveRenderer.call(AFRAME.scenes[0].renderer, scene, camera);
            }
        }else{
            console.log("No AFRAME detected, sleeping...");
        }
    }
    isStale(id, staleItems) {
        if ((staleItems.length === 1 && staleItems[0] === "*") || staleItems.includes(id)) {
            return true;
        }
        return false;
    }
    parseFrame = (object, sceneGraph) => {
        if(object.isObject3D) {
            this.parseObject3D(object, sceneGraph);
        }
        if(object.isScene) {
            this.parseScene(object, sceneGraph);
        }
        if(object.isMesh) {
            this.parseMesh(object, sceneGraph);
        }
        if(this.lastFrame[sceneGraph.id]) {
            sceneGraph.needsUpdate = this.object3DNeedsUpdate(sceneGraph, this.lastFrame[sceneGraph.id]);
        }else{
            sceneGraph.needsUpdate = true;
        }
        this.currentFrame[sceneGraph.id] = sceneGraph;
        if(object.isObject3D) {
            (object.children  || []).forEach((d, i) => {
                const child = {};
                this.parseFrame(d, child);
                this.currentFrame[child.id] = child;
            });
        }

    };
    object3DNeedsUpdate(object, prevObject){
        if(!object) {
            console.log("No object");
        }
        let needsUpdate = false;
        ["scale", "position", "rotation"].forEach(d=>{
            if(object[d][0] !== prevObject[d][0] ||
                object[d][1] !== prevObject[d][1] ||
                object[d][2] !== prevObject[d][2]
            ) {
                needsUpdate = true;
            }
        });
        if(object.parent !== prevObject.parent) {
            needsUpdate = true;
        }
        if(object.visible !== prevObject.visible) {
            needsUpdate = true;
        }
        if(object.geometry && object.geometry.needsUpdate) {
            needsUpdate = true;
        }
        if(object.material && object.material.needsUpdate) {
            needsUpdate = true;
        }
        return needsUpdate
    }
    parseObject3D(object, sceneGraph){
        if(object.scale.x > 1) {
            console.log(object.id, object.scale.x);
        }
        Object.assign(sceneGraph, {
            id: object.id,
            name: object.name,
            type: "Object3D",
            parent: object.parent ? object.parent.id : null,
            children: [],
            visible: object.visible,
            receiveShadow: object.receiveShadow,
            castShadow: object.castShadow,
            renderOrder: object.renderOrder,
            up: [object.up.x, object.up.y, object.up.z],
            scale: [object.scale.x, object.scale.y, object.scale.z],
            /* convert from Right Handed to Left Handed for unity - flip the z axis */
            position: [object.position.x, object.position.y, -object.position.z],
            rotation: [-object.rotation.x, -object.rotation.y, object.rotation.z],
            /* convert from Right Handed to Left Handed for unity - https://stackoverflow.com/questions/18066581/convert-unity-transforms-to-three-js-rotations */
            /* quaternion: [object.quaternion.z, object.quaternion.w, object.quaternion.x, object.quaternion.y], */
            isObject3D: true
        })
    }
    parseScene = (object, sceneGraph) => {
        Object.assign(sceneGraph, {
            type: "Scene",
            autoUpdate: object.autoUpdate,
            background: object.background,
            environment: object.environment,
            isScene: true,
        });
    }
    parseMesh(object, sceneGraph) {
        Object.assign(sceneGraph, {
            geometry: this.parseGeometry(object.geometry),
            material: this.parseMaterial(object.material),
            type: "Mesh",
            isMesh: true,
        });
    }
    parseGeometry(geometry){
        const object = {};
        Object.assign(object, {
            type: geometry.metadata ? geometry.metadata.type : geometry.type,
            isGeometry: true,
            needsUpdate: geometry.needsUpdate||false
        });
        Object.assign(object, geometry.metadata ? geometry.metadata.parameters : geometry.parameters);
        return object;
    }
    parseMaterial(material) {
        const object = {};
        const color = new AFRAME.THREE.Color(material.color);
        Object.assign(object, {
            color: [color.r, color.g, color.b],
            type: material.type,
            isMaterial: true,
            needsUpdate: material.needsUpdate||false
        })
        Object.assign(object, material.parameters);
        return object;
    }


}
setTimeout(()=>{
    window.AframeInjection = new Injection();
});