/**
 * Minimal CSInterface shim for Podclip.
 *
 * Adobe ships a much larger CSInterface.js with the CEP SDK. We only need a
 * handful of methods, so we wrap window.__adobe_cep__ directly. If you ever
 * need more (events, theme color, flyout menus), drop in Adobe's full file
 * and remove this one.
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  callback = callback || function () {};
  if (typeof window.__adobe_cep__ === "undefined") {
    callback("EvalScript error: __adobe_cep__ not available");
    return;
  }
  window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getSystemPath = function (pathType) {
  if (typeof window.__adobe_cep__ === "undefined") return "";
  return window.__adobe_cep__.getSystemPath(pathType);
};

CSInterface.prototype.getOSInformation = function () {
  if (typeof window.__adobe_cep__ === "undefined") return "Unknown";
  return window.__adobe_cep__.getOSInformation();
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
  if (typeof window.__adobe_cep__ === "undefined") return;
  window.__adobe_cep__.openURLInDefaultBrowser(url);
};

window.CSInterface = CSInterface;
window.SystemPath = {
  EXTENSION: "extension",
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  MY_DOCUMENTS: "myDocuments",
  APPLICATION: "application",
  HOST_APPLICATION: "hostApplication"
};
