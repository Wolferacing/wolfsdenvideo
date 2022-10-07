AFRAME.registerComponent('sq-climbable', {
  update: function (oldData) {
    this.el.getObject3D('mesh').geometry.userData.climbable = true;
  }
});