console.log(document.currentScript);
const currentScriptHasOnlyGetter = !Object.getOwnPropertyDescriptor(document, "currentScript")["set"];

if(!currentScriptHasOnlyGetter) {
  document.currentScript = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
} 
